"""Agentic explain-in-context workflow (LangGraph).

A multi-step replacement for the single-shot `/explain_in_context/` model call.
The graph:

    ground -> draft -> verify -> (refine -> verify)? -> END

- ``ground``  Deterministic, no model spend. Turns the learner's ability
              (``theta``) and the tapped word's ``word_difficulty`` into a
              P(known) familiarity bucket, and carries the grounding hints
              (hanja bridge, known-word anchors) forward.
- ``draft``   One model call. Emits the ``<lemma>/<gloss>/<explanation>``
              contract, calibrated to the learner's familiarity and grounded in
              the hints.
- ``verify``  Deterministic checks (no model spend) — required tags present, the
              flashcard gloss is short enough, explanation is non-trivial.
- ``refine``  At most ``REFINE_MAX_ATTEMPTS`` follow-up model calls, fed the
              verifier's issues, to fix a bad draft.

The module is transport-agnostic: the caller injects ``model_caller`` (see
``build_explain_graph``), so the graph has no dependency on the Anthropic SDK or
FastAPI and can be unit-tested with a fake caller. ``langgraph`` is imported
lazily inside ``build_explain_graph`` so that importing this module (for the
pure helpers below) never requires the dependency to be installed.
"""

from __future__ import annotations

import math
import re
from typing import Any, Callable, TypedDict

# A model call: (system_prompt, user_message) -> (raw_text, usage_or_None).
# ``usage`` is whatever the transport wants to hand back for spend accounting;
# the graph only collects it, never inspects it.
ModelCaller = Callable[[str, str], "tuple[str, Any]"]

# One draft + at most this many refine passes. Caps worst-case model spend per
# lookup at REFINE_MAX_ATTEMPTS + 1 calls.
REFINE_MAX_ATTEMPTS = 1

# P(known) cut points for the familiarity buckets. Kept coarse (3 live buckets)
# so they double as a low-cardinality cache-key dimension without shredding the
# hit rate. ``"unknown"`` is a fourth bucket used only when we have no ability
# signal at all (behaves like the pre-grounding prompt).
_UNFAMILIAR_MAX = 0.35
_PARTIAL_MAX = 0.70

FAMILIARITY_UNKNOWN = "unknown"
FAMILIARITY_UNFAMILIAR = "unfamiliar"
FAMILIARITY_PARTIAL = "partial"
FAMILIARITY_FAMILIAR = "familiar"

_EXPLAIN_TAG_PATTERN = {
    tag: re.compile(rf"<{tag}>(.*?)</{tag}>", re.DOTALL | re.IGNORECASE)
    for tag in ("lemma", "gloss", "explanation")
}

# A gloss is meant to be a <=5-word flashcard label. We only flag space-delimited
# glosses (CJK glosses have no spaces and are exempt) and allow a little slack.
_MAX_GLOSS_WORDS = 6


def _sigmoid(x: float) -> float:
    # Matches abilityModel.js `sigmoid`; clamped domain avoids overflow warnings.
    return 1.0 / (1.0 + math.exp(-max(-60.0, min(60.0, x))))


def p_known_for(theta: Any, word_difficulty: Any) -> float | None:
    """P(known) for the tapped word, or None when either signal is missing.

    Mirrors abilityModel.js `pKnown(theta, difficulty)` = sigmoid(theta - d).
    """
    if not isinstance(theta, (int, float)) or isinstance(theta, bool):
        return None
    if not isinstance(word_difficulty, (int, float)) or isinstance(word_difficulty, bool):
        return None
    return _sigmoid(float(theta) - float(word_difficulty))


def familiarity_bucket_for(theta: Any, word_difficulty: Any) -> str:
    """Coarse familiarity bucket. Also used by the endpoint as a cache-key part."""
    return familiarity_from_p_known(p_known_for(theta, word_difficulty))


def familiarity_from_p_known(p_known: float | None) -> str:
    if p_known is None:
        return FAMILIARITY_UNKNOWN
    if p_known < _UNFAMILIAR_MAX:
        return FAMILIARITY_UNFAMILIAR
    if p_known < _PARTIAL_MAX:
        return FAMILIARITY_PARTIAL
    return FAMILIARITY_FAMILIAR


