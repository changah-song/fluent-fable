import {
  SELF_REPORT_DECAY_EVENTS,
  difficultyFromLevelRank,
  difficultyFromPercentile,
} from './abilityModel';
import { normalizeBookLanguage } from '../constants/languages';

// ─── Feature assembly (Phase 4.1) ─────────────────────────────────────────────
//
// Produces a feature vector for any (user, word) pair, organized by the design
// doc §3 recommender taxonomy (knowledge-based → content-item → content-user →
// SRS state → explicit signals). This is the input the Phase 4.2 pooled model
// (logistic / XGBoost) will consume; the single-factor IRT baseline (Phase 2–3)
// used only theta and difficulty, two of these features.
//
// GOVERNING RULE (plan §4.1 acceptance): missing features are handled EXPLICITLY,
// never silently zero. Every feature is returned as
//     { value, present, family, note? }
// so a downstream model can mask absent features instead of learning from a fake
// 0. A feature can be absent for three distinct reasons, all recorded in `note`:
//   - 'deferred:phaseN'  — the data source isn't built yet (dwell/reading speed →
//                          Phase 6; hanja confirmation → Phase 8);
//   - 'capped:tier4'     — computable but incomplete until bound-root morpheme
//                          decomposition lands (cross-word transfer);
//   - simply no data for this word/user yet (unsaved word → no SRS state).
//
// This module is PURE (no SQLite/clock): the caller gathers raw rows and passes a
// `now` timestamp. Persistence + batch gathering live in Database.js
// (`assembleWordFeatures`).

// Half-life (days) for recency-decayed explicit signals. Design doc §3: "a word
// saved 8 months ago and never reviewed should NOT be treated as confidently
// known today." ~60d half-life ⇒ an 8-month-old save decays to <5% weight.
export const RECENCY_HALF_LIFE_DAYS = 60;

const HANGUL_SYLLABLE = /[가-힣]/g;      // composed Hangul blocks
const CJK_IDEOGRAPH = /[一-鿿㐀-䶿]/g;
const LATIN = /[A-Za-z]/;
const ENGLISH_VOWEL_GROUP = /[aeiouy]+/gi;

const feat = (value, present, family, note) => {
  const f = { value: present ? value : null, present, family };
  if (note) f.note = note;
  return f;
};
const absent = (family, note) => feat(null, false, family, note);

const countMatches = (text, regex) => {
  if (typeof text !== 'string' || !text) return 0;
  const m = text.match(regex);
  return m ? m.length : 0;
};

/**
 * countSyllables — language-aware syllable count.
 *   ko: one per composed Hangul block; zh: one per CJK ideograph;
 *   en: vowel-group heuristic (approximate — flagged by the caller);
 *   fallback: character length.
 */
export const countSyllables = (language, word) => {
  const lang = normalizeBookLanguage(language) || 'ko';
  const w = typeof word === 'string' ? word.trim() : '';
  if (!w) return 0;
  if (lang === 'ko') return countMatches(w, HANGUL_SYLLABLE) || w.length;
  if (lang === 'zh') return countMatches(w, CJK_IDEOGRAPH) || w.length;
  if (lang === 'en') return Math.max(1, countMatches(w, ENGLISH_VOWEL_GROUP));
  return w.length;
};

/**
 * classifyWordOrigin — native / Sino / loan classification. This is a Korean
 * concept (native Korean vs. Sino-Korean vs. loanword), so it only applies to ko;
 * other languages return null so the caller marks it absent rather than guessing.
 *   has hanja spelling      → 'sino'
 *   contains Latin letters   → 'loan' (transliterated foreign word)
 *   otherwise (pure Hangul)  → 'native'
 */
export const classifyWordOrigin = (language, { stem, hanja } = {}) => {
  const lang = normalizeBookLanguage(language) || 'ko';
  if (lang !== 'ko') return null;
  if (typeof hanja === 'string' && hanja.trim()) return 'sino';
  if (typeof stem === 'string' && LATIN.test(stem)) return 'loan';
  return 'native';
};

