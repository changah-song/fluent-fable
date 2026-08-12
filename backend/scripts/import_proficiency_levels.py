#!/usr/bin/env python3
"""Build the compact proficiency-level lookup database used by preprocessing.

The raw sources are intentionally not loaded by the app at runtime:

* English CEFR source: legacy Excel workbook with Word / Part of Speech / CEFR.
* Chinese HSK source: JSON entries with simplified, forms.traditional, and level tags.
* Korean source: bundled hanja.db rows with hangul and NIKL-style word_grade,
  augmented with corpus frequency from 현대 국어 사용 빈도 조사 2 (일반어휘통계.txt) to
  give each word a continuous difficulty_rank and one of six reading levels.

This script extracts only the lookup data the backend needs and writes a small
SQLite database. It is safe to rerun; the output database is rebuilt atomically.

The Korean table can be refreshed on its own (when the English/HSK workbooks
aren't on hand) against an already-built database:

    python scripts/import_proficiency_levels.py --korean-only \
        --korean-freq "현대 국어 사용 빈도 조사 2/일반어휘통계.txt"
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import sqlite3
import sys
import unicodedata
from collections import Counter
from pathlib import Path
from typing import Any

CEFR_RANKS = {
    "A1": 1,
    "A2": 2,
    "B1": 3,
    "B2": 4,
    "C1": 5,
    "C2": 6,
}

KOREAN_GRADE_RANKS = {
    "초급": 1,
    "중급": 2,
    "고급": 3,
}

# Educational grade order, easiest first. The three NIKL grades are each split
# Lower/Upper by in-grade frequency to yield the six "Noeul Reading Levels".
KOREAN_GRADE_ORDER = ("초급", "중급", "고급")

# korean_nikl_vocab keeps the NIKL grade as the authoritative educational label,
# augmented with corpus frequency so preprocessing can order words within a grade:
#   frequency_count/rank/percentile  — from 현대 국어 사용 빈도 조사 2 (nullable when unseen)
#   difficulty_rank                  — dense 1..N, (grade, freq desc); model uses this
#   reading_level                    — 1..6 user-facing band (3 grades x Lower/Upper)
#   level_rank                       — == reading_level, so book difficulty / labels
#                                      stay symmetric with English (CEFR) and Chinese (HSK)
KOREAN_SCHEMA = """
DROP TABLE IF EXISTS korean_nikl_vocab;

CREATE TABLE korean_nikl_vocab (
  term TEXT PRIMARY KEY,
  nikl_grade TEXT NOT NULL CHECK(nikl_grade IN ('초급', '중급', '고급')),
  frequency_count INTEGER,
  frequency_rank INTEGER,
  frequency_percentile REAL,
  difficulty_rank INTEGER NOT NULL,
  reading_level INTEGER NOT NULL CHECK(reading_level BETWEEN 1 AND 6),
  level_rank INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'nikl_graded_vocab'
);

CREATE INDEX idx_korean_nikl_vocab_level ON korean_nikl_vocab(level_rank);
CREATE INDEX idx_korean_nikl_vocab_difficulty ON korean_nikl_vocab(difficulty_rank);
"""

KOREAN_INSERT = """
INSERT INTO korean_nikl_vocab
  (term, nikl_grade, frequency_count, frequency_rank, frequency_percentile,
   difficulty_rank, reading_level, level_rank)
VALUES
  (:term, :nikl_grade, :frequency_count, :frequency_rank, :frequency_percentile,
   :difficulty_rank, :reading_level, :level_rank)