def parse_contextual_explanation(raw: str) -> dict[str, str | None]:
    """Pull the <lemma>/<gloss>/<explanation> fields out of the model output.

    Falls back gracefully: if the model ignored the tag format, the whole
    response is treated as the explanation with no lemma/gloss, preserving the
    original single-blob contract.
    """
    fields = {
        tag: (match.group(1).strip() if (match := pattern.search(raw)) else "")
        for tag, pattern in _EXPLAIN_TAG_PATTERN.items()
    }
    explanation = fields["explanation"] or (raw or "").strip()
    return {
        "explanation": explanation,
        "gloss": fields["gloss"] or None,
        "lemma": fields["lemma"] or None,
    }


# ─── Prompt construction ──────────────────────────────────────────────────────

_FAMILIARITY_GUIDANCE = {
    FAMILIARITY_UNFAMILIAR: (
        "The learner very likely does NOT know this word yet. Explain it plainly "
        "and assume no prior familiarity."
    ),
    FAMILIARITY_PARTIAL: (
        "The learner may partly know this word. Confirm its core meaning briefly, "
        "then spend most of the explanation on its specific sense in this sentence."
    ),
    FAMILIARITY_FAMILIAR: (
        "The learner very likely already knows this word's basic meaning. Skip the "
        "basics and focus on the nuance or specific sense it carries in THIS sentence."
    ),
}

_TAG_CONTRACT = """Reply with exactly these three tags in this order and nothing else — no preamble, labels, quotes, or markdown:

<lemma>The dictionary base form of the tapped word, in {target}: strip conjugation, inflected endings, and attached particles. If it is already the base form, repeat it. Base form only.</lemma>
<gloss>A clean standalone definition in {interface}, at most 5 words, no full sentence. This is saved as the learner's flashcard.</gloss>
<explanation>2-4 short sentences in {interface} on the word as used in this sentence: its specific sense here; if the surface form differs from the base form, what the ending or inflection adds; any nuance it carries. Stay concrete and tied to this sentence — not a generic dictionary entry.</explanation>"""


def build_grounded_prompt(
    *,
    target_language_name: str,
    interface_language_name: str,
    familiarity: str,
    hanja: str | None = None,
    anchor_words: list[dict] | None = None,
    dictionary_found: bool | None = None,
    dictionary_senses: list[dict] | None = None,
    issues: list[str] | None = None,
) -> str:
    """System prompt for the draft/refine nodes, layered with grounding.

    Grounding lines are additive and each is safe to omit, so the prompt collapses
    to the original ungrounded instruction when no signals are available.
    """
    lines = [
        f"You are an expert {target_language_name} tutor. A learner reading "
        f"{target_language_name} tapped a word or phrase and wants its meaning "
        "*in this sentence*, not just the dictionary definition.",
    ]

    guidance = _FAMILIARITY_GUIDANCE.get(familiarity)
    if guidance:
        lines.append(guidance)

    if hanja and str(hanja).strip():
        lines.append(
            f"This word is written with the characters {str(hanja).strip()}. Where it "
            "aids understanding, briefly connect the meaning to those characters."
        )

    anchors = _format_anchor_words(anchor_words)
    if anchors:
        lines.append(
            "The learner already knows these related words: "
            f"{anchors}. Where it is natural, anchor the explanation to one of them "
            "(e.g. \"like X, but ...\"). Never force a connection that is not real."
        )

    # Dictionary grounding. The client already looked this word up on-device, so
    # we reuse that result rather than re-querying: pass the senses it found, or
    # tell the model the dictionary came up empty. Two branches, matching why a
    # learner reaches for the AI explanation in the first place — either the
    # dictionary entry exists but its fit is unclear, or there is no entry at all.
    senses = _format_senses(dictionary_senses)
    if senses:
        lines.append(
            "The dictionary lists these senses for this word:\n"
            f"{senses}\n"
            "Pick the sense that fits THIS sentence and explain how it applies. "
            "If none of them fit, say so plainly and explain the actual meaning "
            "from context — the dictionary can be incomplete or wrong."
        )
    elif dictionary_found is False:
        lines.append(
            "This word is NOT in the dictionary — it may be slang, archaic, a "
            "rare or dialectal form, a proper noun, or a coinage. Explain it from "
            "the sentence context, and briefly note that it isn't a standard "
            "dictionary entry."
        )

    if issues:
        lines.append(
            "A previous attempt had these problems: "
            + "; ".join(str(issue) for issue in issues if issue)
            + ". Produce a corrected version that fixes them."
        )

    lines.append(
        _TAG_CONTRACT.format(target=target_language_name, interface=interface_language_name)
    )
    return "\n\n".join(lines)


