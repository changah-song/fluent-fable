"""Phase 4.2 — offline training pipeline for the pooled P(known) model.

Fits a *calibrated* classifier over the full feature set (design doc §3) and
checks that it beats the Phase 3 single-factor IRT baseline
(P = sigmoid(theta - difficulty)) on a held-out slice.

Design decisions baked in here:

* **No train/serve skew.** Real training rows come from the JS exporter
  (frontend/scripts/exportFeatureDataset.js), which builds features with the
  SAME assembleFeatures the device serves with. This script never recomputes a
  feature — it consumes the exported vector/mask/categorical as-is.
* **Missing features stay explicit.** Each numeric feature arrives with a mask
  (1 = real, 0 = imputed). We feed the imputed value AND the mask column, so the
  model can learn "this was absent" instead of trusting a fake 0 (the machine
  side of the plan §4.1 "never silently zero" contract). Constant columns are
  dropped so the matrix stays clean.
* **Held-out split by user.** GroupShuffleSplit on owner id, so the test users
  are unseen — the honest generalization question, not memorized users.
* **Versioned artifacts + rollback.** Each run writes model_v{N}.joblib +
  model_v{N}.meta.json and advances a current.json pointer; --rollback repoints
  it to an earlier version without retraining (design doc §4 keeps rollback).

Usage:
    python train_pknown.py --synthetic [--seed 42] [--n-users 60]
    python train_pknown.py --input dataset.json
    python train_pknown.py --rollback 3
"""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
from datetime import datetime, timezone

import numpy as np
from sklearn.calibration import calibration_curve
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss
from sklearn.model_selection import GroupShuffleSplit
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
import joblib

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_ARTIFACTS = os.path.join(HERE, "artifacts")

# The two features the IRT baseline uses; we read them straight from each row's
# vector to score the baseline on the identical held-out set.
THETA_KEY = "user_theta"
DIFFICULTY_KEY = "kb_difficulty"


def _sigmoid(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-x))