/**
 * hanjaDensity — fraction of a word's syllables backed by a hanja (Chinese)
 * character. ko: (# hanja chars in the hanja spelling) / (syllable count). zh: the
 * word IS hanja, so 1. en: not applicable (null).
 */
export const hanjaDensity = (language, { stem, hanja } = {}) => {
  const lang = normalizeBookLanguage(language) || 'ko';
  if (lang === 'zh') return 1;
  if (lang !== 'ko') return null;
  const hanjaChars = countMatches(hanja, CJK_IDEOGRAPH);
  if (!hanjaChars) return 0;
  const syllables = countSyllables('ko', stem) || hanjaChars;
  return Math.min(1, hanjaChars / syllables);
};

/**
 * recencyDecay — a value in (0, 1] that halves every RECENCY_HALF_LIFE_DAYS.
 * days ≤ 0 (just now / unknown-future) → 1; older → smaller.
 */
export const recencyDecay = (days, halfLifeDays = RECENCY_HALF_LIFE_DAYS) => {
  const d = Number(days);
  if (!Number.isFinite(d) || d <= 0) return 1;
  return Math.pow(0.5, d / halfLifeDays);
};

/**
 * hanjaOverlapFraction — fraction of a word's hanja characters the user has
 * independently demonstrated (they appear in another word the user knows). The
 * §3 "cross-word / morphological transfer" feature — the highest-leverage
 * cold-start signal for Korean. CAPPED until Tier 4 bound-root decomposition:
 * today it's character-level hanja overlap only, not full morpheme overlap.
 */
export const hanjaOverlapFraction = (hanja, knownHanjaSet) => {
  const chars = typeof hanja === 'string' ? hanja.match(CJK_IDEOGRAPH) : null;
  if (!chars || chars.length === 0) return null;
  if (!knownHanjaSet || knownHanjaSet.size === 0) return 0;
  const overlap = chars.filter((c) => knownHanjaSet.has(c)).length;
  return overlap / chars.length;
};

const daysBetween = (fromIso, nowMs) => {
  const t = new Date(fromIso).getTime();
  if (!Number.isFinite(t)) return null;
  return (nowMs - t) / 86400000;
};

// Count distinct senses in a cached definition, best-effort. Cache formats vary,
// so this is conservative: a JSON array counts its entries; a numbered-sense
// string ("1. … 2. …") counts the markers; anything else is left absent rather
// than asserting a fake polysemy of 1.
const countPolysemy = (definition) => {
  if (typeof definition !== 'string' || !definition.trim()) return null;
  const text = definition.trim();
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.length || null;
  } catch (_) {
    // not JSON; fall through to the numbered-sense heuristic
  }
  const numbered = text.match(/(^|\s)\d+[.)]\s/g);
  if (numbered && numbered.length >= 2) return numbered.length;
  return null;
};

/**
 * assembleFeatures — build the full feature record for one (user, word) pair.
 *
 * @param {object} raw
 * @param {string} raw.language
 * @param {string} raw.stem
 * @param {string} [raw.l1]        the user's L1 / interface language
 * @param {object} [raw.dict]      dictionary_cache row: { pos, hanja, level_rank, definition }
 * @param {object} [raw.ability]   profile_ability row: { theta, self_report_rank, event_count }
 * @param {object} [raw.vocab]     vocab row if saved: { stability, difficulty, correct_count,
 *                                  wrong_count, last_reviewed_at, next_review_at, updated_at }
 * @param {number} [raw.inBookFreq]   in-book occurrence proxy, or null/undefined if unknown
 * @param {object} [raw.events]    aggregates: { reviewCount, lookupCount, lastLookupAt }
 * @param {Set}    [raw.knownHanjaSet]  hanja chars the user knows from other words
 * @param {number} [raw.now]       epoch ms (defaults to Date.now for convenience)
 * @returns {Object<string, {value, present, family, note?}>}
 */