"""

EN_POS_MAP = {
    "abbreviation": "X",
    "adjective": "ADJ",
    "adverb": "ADV",
    "conjunction": "CONJ",
    "determiner": "DET",
    "exclamation": "INTJ",
    "miscellaneous": "X",
    "modal verb": "AUX",
    "noun": "NOUN",
    "number": "NUM",
    "preposition": "ADP",
    "pronoun": "PRON",
    "verb": "VERB",
}


def normalize_text(value: Any) -> str:
    raw = "" if value is None else str(value)
    normalized = unicodedata.normalize("NFKC", raw)
    normalized = normalized.replace("’", "'").replace("‘", "'").replace("`", "'")
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized


def normalize_word(value: Any) -> str:
    return normalize_text(value).lower()


def normalize_cefr(value: Any) -> str | None:
    level = normalize_text(value)
    level = level.replace("“", "").replace("”", "").replace('"', "").replace("'", "")
    level = level.upper()
    return level if level in CEFR_RANKS else None


def normalize_en_pos(value: Any) -> tuple[str, str]:
    source_pos = normalize_text(value)
    normalized = EN_POS_MAP.get(source_pos.lower(), "")
    return normalized, source_pos


def is_valid_en_word(word: str) -> bool:
    # Keep single terms and phrases from the source. Filter empty/system rows only.
    return bool(word and any("a" <= char <= "z" for char in word))


def update_easiest(
    store: dict[Any, tuple[str, int, dict[str, Any]]],
    key: Any,
    level: str,
    payload: dict[str, Any],
) -> bool:
    rank = CEFR_RANKS[level] if level in CEFR_RANKS else int(level)
    existing = store.get(key)
    if existing is None or rank < existing[1]:
        store[key] = (level, rank, payload)
        return True
    return False


def load_english_rows(path: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, int]]:
    try:
        import xlrd
    except ImportError as exc:  # pragma: no cover - dependency hint for CLI users
        raise SystemExit(
            "Missing dependency: xlrd. Install backend requirements or run "
            "`python -m pip install xlrd>=2.0,<3`."
        ) from exc

    book = xlrd.open_workbook(str(path))
    sheet = book.sheet_by_index(0)
    headers = [normalize_text(sheet.cell_value(0, col)) for col in range(sheet.ncols)]
    header_index = {header: index for index, header in enumerate(headers)}

    required = {"Word", "Part of Speech", "CEFR"}
    missing = sorted(required - set(header_index))
    if missing:
        raise ValueError(f"English workbook missing required columns: {', '.join(missing)}")

    word_pos_rows: dict[tuple[str, str], tuple[str, int, dict[str, Any]]] = {}
    fallback_rows: dict[str, tuple[str, int, dict[str, Any]]] = {}
    ignored_rows = 0
    duplicate_word_pos_conflicts = 0

    for row_idx in range(1, sheet.nrows):
        word = normalize_word(sheet.cell_value(row_idx, header_index["Word"]))
        level = normalize_cefr(sheet.cell_value(row_idx, header_index["CEFR"]))
        pos, source_pos = normalize_en_pos(sheet.cell_value(row_idx, header_index["Part of Speech"]))

        if not is_valid_en_word(word) or level is None:
            ignored_rows += 1
            continue

        payload = {
            "word": word,
            "pos": pos,
            "source_pos": source_pos,
            "cefr_level": level,
            "level_rank": CEFR_RANKS[level],
        }
        key = (word, pos)
        if key in word_pos_rows and word_pos_rows[key][0] != level:
            duplicate_word_pos_conflicts += 1
        update_easiest(word_pos_rows, key, level, payload)
        update_easiest(fallback_rows, word, level, payload)

    english_rows = [
        {
            "word": key[0],
            "pos": key[1],
            "source_pos": payload["source_pos"],
            "cefr_level": level,
            "level_rank": rank,
        }
        for key, (level, rank, payload) in sorted(word_pos_rows.items())
    ]
    english_fallback_rows = [
        {
            "word": word,
            "cefr_level": level,
            "level_rank": rank,
        }
        for word, (level, rank, _payload) in sorted(fallback_rows.items())
    ]

    stats = {
        "english_source_rows": sheet.nrows - 1,
        "english_rows": len(english_rows),
        "english_fallback_rows": len(english_fallback_rows),
        "english_ignored_rows": ignored_rows,
        "english_duplicate_word_pos_conflicts": duplicate_word_pos_conflicts,
    }
    return english_rows, english_fallback_rows, stats


def hsk_new_level(entry: dict[str, Any]) -> int | None:
    levels = entry.get("level") or []
    matched: list[int] = []
    for tag in levels:
        match = re.fullmatch(r"new-(\d+)", normalize_text(tag))
        if match:
            matched.append(int(match.group(1)))
    return min(matched) if matched else None


def add_hsk_lookup(
    rows_by_term: dict[str, dict[str, Any]],
    *,
    term: str,
    simplified: str,
    script: str,
    hsk_level: int,
) -> bool:
    if not term:
        return False

    candidate = {
        "term": term,
        "simplified": simplified,
        "script": script,
        "hsk_level": hsk_level,
        "level_rank": hsk_level,
        "hsk_system": "new",
    }
    existing = rows_by_term.get(term)
    if existing is None or hsk_level < existing["hsk_level"]:
        rows_by_term[term] = candidate
        return True
    return False


def load_hsk_rows(path: Path) -> tuple[list[dict[str, Any]], dict[str, int]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError("HSK source must be a JSON list")

    rows_by_term: dict[str, dict[str, Any]] = {}
    source_entries_with_new = 0
    skipped_without_new = 0
    traditional_terms_added = 0
    term_conflicts = 0

    for entry in data:
        if not isinstance(entry, dict):
            continue

        simplified = normalize_text(entry.get("simplified"))
        level = hsk_new_level(entry)
        if not simplified or level is None:
            skipped_without_new += 1
            continue

        source_entries_with_new += 1
        before = rows_by_term.get(simplified)
        add_hsk_lookup(
            rows_by_term,
            term=simplified,
            simplified=simplified,
            script="simplified",
            hsk_level=level,
        )
        if before and before["simplified"] != simplified:
            term_conflicts += 1

        for form in entry.get("forms") or []:
            if not isinstance(form, dict):
                continue
            traditional = normalize_text(form.get("traditional"))
            if not traditional or traditional == simplified:
                continue

            before = rows_by_term.get(traditional)
            changed = add_hsk_lookup(
                rows_by_term,
                term=traditional,
                simplified=simplified,
                script="traditional",
                hsk_level=level,
            )
            if changed:
                traditional_terms_added += 1
            if before and before["simplified"] != simplified:
                term_conflicts += 1

    rows = sorted(rows_by_term.values(), key=lambda row: (row["hsk_level"], row["term"]))
    stats = {
        "hsk_source_entries": len(data),
        "hsk_source_entries_with_new": source_entries_with_new,
        "hsk_skipped_without_new": skipped_without_new,
        "hsk_lookup_rows": len(rows),
        "hsk_traditional_terms_added": traditional_terms_added,
        "hsk_term_conflicts": term_conflicts,
    }
    return rows, stats


def load_korean_frequency(path: Path) -> dict[str, int]:
    """Map dictionary lemma -> summed corpus frequency.

    Source is 일반어휘통계.txt from 현대 국어 사용 빈도 조사 2 (NIKL, 2005): a UTF-16
    file with a header row and tab columns 순위(rank) · 빈도(frequency) · 어휘(headword)
    · 풀이(usage hint) · 품사(POS). Headwords carry homonym markers (가01, 가02); we
    strip the trailing digits and sum frequency across homonyms/POS so each lemma gets
    one total, matching the bare-lemma keys in korean_nikl_vocab. NFKC-normalized the
    same way as the graded terms so the two join cleanly.
    """
    raw = path.read_bytes().decode("utf-16")
    frequency: dict[str, int] = {}
    for line in raw.splitlines()[1:]:
        parts = line.split("\t")
        if len(parts) < 5:
            continue
        try:
            count = int(parts[1].replace(",", "").strip())
        except ValueError:
            continue
        lemma = normalize_text(re.sub(r"\d+$", "", parts[2]))
        if not lemma:
            continue
        frequency[lemma] = frequency.get(lemma, 0) + count
    return frequency


def _median(values: list[int]) -> int | None:
    """Upper-middle value (splits the list into 'more frequent' vs 'rarer' halves)."""
    if not values:
        return None
    return sorted(values)[len(values) // 2]


def load_korean_rows(
    path: Path, frequency: dict[str, int]
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            """
            SELECT hangul, word_grade
            FROM hanja_words
            WHERE word_grade IN ('초급', '중급', '고급')
              AND TRIM(hangul) <> ''
            """
        ).fetchall()
    finally:
        conn.close()

    rows_by_term: dict[str, dict[str, Any]] = {}
    ignored_rows = 0
    grade_conflicts = 0

    for row in rows:
        term = normalize_text(row["hangul"])
        grade = normalize_text(row["word_grade"])
        rank = KOREAN_GRADE_RANKS.get(grade)
        if not term or rank is None:
            ignored_rows += 1
            continue

        existing = rows_by_term.get(term)
        if existing and existing["nikl_grade"] != grade:
            grade_conflicts += 1
        if existing is None or rank < KOREAN_GRADE_RANKS[existing["nikl_grade"]]:
            rows_by_term[term] = {"term": term, "nikl_grade": grade}

    # Attach corpus frequency; None when the lemma never appears in the corpus.
    for term, row in rows_by_term.items():
        row["frequency_count"] = frequency.get(term)

    # Global frequency rank/percentile among matched terms (1 = most frequent).
    matched = sorted(
        (row for row in rows_by_term.values() if row["frequency_count"] is not None),
        key=lambda row: (-row["frequency_count"], row["term"]),
    )
    matched_total = len(matched)
    for index, row in enumerate(matched, start=1):
        row["frequency_rank"] = index
        row["frequency_percentile"] = round(index / matched_total, 6) if matched_total else None
    for row in rows_by_term.values():
        row.setdefault("frequency_rank", None)
        row.setdefault("frequency_percentile", None)

    # Six reading levels = the three NIKL grades, each split Lower/Upper at the
    # in-grade frequency median. More frequent -> Lower (easier); rarer or unmatched
    # -> Upper. Medians go into metadata so the split stays tunable without a rebuild.
    grade_medians: dict[str, int | None] = {}
    for grade in KOREAN_GRADE_ORDER:
        grade_medians[grade] = _median(
            [
                row["frequency_count"]
                for row in rows_by_term.values()
                if row["nikl_grade"] == grade and row["frequency_count"] is not None
            ]
        )

    for row in rows_by_term.values():
        grade = row["nikl_grade"]
        base = (KOREAN_GRADE_RANKS[grade] - 1) * 2  # 0, 2, 4
        median = grade_medians[grade]
        count = row["frequency_count"]
        is_lower = count is not None and median is not None and count >= median
        row["reading_level"] = base + (1 if is_lower else 2)
        row["level_rank"] = row["reading_level"]

    # Continuous difficulty rank: dense 1..N by (grade, freq desc). Matched terms come
    # before unmatched within a grade; guarantees every 초급 < every 중급 < every 고급.
    ordered = sorted(
        rows_by_term.values(),
        key=lambda row: (
            KOREAN_GRADE_RANKS[row["nikl_grade"]],
            0 if row["frequency_count"] is not None else 1,
            -(row["frequency_count"] or 0),
            row["term"],
        ),
    )
    for index, row in enumerate(ordered, start=1):
        row["difficulty_rank"] = index

    reading_level_distribution = Counter(row["reading_level"] for row in ordered)
    stats = {
        "korean_source_rows": len(rows),
        "korean_lookup_rows": len(ordered),
        "korean_ignored_rows": ignored_rows,
        "korean_grade_conflicts": grade_conflicts,
        "korean_frequency_matched": matched_total,
        "korean_frequency_coverage": round(matched_total / len(ordered), 4) if ordered else 0,
        "korean_grade_medians": {grade: grade_medians[grade] for grade in KOREAN_GRADE_ORDER},
        "korean_reading_level_distribution": {
            str(level): reading_level_distribution.get(level, 0) for level in range(1, 7)
        },
    }
    return ordered, stats


def create_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        PRAGMA foreign_keys = OFF;

        DROP TABLE IF EXISTS metadata;
        DROP TABLE IF EXISTS english_cefr;
        DROP TABLE IF EXISTS english_cefr_fallback;
        DROP TABLE IF EXISTS chinese_hsk;

        CREATE TABLE metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE english_cefr (
          word TEXT NOT NULL,
          pos TEXT NOT NULL DEFAULT '',
          source_pos TEXT,
          cefr_level TEXT NOT NULL,
          level_rank INTEGER NOT NULL,
          source TEXT NOT NULL DEFAULT 'en_m3',
          PRIMARY KEY (word, pos)
        );

        CREATE INDEX idx_english_cefr_word
          ON english_cefr(word);

        CREATE TABLE english_cefr_fallback (
          word TEXT PRIMARY KEY,
          cefr_level TEXT NOT NULL,
          level_rank INTEGER NOT NULL,
          source TEXT NOT NULL DEFAULT 'en_m3'
        );

        CREATE TABLE chinese_hsk (
          term TEXT NOT NULL,
          simplified TEXT NOT NULL,
          script TEXT NOT NULL CHECK(script IN ('simplified', 'traditional')),
          hsk_level INTEGER NOT NULL,
          level_rank INTEGER NOT NULL,
          hsk_system TEXT NOT NULL DEFAULT 'new',
          PRIMARY KEY (term, hsk_system)
        );

        CREATE INDEX idx_chinese_hsk_simplified
          ON chinese_hsk(simplified);

        CREATE INDEX idx_chinese_hsk_level
          ON chinese_hsk(hsk_system, hsk_level);
        """
    )
    # korean_nikl_vocab is created from the shared KOREAN_SCHEMA so the full rebuild
    # and the --korean-only refresh can never drift apart.
    conn.executescript(KOREAN_SCHEMA)