# ── data loading ──────────────────────────────────────────────────────────────
def load_dataset(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def build_matrix(dataset: dict):
    """Turn the exported rows into (X, y, groups, baseline_p, columns).

    X = [imputed numeric values | missingness mask columns | one-hot categoricals].
    """
    rows = dataset["rows"]
    if not rows:
        raise ValueError("dataset has no rows — need graded review events to train.")

    meta = dataset.get("meta", {})
    numeric_keys = meta.get("featureKeys") or sorted(
        {k for r in rows for k in r.get("vector", {})}
    )
    categorical_keys = meta.get("categoricalKeys") or sorted(
        {k for r in rows for k in r.get("categorical", {})}
    )

    # Categorical one-hot vocabulary (kept small; unseen categories → all-zero).
    cat_values: dict[str, list[str]] = {}
    for key in categorical_keys:
        seen = sorted({str(r.get("categorical", {}).get(key)) for r in rows
                       if r.get("categorical", {}).get(key) is not None})
        cat_values[key] = seen

    columns: list[str] = []
    columns += [f"val::{k}" for k in numeric_keys]
    columns += [f"mask::{k}" for k in numeric_keys]
    for key in categorical_keys:
        columns += [f"cat::{key}={v}" for v in cat_values[key]]

    X = np.zeros((len(rows), len(columns)), dtype=float)
    y = np.zeros(len(rows), dtype=int)
    groups = np.empty(len(rows), dtype=object)
    baseline_p = np.zeros(len(rows), dtype=float)

    col_index = {c: i for i, c in enumerate(columns)}
    for i, r in enumerate(rows):
        vec = r.get("vector", {})
        mask = r.get("mask", {})
        cat = r.get("categorical", {})
        for k in numeric_keys:
            X[i, col_index[f"val::{k}"]] = float(vec.get(k, 0.0) or 0.0)
            X[i, col_index[f"mask::{k}"]] = float(mask.get(k, 0))
        for key in categorical_keys:
            v = cat.get(key)
            if v is not None:
                col = f"cat::{key}={v}"
                if col in col_index:
                    X[i, col_index[col]] = 1.0
        y[i] = int(r["label"])
        groups[i] = r.get("owner", "unknown")
        theta = float(vec.get(THETA_KEY, 0.0) or 0.0)
        diff = float(vec.get(DIFFICULTY_KEY, 0.0) or 0.0)
        baseline_p[i] = 1.0 / (1.0 + math.exp(-(theta - diff)))

    # Drop zero-variance columns (e.g. always-absent masks) — they carry no signal.
    keep = X.std(axis=0) > 0
    X = X[:, keep]
    columns = [c for c, k in zip(columns, keep) if k]
    return X, y, groups, baseline_p, columns


# ── synthetic data (self-contained; no JS needed) ─────────────────────────────
def synthetic_dataset(n_users: int = 60, seed: int = 42) -> dict:
    """A seeded stand-in with a hidden signal the baseline can't see.

    Outcome ~ Bernoulli(sigmoid(true_theta - difficulty + BETA * hanja_overlap)).
    The baseline only knows (theta_est, difficulty), so it MUST miss the overlap
    term; a model that also sees item_cross_hanja_overlap can recover it and beat
    the baseline. theta_est is a noisy proxy for true_theta (as the online update
    would be), so the baseline is decent but not perfect.

    Each user draws (with replacement) from a small fixed vocabulary, so words
    recur: the FIRST draw of a word is a cold (first-review) row and the rest are
    warm — mirroring how the real exporter (featureDataset.js) flags cold. This
    lets the Phase 5 harness segment cold/warm and morphological-transfer honestly.
    """
    rng = np.random.default_rng(seed)
    BETA = 2.5
    rows = []
    for u in range(n_users):
        owner = f"syn-{u}"
        true_theta = rng.uniform(-1.5, 1.5)
        theta_est = true_theta + rng.normal(0, 0.35)  # imperfect online estimate
        self_report = int(np.clip(round(3.5 + true_theta), 1, 6))
        # A fixed vocabulary of 15 words per user, each with its own CONTINUOUS
        # difficulty (0..1, as korean_nikl_vocab.difficulty_percentile) and
        # (hidden-signal) hanja overlap.
        vocab = [
            {
                "stem": f"w{u}_{i}",
                "difficulty_percentile": float(rng.random()),   # continuous [0,1]
                "overlap": float(rng.choice([0.0, 0.0, 0.5, 1.0])),
                "syllables": int(rng.integers(1, 4)),
            }
            for i in range(15)
        ]
        seen: set[str] = set()
        for _ in range(30):
            w = vocab[int(rng.integers(0, len(vocab)))]
            # [0,1] -> [-3,3], matching difficultyFromPercentile on the device.
            difficulty = w["difficulty_percentile"] * 6 - 3
            reading_level = min(6, 1 + int(w["difficulty_percentile"] * 6))
            p_true = _sigmoid(np.array(true_theta - difficulty + BETA * w["overlap"]))
            label = int(rng.random() < float(p_true))
            vector = {
                "user_theta": theta_est,
                "kb_difficulty": difficulty,
                "kb_level_rank": reading_level,
                "kb_syllable_count": w["syllables"],
                "item_cross_hanja_overlap": w["overlap"],
                "item_hanja_density": 1.0,
                "user_self_report_rank": self_report,
                "user_self_report_weight": 0.0,
            }
            mask = {k: 1 for k in vector}
            rows.append({"label": label, "cold": w["stem"] not in seen, "owner": owner,
                         "vector": vector, "mask": mask, "categorical": {}})
            seen.add(w["stem"])
    return {
        "meta": {
            "source": "synthetic",
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "featureKeys": sorted(rows[0]["vector"].keys()),
            "categoricalKeys": [],
        },
        "rows": rows,
    }


# ── artifact versioning + rollback ────────────────────────────────────────────
def export_linear_model(model, columns: list[str], version: int) -> dict:
    """Collapse the StandardScaler + LogisticRegression pipeline into ONE set of
    weights the device can evaluate directly: P = sigmoid(W·x + B) on the RAW
    (unscaled) feature values.

    The scaler maps x → (x − μ)/σ, then logreg computes w·((x − μ)/σ) + b. That
    composes to a plain linear function of raw x:
        W_i = w_i / σ_i
        B   = b − Σ w_i·μ_i / σ_i
    so the device never needs the scaler — it just reads {weights, intercept}.
    """
    scaler = model.named_steps["standardscaler"]
    logreg = model.named_steps["logisticregression"]
    mean = scaler.mean_
    scale = scaler.scale_
    w = logreg.coef_[0]
    b = float(logreg.intercept_[0])

    W = w / scale
    B = b - float(np.sum(w * mean / scale))
    weights = {col: float(W[i]) for i, col in enumerate(columns)}
    return {
        "schema": "pknown-linear/v1",
        "version": version,
        "link": "sigmoid",
        "intercept": B,
        "weights": weights,
        "columns": list(columns),
        "note": "P(known) = sigmoid(intercept + Σ weights[col]·col). "
                "Columns: val::KEY = numeric value (0 if absent); mask::KEY = 1 if "
                "the feature was present else 0; cat::KEY=VALUE = 1 if that category.",
    }


def _git_sha() -> str | None:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"], cwd=HERE, stderr=subprocess.DEVNULL
        ).decode().strip()
    except Exception:
        return None