export const assembleFeatures = (raw = {}) => {
  const language = normalizeBookLanguage(raw.language) || 'ko';
  const stem = typeof raw.stem === 'string' ? raw.stem.trim() : '';
  const dict = raw.dict ?? null;
  const ability = raw.ability ?? null;
  const vocab = raw.vocab ?? null;
  const events = raw.events ?? {};
  const now = Number.isFinite(raw.now) ? raw.now : Date.now();

  const F = {};

  // ── Knowledge-based (pure prior; no behavior needed) ────────────────────────
  const levelRank = dict && dict.level_rank != null ? Number(dict.level_rank) : null;
  const difficultyPercentile = dict && dict.difficulty_percentile != null
    ? Number(dict.difficulty_percentile)
    : null;
  F.kb_level_rank = levelRank != null
    ? feat(levelRank, true, 'knowledge')
    : absent('knowledge');
  // Difficulty is always defined; `note` flags which source it came from so
  // calibration can segment. Prefer the CONTINUOUS corpus-frequency percentile
  // (every graded word distinct → orders words within a band); fall back to the
  // coarser level band; OOV when the word is ungraded entirely.
  const hasContinuousDifficulty = Number.isFinite(difficultyPercentile);
  F.kb_difficulty = feat(
    hasContinuousDifficulty
      ? difficultyFromPercentile(difficultyPercentile)
      : difficultyFromLevelRank(language, levelRank),
    true,
    'knowledge',
    hasContinuousDifficulty
      ? undefined
      : (levelRank == null ? 'fallback:oov' : 'band-only')
  );
  F.kb_word_length = stem
    ? feat(stem.length, true, 'knowledge')
    : absent('knowledge');
  F.kb_syllable_count = stem
    ? feat(countSyllables(language, stem), true, 'knowledge', language === 'en' ? 'approx' : undefined)
    : absent('knowledge');

  const origin = classifyWordOrigin(language, { stem, hanja: dict?.hanja });
  if (origin) {
    F.kb_origin_native = feat(origin === 'native' ? 1 : 0, true, 'knowledge');
    F.kb_origin_sino = feat(origin === 'sino' ? 1 : 0, true, 'knowledge');
    F.kb_origin_loan = feat(origin === 'loan' ? 1 : 0, true, 'knowledge');
  } else {
    F.kb_origin_native = absent('knowledge', 'ko-only');
    F.kb_origin_sino = absent('knowledge', 'ko-only');
    F.kb_origin_loan = absent('knowledge', 'ko-only');
  }

  // ── Content-based: item (word) features ─────────────────────────────────────
  F.item_pos = dict && dict.pos
    ? feat(String(dict.pos), true, 'item')
    : absent('item');
  const density = hanjaDensity(language, { stem, hanja: dict?.hanja });
  F.item_hanja_density = density == null
    ? absent('item', 'ko-zh-only')
    : feat(density, true, 'item');
  const polysemy = countPolysemy(dict?.definition);
  F.item_polysemy_count = polysemy == null
    ? absent('item')
    : feat(polysemy, true, 'item', 'proxy');
  // Homophone collision risk needs a pronunciation-keyed index we don't have yet.
  F.item_homophone_risk = absent('item', 'deferred:no-homophone-index');
  F.item_in_book_freq = raw.inBookFreq != null && Number.isFinite(Number(raw.inBookFreq))
    ? feat(Number(raw.inBookFreq), true, 'item', 'proxy:distinct-surfaces')
    : absent('item');
  const overlap = hanjaOverlapFraction(dict?.hanja, raw.knownHanjaSet);
  F.item_cross_hanja_overlap = overlap == null
    ? absent('item', 'no-hanja')
    : feat(overlap, true, 'item', 'capped:tier4');

  // ── Content-based: user features ────────────────────────────────────────────
  F.user_theta = ability && Number.isFinite(Number(ability.theta))
    ? feat(Number(ability.theta), true, 'user')
    : absent('user');
  F.user_self_report_rank = ability && ability.self_report_rank != null
    ? feat(Number(ability.self_report_rank), true, 'user')
    : absent('user');
  const eventCount = ability && Number.isFinite(Number(ability.event_count))
    ? Number(ability.event_count)
    : null;
  F.user_event_count = eventCount != null
    ? feat(eventCount, true, 'user')
    : absent('user');
  // Decaying self-report weight (design doc §2): 1 → 0 over N behavioral events.
  F.user_self_report_weight = eventCount != null
    ? feat(Math.max(0, 1 - eventCount / SELF_REPORT_DECAY_EVENTS), true, 'user')
    : absent('user');
  F.user_l1 = raw.l1
    ? feat(String(raw.l1), true, 'user')
    : absent('user');
  F.user_reading_speed = absent('user', 'deferred:phase6');

  // ── SRS state (only meaningful once the word is a saved card) ────────────────
  const saved = !!vocab;
  F.srs_saved = feat(saved ? 1 : 0, true, 'srs');
  if (saved) {
    F.srs_stability = Number.isFinite(Number(vocab.stability))
      ? feat(Number(vocab.stability), true, 'srs') : absent('srs');
    F.srs_difficulty = Number.isFinite(Number(vocab.difficulty))
      ? feat(Number(vocab.difficulty), true, 'srs') : absent('srs');
    F.srs_correct_count = feat(Number(vocab.correct_count) || 0, true, 'srs');
    F.srs_wrong_count = feat(Number(vocab.wrong_count) || 0, true, 'srs');
    const sinceReview = daysBetween(vocab.last_reviewed_at, now);
    F.srs_days_since_review = sinceReview != null
      ? feat(Math.max(0, sinceReview), true, 'srs') : absent('srs', 'never-reviewed');
    const overdue = daysBetween(vocab.next_review_at, now);
    F.srs_days_overdue = overdue != null
      ? feat(overdue, true, 'srs') : absent('srs');
  } else {
    for (const k of ['srs_stability', 'srs_difficulty', 'srs_correct_count',
      'srs_wrong_count', 'srs_days_since_review', 'srs_days_overdue']) {
      F[k] = absent('srs', 'unsaved');
    }
  }

  // ── Explicit signals (strongest when present) ───────────────────────────────
  F.explicit_saved = feat(saved ? 1 : 0, true, 'explicit');
  if (saved) {
    const savedDays = daysBetween(vocab.updated_at ?? vocab.last_reviewed_at, now);
    F.explicit_save_recency_decay = savedDays != null
      ? feat(recencyDecay(savedDays), true, 'explicit')
      : feat(1, true, 'explicit', 'no-timestamp');
  } else {
    F.explicit_save_recency_decay = absent('explicit', 'unsaved');
  }
  F.explicit_lookup_count = feat(Number(events.lookupCount) || 0, true, 'explicit');
  F.explicit_review_count = feat(Number(events.reviewCount) || 0, true, 'explicit');
  const lookupDays = events.lastLookupAt ? daysBetween(events.lastLookupAt, now) : null;
  F.explicit_last_lookup_decay = lookupDays != null
    ? feat(recencyDecay(lookupDays), true, 'explicit')
    : absent('explicit', 'no-lookup');
  // Hanja-family confirmation is Phase 8.
  F.explicit_hanja_confirmed = absent('explicit', 'deferred:phase8');

  return F;
};

/** FEATURE_KEYS — the stable ordered key list, so a model sees a fixed schema. */
export const FEATURE_KEYS = Object.keys(assembleFeatures({ language: 'ko', stem: 'x' }));

/**
 * toNumericVector — flatten a feature record into a parallel { vector, mask }.
 * Missing features are 0 in `vector` but 0 in `mask` too, so a model can tell an
 * imputed 0 from a real 0 (this is the "not silently zero" contract made
 * machine-readable). Non-numeric feature values (e.g. POS, L1 strings) are left
 * out of the numeric vector and reported in `categorical`.
 */
export const toNumericVector = (features) => {
  const vector = {};
  const mask = {};
  const categorical = {};
  for (const [key, f] of Object.entries(features)) {
    if (!f.present) {
      vector[key] = 0;
      mask[key] = 0;
      continue;
    }
    if (typeof f.value === 'number' && Number.isFinite(f.value)) {
      vector[key] = f.value;
      mask[key] = 1;
    } else {
      categorical[key] = f.value;
    }
  }
  return { vector, mask, categorical };
};
