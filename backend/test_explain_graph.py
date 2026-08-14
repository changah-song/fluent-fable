"""Tests for the agentic explain-in-context workflow (explain_graph.py).

The pure helpers run everywhere. The graph tests need ``langgraph`` installed and
are skipped otherwise; they inject a fake model caller, so no network/API key is
required.
"""

import pytest

import explain_graph as g


# ─── Pure helpers (no langgraph needed) ───────────────────────────────────────


def test_p_known_matches_sigmoid_of_theta_minus_difficulty():
    # theta well above difficulty -> very likely known
    assert g.p_known_for(3.0, -3.0) > 0.99
    # theta well below difficulty -> very likely unknown
    assert g.p_known_for(-3.0, 3.0) < 0.01
    # equal -> 0.5
    assert g.p_known_for(0.0, 0.0) == pytest.approx(0.5)


@pytest.mark.parametrize("theta,diff,expected", [
    (None, None, g.FAMILIARITY_UNKNOWN),
    (1.0, None, g.FAMILIARITY_UNKNOWN),   # one signal missing -> unknown
    (2.0, -2.0, g.FAMILIARITY_FAMILIAR),
    (-2.0, 2.0, g.FAMILIARITY_UNFAMILIAR),
    (0.2, 0.0, g.FAMILIARITY_PARTIAL),
])
def test_familiarity_bucket_for(theta, diff, expected):
    assert g.familiarity_bucket_for(theta, diff) == expected


def test_familiarity_from_p_known_boundaries():
    assert g.familiarity_from_p_known(None) == g.FAMILIARITY_UNKNOWN
    assert g.familiarity_from_p_known(0.0) == g.FAMILIARITY_UNFAMILIAR
    assert g.familiarity_from_p_known(0.5) == g.FAMILIARITY_PARTIAL
    assert g.familiarity_from_p_known(0.99) == g.FAMILIARITY_FAMILIAR


def test_bool_is_not_treated_as_a_number():
    # Guards against Python's bool-is-int trap poisoning grounding.
    assert g.p_known_for(True, False) is None


def test_parse_contextual_explanation_tagged():
    parsed = g.parse_contextual_explanation(
        "<lemma>가다</lemma><gloss>to go</gloss><explanation>Here it means to leave.</explanation>"
    )
    assert parsed == {"lemma": "가다", "gloss": "to go", "explanation": "Here it means to leave."}


def test_parse_contextual_explanation_untagged_fallback():
    parsed = g.parse_contextual_explanation("just a blob of text")
    assert parsed["explanation"] == "just a blob of text"
    assert parsed["lemma"] is None and parsed["gloss"] is None


def test_grounded_prompt_layers_in_hints():
    prompt = g.build_grounded_prompt(
        target_language_name="Korean",
        interface_language_name="English",
        familiarity=g.FAMILIARITY_FAMILIAR,
        hanja="學校",
        anchor_words=[{"word": "학생", "gloss": "student"}],
        issues=["the <gloss> is longer than 5 words"],
    )
    assert "already knows" in prompt          # familiarity guidance
    assert "學校" in prompt                    # hanja bridge
    assert "학생 (student)" in prompt          # anchor word
    assert "previous attempt" in prompt       # refine issues
    assert "<lemma>" in prompt and "<gloss>" in prompt and "<explanation>" in prompt


def test_grounded_prompt_collapses_without_hints():
    prompt = g.build_grounded_prompt(
        target_language_name="Korean",
        interface_language_name="English",
        familiarity=g.FAMILIARITY_UNKNOWN,
    )
    assert "already knows" not in prompt
    assert "previous attempt" not in prompt
    assert "<explanation>" in prompt


# ─── Graph workflow (needs langgraph) ─────────────────────────────────────────

pytest.importorskip("langgraph", reason="langgraph not installed")

GOOD = (
    "<lemma>가다</lemma><gloss>to go</gloss>"
    "<explanation>Here 갔어 is the past tense of 가다; she left.</explanation>"
)
BAD_GLOSS = (
    "<lemma>가다</lemma><gloss>to go somewhere far over there</gloss>"
    "<explanation>It means to leave, past tense.</explanation>"
)
MISSING_LEMMA = "<gloss>to go</gloss><explanation>It means to leave here.</explanation>"


def _scripted_caller(outputs):
    """Return (caller, calls). Yields `outputs` in order; records each prompt."""
    calls = []
    it = iter(outputs)

    def caller(system, user):
        calls.append({"system": system, "user": user})
        return next(it), {"input_tokens": 100, "output_tokens": 50}

    return caller, calls


def _run(caller, **kwargs):
    graph = g.build_explain_graph(caller)
    return g.run_explain_graph(
        graph,
        word=kwargs.pop("word", "갔어"),
        sentence=kwargs.pop("sentence", "그녀는 갔어."),
        target_language_name="Korean",
        interface_language_name="English",
        **kwargs,
    )


def test_happy_path_single_call():
    caller, calls = _scripted_caller([GOOD])
    result = _run(caller, p_known=0.9)
    assert result["lemma"] == "가다"
    assert result["gloss"] == "to go"
    assert result["familiarity"] == g.FAMILIARITY_FAMILIAR
    assert len(calls) == 1
    assert len(result["usages"]) == 1


def test_bad_gloss_triggers_one_refine_with_issue_fed_back():
    caller, calls = _scripted_caller([BAD_GLOSS, GOOD])
    result = _run(caller, p_known=0.1)
    assert len(calls) == 2
    assert result["gloss"] == "to go"
    assert "previous attempt" in calls[1]["system"].lower()
    assert "gloss" in calls[1]["system"].lower()


def test_refine_is_capped():
    # Model never fixes the gloss; the graph must still stop after one refine.
    caller, calls = _scripted_caller([BAD_GLOSS, BAD_GLOSS, GOOD])
    _run(caller)
    assert len(calls) == g.REFINE_MAX_ATTEMPTS + 1


def test_missing_lemma_is_refined():
    caller, calls = _scripted_caller([MISSING_LEMMA, GOOD])
    result = _run(caller)
    assert len(calls) == 2
    assert "lemma" in calls[1]["system"].lower()
    assert result["lemma"] == "가다"


def test_direct_p_known_overrides_theta():
    caller, _ = _scripted_caller([GOOD])
    result = _run(caller, p_known=0.1, theta=3.0, word_difficulty=-3.0)
    assert result["familiarity"] == g.FAMILIARITY_UNFAMILIAR


def test_grounding_injected_into_draft_prompt():
    caller, calls = _scripted_caller([GOOD])
    _run(
        caller,
        word="학교",
        sentence="학교에 갔어.",
        p_known=0.5,
        hanja="學校",
        anchor_words=[{"word": "학생", "gloss": "student"}],
    )
    system = calls[0]["system"]
    assert "學校" in system
    assert "학생" in system and "student" in system