def _next_version(artifacts_dir: str) -> int:
    if not os.path.isdir(artifacts_dir):
        return 1
    versions = []
    for name in os.listdir(artifacts_dir):
        if name.startswith("model_v") and name.endswith(".joblib"):
            try:
                versions.append(int(name[len("model_v"):-len(".joblib")]))
            except ValueError:
                pass
    return (max(versions) + 1) if versions else 1


def _set_current(artifacts_dir: str, version: int, meta: dict) -> None:
    with open(os.path.join(artifacts_dir, "current.json"), "w", encoding="utf-8") as fh:
        json.dump({"version": version, "model": f"model_v{version}.joblib",
                   "meta": f"model_v{version}.meta.json",
                   "coef": f"model_v{version}.coef.json",
                   "updated_at": datetime.now(timezone.utc).isoformat(),
                   "metrics": meta.get("metrics")}, fh, indent=2)


def rollback(artifacts_dir: str, version: int) -> None:
    meta_path = os.path.join(artifacts_dir, f"model_v{version}.meta.json")
    if not os.path.exists(meta_path):
        raise SystemExit(f"Cannot roll back: version {version} not found in {artifacts_dir}")
    with open(meta_path, "r", encoding="utf-8") as fh:
        meta = json.load(fh)
    _set_current(artifacts_dir, version, meta)
    print(f"Rolled back current → model_v{version} "
          f"(Brier {meta['metrics']['full_brier']:.4f} vs baseline "
          f"{meta['metrics']['baseline_brier']:.4f}).")


# ── split + estimator (shared with the Phase 5 validation harness) ────────────
def build_model(seed: int = 42):
    """The estimator, in ONE place so Phase 5's validate_pknown fits the same thing
    the trainer ships. A single linear model: StandardScaler + LogisticRegression.

    We keep it LINEAR on purpose — Phase 4.3 serves by exporting these coefficients
    and evaluating P = sigmoid(w·x + b) on-device in JS (local-first, no round
    trip), so "the model we validated" and "the model the device runs" are the same
    function. Logistic regression's probability output is already calibrated under
    its training loss; the held-out calibration curve is the check.
    """
    return make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000, C=1.0))


def split_indices(X, y, groups, seed: int = 42):
    """Held-out split by USER (GroupShuffleSplit on owner id), so test users are
    unseen — the honest generalization question. Falls back to a random split when
    there's a single user, or when the grouped split happens to strand all of one
    class in train. Shared verbatim with the validation harness so both evaluate on
    the same kind of split.
    """
    n_groups = len(set(groups))
    if n_groups >= 2:
        splitter = GroupShuffleSplit(n_splits=1, test_size=0.3, random_state=seed)
        train_idx, test_idx = next(splitter.split(X, y, groups))
    else:  # single user → fall back to a plain random split
        rng = np.random.default_rng(seed)
        perm = rng.permutation(len(y))
        cut = max(1, int(len(y) * 0.7))
        train_idx, test_idx = perm[:cut], perm[cut:]

    if len(np.unique(y[train_idx])) < 2:
        # The grouped split put all of one class in test; fall back to a
        # stratified-ish random split so both classes appear in train.
        rng = np.random.default_rng(seed)
        perm = rng.permutation(len(y))
        cut = max(2, int(len(y) * 0.7))
        train_idx, test_idx = perm[:cut], perm[cut:]
    return train_idx, test_idx