def _format_anchor_words(anchor_words: list[dict] | None, limit: int = 4) -> str:
    if not anchor_words:
        return ""
    formatted = []
    for item in anchor_words[:limit]:
        if not isinstance(item, dict):
            continue
        word = str(item.get("word") or item.get("lemma") or "").strip()
        if not word:
            continue
        gloss = str(item.get("gloss") or "").strip()
        formatted.append(f"{word} ({gloss})" if gloss else word)
    return ", ".join(formatted)


def _format_senses(dictionary_senses: list[dict] | None, limit: int = 6) -> str:
    """Render the client's already-fetched dictionary senses as a numbered list.

    Each sense is ``{headword, pos, definition}`` (all optional). Senses with no
    definition carry no meaning, so they are skipped; an all-empty list returns
    "" and the prompt's dictionary block collapses.
    """
    if not dictionary_senses:
        return ""
    lines: list[str] = []
    for item in dictionary_senses:
        if not isinstance(item, dict):
            continue
        definition = str(item.get("definition") or "").strip()
        if not definition:
            continue
        pos = str(item.get("pos") or "").strip()
        prefix = f"[{pos}] " if pos else ""
        lines.append(f"{len(lines) + 1}) {prefix}{definition}")
        if len(lines) >= limit:
            break
    return "\n".join(lines)


# ─── Graph state + nodes ──────────────────────────────────────────────────────


class ExplainState(TypedDict, total=False):
    # Inputs
    word: str
    sentence: str
    target_language_name: str
    interface_language_name: str
    theta: float | None
    word_difficulty: float | None
    hanja: str | None
    anchor_words: list[dict]
    # Dictionary result the client already fetched on-device (reused, not re-queried).
    dictionary_found: bool | None
    dictionary_senses: list[dict]
    # Derived by ``ground``
    p_known: float | None
    familiarity: str
    # Working state
    attempts: int
    issues: list[str]
    lemma: str | None
    gloss: str | None
    explanation: str | None
    # Spend accounting (one entry per model call)
    usages: list


def _user_message(state: ExplainState) -> str:
    return f"Word: {state.get('word', '')}\n\nSentence: {state.get('sentence', '')}"


def _ground_node(state: ExplainState) -> dict:
    # Prefer a P(known) the client computed directly (its cached per-word value);
    # otherwise derive it from ability + difficulty. Either way, absent signals
    # collapse to the "unknown" bucket and the ungrounded prompt.
    p_known = state.get("p_known")
    if not isinstance(p_known, (int, float)) or isinstance(p_known, bool):
        p_known = p_known_for(state.get("theta"), state.get("word_difficulty"))
    return {
        "p_known": p_known,
        "familiarity": familiarity_from_p_known(p_known),
        "attempts": 0,
        "issues": [],
        "usages": [],
    }


def _verify_issues(state: ExplainState) -> list[str]:
    issues: list[str] = []
    if not (state.get("lemma") or "").strip():
        issues.append("missing the <lemma> base form")
    gloss = (state.get("gloss") or "").strip()
    if not gloss:
        issues.append("missing the <gloss> flashcard label")
    elif " " in gloss and len(gloss.split()) > _MAX_GLOSS_WORDS:
        issues.append("the <gloss> is longer than 5 words; make it a short label")
    explanation = (state.get("explanation") or "").strip()
    if len(explanation) < 10:
        issues.append("the <explanation> is empty or too short")
    return issues