def write_database(
    output_path: Path,
    english_rows: list[dict[str, Any]],
    english_fallback_rows: list[dict[str, Any]],
    hsk_rows: list[dict[str, Any]],
    korean_rows: list[dict[str, Any]],
    metadata: dict[str, Any],
) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = output_path.with_suffix(output_path.suffix + ".tmp")
    if tmp_path.exists():
        tmp_path.unlink()

    conn = sqlite3.connect(tmp_path)
    try:
        create_schema(conn)
        conn.executemany(
            """
            INSERT INTO english_cefr (word, pos, source_pos, cefr_level, level_rank)
            VALUES (:word, :pos, :source_pos, :cefr_level, :level_rank)
            """,
            english_rows,
        )
        conn.executemany(
            """
            INSERT INTO english_cefr_fallback (word, cefr_level, level_rank)
            VALUES (:word, :cefr_level, :level_rank)
            """,
            english_fallback_rows,
        )
        conn.executemany(
            """
            INSERT INTO chinese_hsk (term, simplified, script, hsk_level, level_rank, hsk_system)
            VALUES (:term, :simplified, :script, :hsk_level, :level_rank, :hsk_system)
            """,
            hsk_rows,
        )
        conn.executemany(KOREAN_INSERT, korean_rows)
        conn.executemany(
            "INSERT INTO metadata (key, value) VALUES (?, ?)",
            [(key, json.dumps(value, ensure_ascii=False, sort_keys=True)) for key, value in metadata.items()],
        )
        conn.execute("PRAGMA user_version = 3")
        conn.commit()
    finally:
        conn.close()

    os.replace(tmp_path, output_path)