# ── train ─────────────────────────────────────────────────────────────────────
def train(dataset: dict, artifacts_dir: str, seed: int = 42) -> dict:
    X, y, groups, baseline_p, columns = build_matrix(dataset)

    if len(np.unique(y)) < 2:
        raise SystemExit(
            "Training data has only one outcome class — need both recalled (1) and "
            "lapsed (0) reviews to fit a classifier. (Got %d rows, all label=%d.)"
            % (len(y), int(y[0]))
        )

    train_idx, test_idx = split_indices(X, y, groups, seed)

    model = build_model(seed)
    y_train = y[train_idx]
    model.fit(X[train_idx], y_train)

    p_full = model.predict_proba(X[test_idx])[:, 1]
    y_test = y[test_idx]
    full_brier = float(brier_score_loss(y_test, p_full))
    baseline_brier = float(brier_score_loss(y_test, baseline_p[test_idx]))

    # Calibration curve on the held-out set (the key diagnostic).
    calib = {}
    try:
        frac_pos, mean_pred = calibration_curve(y_test, p_full, n_bins=5, strategy="quantile")
        calib = {"mean_predicted": [round(float(v), 4) for v in mean_pred],
                 "fraction_positive": [round(float(v), 4) for v in frac_pos]}
    except Exception:
        calib = {"note": "too few samples for a calibration curve"}

    metrics = {
        "full_brier": round(full_brier, 4),
        "baseline_brier": round(baseline_brier, 4),
        "improvement": round(baseline_brier - full_brier, 4),
        "n_train": int(len(train_idx)),
        "n_test": int(len(test_idx)),
        "n_users": int(len(set(groups))),
        "base_rate": round(float(y_test.mean()), 4),
        "calibration": calib,
    }

    os.makedirs(artifacts_dir, exist_ok=True)
    version = _next_version(artifacts_dir)
    coef = export_linear_model(model, columns, version)
    meta = {
        "version": version,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "git_sha": _git_sha(),
        "model_type": "logreg",
        "source": dataset.get("meta", {}).get("source"),
        "feature_columns": columns,
        "metrics": metrics,
    }
    joblib.dump({"model": model, "columns": columns}, os.path.join(artifacts_dir, f"model_v{version}.joblib"))
    with open(os.path.join(artifacts_dir, f"model_v{version}.meta.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=2)
    # The device-servable form (Phase 4.3): a single linear model the JS scorer
    # evaluates locally. Written next to the joblib and pointed at by current.json.
    with open(os.path.join(artifacts_dir, f"model_v{version}.coef.json"), "w", encoding="utf-8") as fh:
        json.dump(coef, fh, indent=2)
    _set_current(artifacts_dir, version, meta)
    return meta


def _print_report(meta: dict) -> None:
    m = meta["metrics"]
    print("=" * 60)
    print(f" P(known) model  v{meta['version']}  ({meta['model_type']}, source={meta['source']})")
    print("=" * 60)
    print(f" held-out users: {m['n_users']}   train/test rows: {m['n_train']}/{m['n_test']}   base rate: {m['base_rate']}")
    print(f" full-model Brier : {m['full_brier']:.4f}")
    print(f" baseline  Brier : {m['baseline_brier']:.4f}  (IRT sigmoid(theta - difficulty))")
    verdict = "BEATS" if m["improvement"] > 0 else "does NOT beat"
    print(f" improvement     : {m['improvement']:+.4f}   → full model {verdict} baseline")
    if "mean_predicted" in m["calibration"]:
        print(" calibration (held-out):")
        print("   pred   actual")
        for p, a in zip(m["calibration"]["mean_predicted"], m["calibration"]["fraction_positive"]):
            print(f"   {p:.3f}  {a:.3f}")
    print("=" * 60)


def main() -> None:
    ap = argparse.ArgumentParser(description="Train the pooled P(known) model (Phase 4.2).")
    ap.add_argument("--input", help="dataset JSON from exportFeatureDataset.js")
    ap.add_argument("--synthetic", action="store_true", help="use the seeded synthetic generator")
    ap.add_argument("--n-users", type=int, default=60)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--artifacts-dir", default=DEFAULT_ARTIFACTS)
    ap.add_argument("--rollback", type=int, help="repoint current.json to an earlier version and exit")
    args = ap.parse_args()

    if args.rollback is not None:
        rollback(args.artifacts_dir, args.rollback)
        return

    if args.input:
        dataset = load_dataset(args.input)
    elif args.synthetic:
        dataset = synthetic_dataset(n_users=args.n_users, seed=args.seed)
    else:
        ap.error("provide --input <dataset.json> or --synthetic")

    meta = train(dataset, args.artifacts_dir, seed=args.seed)
    _print_report(meta)


if __name__ == "__main__":
    main()