def _verify_node(state: ExplainState) -> dict:
    return {"issues": _verify_issues(state)}


def _route_after_verify(state: ExplainState) -> str:
    issues = state.get("issues") or []
    if issues and int(state.get("attempts", 0)) <= REFINE_MAX_ATTEMPTS:
        return "refine"
    return "end"


def build_explain_graph(model_caller: ModelCaller):
    """Compile the explain-in-context graph.

    ``model_caller(system, user) -> (raw_text, usage)`` is injected so this module
    stays free of any SDK/HTTP dependency. ``langgraph`` is imported here (not at
    module load) so the pure helpers above remain importable without it.
    """
    from langgraph.graph import END, StateGraph

    def _generate(state: ExplainState, *, issues: list[str] | None) -> dict:
        system_prompt = build_grounded_prompt(
            target_language_name=state.get("target_language_name", ""),
            interface_language_name=state.get("interface_language_name", ""),
            familiarity=state.get("familiarity", FAMILIARITY_UNKNOWN),
            hanja=state.get("hanja"),
            anchor_words=state.get("anchor_words"),
            dictionary_found=state.get("dictionary_found"),
            dictionary_senses=state.get("dictionary_senses"),
            issues=issues,
        )
        raw, usage = model_caller(system_prompt, _user_message(state))
        parsed = parse_contextual_explanation(raw or "")
        return {
            "lemma": parsed["lemma"],
            "gloss": parsed["gloss"],
            "explanation": parsed["explanation"],
            "attempts": int(state.get("attempts", 0)) + 1,
            "usages": [*(state.get("usages") or []), usage],
        }

    def _draft_node(state: ExplainState) -> dict:
        return _generate(state, issues=None)

    def _refine_node(state: ExplainState) -> dict:
        return _generate(state, issues=state.get("issues"))

    graph = StateGraph(ExplainState)
    graph.add_node("ground", _ground_node)
    graph.add_node("draft", _draft_node)
    graph.add_node("verify", _verify_node)
    graph.add_node("refine", _refine_node)

    graph.set_entry_point("ground")
    graph.add_edge("ground", "draft")
    graph.add_edge("draft", "verify")
    graph.add_conditional_edges("verify", _route_after_verify, {"refine": "refine", "end": END})
    graph.add_edge("refine", "verify")

    return graph.compile()


def run_explain_graph(
    graph,
    *,
    word: str,
    sentence: str,
    target_language_name: str,
    interface_language_name: str,
    p_known: Any = None,
    theta: Any = None,
    word_difficulty: Any = None,
    hanja: str | None = None,
    anchor_words: list[dict] | None = None,
    dictionary_found: bool | None = None,
    dictionary_senses: list[dict] | None = None,
) -> dict:
    """Invoke the compiled graph and return the parsed result + spend usages.

    ``p_known`` (0..1) is the preferred familiarity signal; when absent it is
    derived from ``theta`` and ``word_difficulty``. ``dictionary_found`` /
    ``dictionary_senses`` carry the on-device lookup the client already did:
    senses ground the model toward the right meaning, and ``found=False`` tells
    it the word is not a standard dictionary entry. Returns
    ``{lemma, gloss, explanation, familiarity, usages}`` — ``usages`` holds one
    entry per model call so the caller can record spend for each.
    """
    final: ExplainState = graph.invoke(
        {
            "word": word,
            "sentence": sentence,
            "target_language_name": target_language_name,
            "interface_language_name": interface_language_name,
            "p_known": p_known,
            "theta": theta,
            "word_difficulty": word_difficulty,
            "hanja": hanja,
            "anchor_words": anchor_words or [],
            "dictionary_found": dictionary_found,
            "dictionary_senses": dictionary_senses or [],
        }
    )
    return {
        "lemma": final.get("lemma"),
        "gloss": final.get("gloss"),
        "explanation": final.get("explanation"),
        "familiarity": final.get("familiarity", FAMILIARITY_UNKNOWN),
        "usages": final.get("usages") or [],
    }