def update_korean_only(
    output_path: Path,
    korean_rows: list[dict[str, Any]],
    korean_metadata: dict[str, Any],
) -> None:
    """Rebuild only korean_nikl_vocab in an existing DB, leaving English/HSK intact.

    Used when the English/HSK source workbooks aren't on hand: the committed
    proficiency_levels.db already carries those tables, so a Korean-only refresh
    avoids needing them just to layer in frequency/reading-level data.
    """
    if not output_path.exists():
        raise FileNotFoundError(
            f"--korean-only needs an existing database at {output_path}"
        )

    conn = sqlite3.connect(output_path)
    try:
        conn.executescript(KOREAN_SCHEMA)
        conn.executemany(KOREAN_INSERT, korean_rows)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS metadata "
            "(key TEXT PRIMARY KEY, value TEXT NOT NULL)"
        )
        conn.executemany(
            "INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)",
            [
                (key, json.dumps(value, ensure_ascii=False, sort_keys=True))
                for key, value in korean_metadata.items()
            ],
        )
        conn.execute("PRAGMA user_version = 3")
        conn.commit()
    finally:
        conn.close()


def level_distribution(rows: list[dict[str, Any]], field: str) -> dict[str, int]:
    counts = Counter(str(row[field]) for row in rows)
    return dict(sorted(counts.items(), key=lambda item: item[0]))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--english-xls",
        type=Path,
        default=None,
        help="Path to en_m3.xls (required unless --korean-only)",
    )
    parser.add_argument(
        "--hsk-json",
        type=Path,
        default=None,
        help="Path to HSK vocab.json (required unless --korean-only)",
    )
    parser.add_argument(
        "--korean-hanja-db",
        type=Path,
        default=Path(__file__).resolve().parents[2] / "frontend" / "assets" / "data" / "hanja.db",
        help="Path to bundled hanja.db containing NIKL-style word_grade values",
    )
    parser.add_argument(
        "--korean-freq",
        type=Path,
        default=None,
        help="Path to 일반어휘통계.txt (UTF-16) from 현대 국어 사용 빈도 조사 2; adds "
        "corpus frequency, difficulty_rank, and the 6 reading levels",
    )
    parser.add_argument(
        "--korean-only",
        action="store_true",
        help="Refresh only korean_nikl_vocab in an existing --output DB "
        "(skips the English/HSK sources)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "proficiency_levels.db",
        help="Output SQLite database path",
    )
    return parser.parse_args()


def file_sha256(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def build_korean(args: argparse.Namespace) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Load the Korean rows and their metadata (shared by both build paths)."""
    korean_path = args.korean_hanja_db.expanduser().resolve()
    if not korean_path.exists():
        raise FileNotFoundError(korean_path)

    frequency: dict[str, int] = {}
    korean_freq_path: Path | None = None
    if args.korean_freq is not None:
        korean_freq_path = args.korean_freq.expanduser().resolve()
        if not korean_freq_path.exists():
            raise FileNotFoundError(korean_freq_path)
        frequency = load_korean_frequency(korean_freq_path)

    korean_rows, korean_stats = load_korean_rows(korean_path, frequency)

    korean_metadata = {
        "korean_source_file": korean_path.name,
        "korean_source_sha256": file_sha256(korean_path),
        "korean_grade_system": "nikl_graded_vocab",
        "korean_system": "noeul_reading_levels",
        "korean_freq_source_file": korean_freq_path.name if korean_freq_path else None,
        "korean_freq_source_sha256": (
            file_sha256(korean_freq_path) if korean_freq_path else None
        ),
        "korean_stats": korean_stats,
        "korean_lookup_distribution": level_distribution(korean_rows, "nikl_grade"),
        "korean_reading_level_distribution": korean_stats["korean_reading_level_distribution"],
    }
    return korean_rows, korean_metadata


def print_korean_summary(korean_metadata: dict[str, Any]) -> None:
    stats = korean_metadata["korean_stats"]
    print(f"korean_lookup_rows: {stats['korean_lookup_rows']}")
    print(f"korean_frequency_coverage: {stats['korean_frequency_coverage']}")
    print(f"korean_grade_conflicts: {stats['korean_grade_conflicts']}")
    print(f"korean_grade_medians: {stats['korean_grade_medians']}")
    print(f"korean_lookup_distribution: {korean_metadata['korean_lookup_distribution']}")
    print(f"korean_reading_level_distribution: {stats['korean_reading_level_distribution']}")


def main() -> int:
    args = parse_args()
    output_path = args.output.expanduser().resolve()

    korean_rows, korean_metadata = build_korean(args)

    if args.korean_only:
        update_korean_only(output_path, korean_rows, korean_metadata)
        print(f"Refreshed korean_nikl_vocab in {output_path}")
        print_korean_summary(korean_metadata)
        return 0

    if args.english_xls is None or args.hsk_json is None:
        raise SystemExit(
            "--english-xls and --hsk-json are required for a full rebuild "
            "(use --korean-only to refresh just the Korean table)"
        )

    english_path = args.english_xls.expanduser().resolve()
    hsk_path = args.hsk_json.expanduser().resolve()
    if not english_path.exists():
        raise FileNotFoundError(english_path)
    if not hsk_path.exists():
        raise FileNotFoundError(hsk_path)

    english_rows, english_fallback_rows, english_stats = load_english_rows(english_path)
    hsk_rows, hsk_stats = load_hsk_rows(hsk_path)

    metadata = {
        "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "schema_version": 3,
        "english_source_file": english_path.name,
        "english_source_sha256": file_sha256(english_path),
        "hsk_source_file": hsk_path.name,
        "hsk_source_sha256": file_sha256(hsk_path),
        "hsk_system": "new",
        "english_stats": english_stats,
        "hsk_stats": hsk_stats,
        "english_cefr_distribution": level_distribution(english_rows, "cefr_level"),
        "english_fallback_distribution": level_distribution(english_fallback_rows, "cefr_level"),
        "hsk_lookup_distribution": level_distribution(hsk_rows, "hsk_level"),
        **korean_metadata,
    }

    write_database(output_path, english_rows, english_fallback_rows, hsk_rows, korean_rows, metadata)

    print(f"Wrote {output_path}")
    print(f"english_cefr_distribution: {metadata['english_cefr_distribution']}")
    print(f"hsk_lookup_distribution: {metadata['hsk_lookup_distribution']}")
    print_korean_summary(korean_metadata)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
