import { PROFICIENCY_LEVEL_OPTIONS } from '../constants/proficiencyLevels';
import { normalizeBookLanguage } from '../constants/languages';
import { remainingExposureFactor } from './flashcardNomination';

// ─── Ability model (Phase 2 of the personalized vocabulary model) ─────────────
//
// A user's ability is a single latent number, `theta`, on the same scale as a
// word's `difficulty` (Phase 2.2). The baseline scorer (Phase 2.3) reads both:
//
//     P(known) = sigmoid(theta_user - difficulty_word)
//
// so P = 0.5 exactly when the user's ability matches the word's difficulty. That
// shared scale is a CONTRACT: whatever maps word difficulty onto a number in
// Phase 2.2 MUST target this same [ABILITY_THETA_MIN, ABILITY_THETA_MAX] range,
// or the sigmoid difference stops being meaningful.
//
// This module is intentionally pure (no SQLite, no React Native) so the seeding
// math can be unit-tested in isolation. Persistence lives in Database.js
// (`profile_ability` table); this file only computes numbers.

export const ABILITY_THETA_MIN = -3;
export const ABILITY_THETA_MAX = 3;

// Difficulty for a word with no graded-KB entry (not in NIKL/HSK/CEFR). The
// graded lists cover common vocabulary well (NIKL ~20k, HSK ~17k, CEFR ~14k), so
// a content word absent from them skews rare/advanced — we default it to the
// hardest band rather than silently treating it as easy. Callers should still
// FLAG this as a fallback (plan §4.1: missing features handled explicitly, not
// silently zero) so downstream calibration can segment on it.
export const OOV_DIFFICULTY = ABILITY_THETA_MAX;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * rankToScale — the shared normalization that puts a 1-based band rank onto the
 * common latent scale [ABILITY_THETA_MIN, ABILITY_THETA_MAX].
 *
 * This is the single source of truth for the ability/difficulty axis. Both the
 * user's ability seed (`seedThetaFromRank`) and a word's difficulty
 * (`difficultyFromLevelRank`) run through it, which is what makes
 * `P = sigmoid(theta - difficulty)` meaningful: a user who self-reports band R and
 * a word graded at band R land on the SAME number, so P = 0.5 exactly when the
 * user's band matches the word's band (Rasch-consistent by construction).
 *
 * The band count differs per language (ko: 3, en: 6, zh: 7), so we normalize
 * against that count — the lowest band maps to the floor, the highest to the
 * ceiling, the middle to 0.
 */
const rankToScale = (language, rank) => {
  const normalizedLanguage = normalizeBookLanguage(language) || 'ko';
  const options = PROFICIENCY_LEVEL_OPTIONS[normalizedLanguage]
    ?? PROFICIENCY_LEVEL_OPTIONS.ko;
  const maxRank = options.length;

  const numericRank = Number(rank);
  const safeRank = Number.isFinite(numericRank) ? numericRank : 1;

  // A single-band language can't be spread across a range; put it at the midpoint.
  if (maxRank <= 1) {
    return (ABILITY_THETA_MIN + ABILITY_THETA_MAX) / 2;
  }

  const normalized = clamp((safeRank - 1) / (maxRank - 1), 0, 1);
  return ABILITY_THETA_MIN + normalized * (ABILITY_THETA_MAX - ABILITY_THETA_MIN);
};

/**
 * seedThetaFromRank — map a self-reported proficiency rank to an initial ability
 * estimate (`theta_0`) for cold start.
 *
 * Deliberately simple and monotonic: this is a weak prior meant to be overridden
 * by behavior (Phase 3), not a precise measurement. Self-assessment is known to
 * be miscalibrated, so we don't over-fit the mapping.
 *
 * @param {string} language  target language code (ko | zh | en)
 * @param {number} rank      1-based self-report rank (see proficiencyLevels.js)
 * @returns {number} theta_0 in [ABILITY_THETA_MIN, ABILITY_THETA_MAX]
 */
export const seedThetaFromRank = (language, rank) => rankToScale(language, rank);

/**
 * difficultyFromLevelRank — map a word's graded-KB band (`level_rank` from
 * proficiency_levels.db: NIKL 1-3 / HSK 1-7 / CEFR 1-6) to a difficulty on the
 * same scale as ability (Phase 2.2).
 *
 * A missing/unknown rank (word not in the graded list) returns OOV_DIFFICULTY —
 * the caller is responsible for flagging that it was a fallback rather than a
 * real graded value.
 *
 * @param {string} language        target language code (ko | zh | en)
 * @param {number|null} levelRank   1-based KB band, or null/undefined if ungraded
 * @returns {number} difficulty in [ABILITY_THETA_MIN, ABILITY_THETA_MAX]
 */
export const difficultyFromLevelRank = (language, levelRank) => {
  if (levelRank == null || !Number.isFinite(Number(levelRank))) {
    return OOV_DIFFICULTY;
  }
  return rankToScale(language, levelRank);
};

/**
 * difficultyFromPercentile — map a word's CONTINUOUS difficulty position onto the
 * same [ABILITY_THETA_MIN, ABILITY_THETA_MAX] scale as ability.
 *
 * The finer-grained successor to difficultyFromLevelRank: instead of one of a few
 * bands, every graded word carries its own `difficulty_percentile` (0 = easiest,
 * 1 = hardest — from korean_nikl_vocab: dense difficulty_rank / N over the graded
 * set, grade-ordered then frequency-ordered), so P(known) can order words *within*
 * a band too. Language-agnostic: the percentile is already normalized, so unlike
 * rankToScale there's no per-language band count to divide by.
 *
 * A missing/invalid percentile returns OOV_DIFFICULTY; the caller flags the fallback.
 *
 * @param {number|null} percentile  difficulty position in [0,1], or null if absent
 * @returns {number} difficulty in [ABILITY_THETA_MIN, ABILITY_THETA_MAX]
 */
export const difficultyFromPercentile = (percentile) => {
  const p = Number(percentile);
  if (!Number.isFinite(p)) {
    return OOV_DIFFICULTY;
  }
  const normalized = clamp(p, 0, 1);
  return ABILITY_THETA_MIN + normalized * (ABILITY_THETA_MAX - ABILITY_THETA_MIN);
};

/**
 * sigmoid — the logistic link used by the baseline scorer. Exposed here so
 * Phase 2.3 and any tests share one definition.
 */
export const sigmoid = (x) => 1 / (1 + Math.exp(-x));

/**
 * pKnown — the Phase 2.3 baseline scorer:
 *
 *     P(known) = sigmoid(theta_user - difficulty_word)
 *
 * The single-factor IRT/Rasch model (design doc §4, phase 1). Both inputs live on
 * the shared [ABILITY_THETA_MIN, ABILITY_THETA_MAX] scale, so the difference is
 * meaningful: P = 0.5 exactly when ability matches difficulty, rises as the user
 * out-levels the word, falls as the word out-levels the user. Monotonic in both
 * arguments — a harder (higher-difficulty) word always scores lower for a fixed
 * ability, which is the "sane ordering" the acceptance check requires.
 *
 * Pure and total: non-finite inputs collapse to the neutral midpoint rather than
 * producing NaN, so a bad difficulty can never poison a cached score. With finite
 * inputs on the [-3, 3] scale the result is always strictly in (0, 1) (worst-case
 * difference of ±6 gives ~0.0025 / ~0.9975), never exactly 0 or 1.
 *
 * @param {number} theta       user ability on the shared scale
 * @param {number} difficulty  word difficulty on the shared scale
 * @returns {number} P(known) in (0, 1)
 */
export const pKnown = (theta, difficulty) => {
  const t = Number(theta);
  const d = Number(difficulty);
  if (!Number.isFinite(t) || !Number.isFinite(d)) {
    return 0.5;
  }
  return sigmoid(t - d);
};

// ─── Reader level-underline shading ───────────────────────────────────────────
//
// The reader underlines graded words on a continuous green→amber→red gradient
// driven by P(known) rather than by the user's self-reported band. Two cutoffs
// define the visible range:
//
//   P >= UNDERLINE_KNOWN_CEILING  → no underline at all (you almost certainly
//                                   know it; marking it is noise)
//   P <= UNDERLINE_HARD_FLOOR     → fully saturated "hard" end of the gradient
//
// Between them the weight ramps linearly, so the mid-gradient (amber) lands on
// the words the model is genuinely UNCERTAIN about — the same uncertainty signal
// flashcardNomination uses to pick cards, so the two surfaces agree.
export const UNDERLINE_KNOWN_CEILING = 0.85;
export const UNDERLINE_HARD_FLOOR = 0.15;

/**
 * levelUnderlineWeight — map P(known) to a gradient position for the reader's
 * underline, or null when the word should not be underlined at all.
 *
 * Pure and total so the banding is unit-testable without a device: a non-finite
 * probability yields null (draw nothing) rather than an arbitrary color.
 *
 * @param {number} p  P(known) in (0, 1)
 * @returns {number|null} weight in [0, 1] (0 = easiest shown, 1 = hardest), or
 *                        null if the word is known well enough to leave unmarked
 */
export const levelUnderlineWeight = (p) => {
  // Guard null/undefined explicitly BEFORE coercing — Number(null) is 0, a finite
  // value below the floor, which would paint a missing probability as a fully
  // saturated "hardest" underline instead of drawing nothing.
  if (p == null) {
    return null;
  }
  const value = Number(p);
  if (!Number.isFinite(value) || value >= UNDERLINE_KNOWN_CEILING) {
    return null;
  }
  if (value <= UNDERLINE_HARD_FLOOR) {
    return 1;
  }
  const span = UNDERLINE_KNOWN_CEILING - UNDERLINE_HARD_FLOOR;
  return clamp((UNDERLINE_KNOWN_CEILING - value) / span, 0, 1);
};

// A hard (underlined) word is only worth a flashcard when the book WON'T reteach it.
// At/above this remaining-exposure factor the text will reinforce the word on its own
// ('reinforced' — a calmer color); below it the word is hard AND rare ('study' — the
// flashcard-worthy color). §8's point is to stop every hard word from feeling like it
// must become a card, so the reader can relax about the ones the book will repeat.
export const REINFORCED_EXPOSURE_FLOOR = 0.5; // ≈ 5+ more encounters at saturation 10

/**
 * underlineCategory — how a graded word should be highlighted, combining intrinsic
 * difficulty (P(known)) with the book's future exposure (remaining occurrences). The
 * §8 "hard + rare vs hard + frequent" split: same difficulty, different advice.
 *
 * @param {number} pKnown          P(known) in (0, 1)
 * @param {number} remainingCount  occurrences of the word still ahead in the book
 * @returns {{ weight:number, category:'study'|'reinforced', exposure:number }|null}
 *          null when the word is known well enough to leave unmarked.
 */
export const underlineCategory = (pKnown, remainingCount) => {
  const weight = levelUnderlineWeight(pKnown);
  if (weight == null) {
    return null;
  }
  const exposure = remainingExposureFactor(remainingCount);
  return {
    weight,
    exposure,
    category: exposure >= REINFORCED_EXPOSURE_FLOOR ? 'reinforced' : 'study',
  };
};

/**
 * lowestUnderlinedRank — the easiest graded band that still earns an underline
 * at this ability.
 *
 * Purely an optimization: the reader's surface query filters SQL-side on
 * `level_rank >= ?` so it doesn't haul every graded surface in the book across
 * the bridge. That floor used to be the user's self-reported rank; deriving it
 * from `theta` instead is what lets the underlines follow the model down when
 * behavior says the reader is weaker than they claimed.
 *
 * Safe because P(known) is monotonically decreasing in rank (harder band → lower
 * P), so the first rank under the ceiling bounds all the rest.
 *
 * @returns {number|null} the floor rank, or null if every band is known well
 *                        enough to leave unmarked
 */
export const lowestUnderlinedRank = (language, theta) => {
  const normalizedLanguage = normalizeBookLanguage(language) || 'ko';
  const options = PROFICIENCY_LEVEL_OPTIONS[normalizedLanguage]
    ?? PROFICIENCY_LEVEL_OPTIONS.ko;

  for (let rank = 1; rank <= options.length; rank += 1) {
    const p = pKnown(theta, difficultyFromLevelRank(normalizedLanguage, rank));
    if (levelUnderlineWeight(p) != null) {
      return rank;
    }
  }
  return null;
};

// ─── Online ability update (Phase 3.1) ────────────────────────────────────────
//
// After each graded behavioral event we nudge `theta` toward what the outcome
// implies. This is the standard online IRT / Elo-style stochastic update: for a
// single-factor Rasch model P = sigmoid(theta - difficulty), the gradient of the
// log-likelihood w.r.t. theta for a binary outcome y is exactly (y - P). So one
// step is:
//
//     theta ← theta + lr · (y − P)
//
// A correct outcome on a word we predicted was unlikely (low P) moves theta up a
// lot; a correct outcome we already expected (high P) barely moves it. A lapse
// (y = 0) moves theta down. This is self-correcting and needs no pooled data —
// it runs on-device (architecture decision, plan §0).

// Base step size for a graded flashcard review — the strong, unconfounded channel.
export const THETA_LEARNING_RATE = 0.3;
// A dictionary lookup is a weak, confounded "probably didn't know it" signal
// (you might look up a known word for nuance), so it nudges far more gently.
export const LOOKUP_LEARNING_RATE = 0.1;
// An EXPOSURE (a graded word shown on a page the reader dwelled on and left
// without tapping) is the weakest channel of all, and the rate is set by a volume
// argument as much as a confidence one: a page carries on the order of ten graded
// words against maybe one lookup, so an equal rate would let passive scrolling
// outvote deliberate lookups roughly 10:1. An order of magnitude below the lookup
// rate puts the two channels in the same range per page, which is the balance we
// actually want.
//
// This rate is a GUESS pending real data. Exposure events log their dwell in
// `value_num` precisely so it can later be fit rather than assumed.
export const EXPOSURE_LEARNING_RATE = 0.01;

// Dwell-plausibility gate for an exposure unit (a page, a focus span, or a
// scrolled-past block — native decides the unit and times the dwell). The gate
// scales with the unit's text length instead of a flat threshold, because unit
// size differs ~10x across render modes: a focus sentence is read in a couple of
// seconds, a page in tens. Expected read time is chars × MS_PER_CHAR; the reader
// must have spent at least MIN_READ_FRACTION of it, so the one rule rejects both
// a flicked-through page and a blitzed-past sentence.
export const EXPOSURE_MS_PER_CHAR = 30; // ~33 chars/s, brisk reading across scripts
export const EXPOSURE_MIN_READ_FRACTION = 0.4;
export const EXPOSURE_ABS_FLOOR_MS = 300; // never credit a sub-300ms blip

/**
 * exposureDwellIsPlausible — did the reader dwell on this unit long enough for
 * "didn't tap" to plausibly mean "knew it" rather than "skimmed past"?
 *
 * @param {number} chars   text length of the unit
 * @param {number} dwellMs measured dwell in milliseconds
 * @returns {boolean}
 */
export const exposureDwellIsPlausible = (chars, dwellMs) => {
  const expected = Math.max(0, Number(chars) || 0) * EXPOSURE_MS_PER_CHAR;
  const required = Math.max(EXPOSURE_ABS_FLOOR_MS, expected * EXPOSURE_MIN_READ_FRACTION);
  return Number(dwellMs) >= required;
};

// How the self-report seed's influence decays (design doc §2: self-assessment is
// miscalibrated, so treat it as a prior to override quickly, not a fixed anchor).
// On top of the evidence step we add a spring pulling theta back toward the seed
// (`theta0`); that spring's weight fades linearly from full strength to zero over
// SELF_REPORT_DECAY_EVENTS behavioral events, after which theta is purely
// behavior-driven. This is the "cap the self-report weight after N interactions"
// option the design doc calls out.
export const SELF_REPORT_DECAY_EVENTS = 20;
export const SELF_REPORT_ANCHOR_STRENGTH = 0.5;

/**
 * updateThetaOnline — one online IRT step (Phase 3.1). Pure, so the update math is
 * unit-testable without SQLite; persistence lives in Database.js
 * (`updateThetaFromOutcome`).
 *
 * @param {object}  args
 * @param {number}  args.theta         current ability on the shared [-3, 3] scale
 * @param {number}  args.difficulty    word difficulty on the same scale (Phase 2.2)
 * @param {number}  args.outcome       observed outcome, 1 (known/correct) or 0 (unknown/lapse)
 * @param {number} [args.eventCount]   behavioral events folded in SO FAR (before this one),
 *                                      used to fade the self-report anchor
 * @param {number|null} [args.theta0]  the self-report seed to anchor toward while cold;
 *                                      null/absent disables the anchor (pure behavioral update)
 * @param {number} [args.learningRate] step size (defaults to the review rate)
 * @returns {number} the updated theta, clamped to [ABILITY_THETA_MIN, ABILITY_THETA_MAX]
 */
export const updateThetaOnline = ({
  theta,
  difficulty,
  outcome,
  eventCount = 0,
  theta0 = null,
  learningRate = THETA_LEARNING_RATE,
} = {}) => {
  const t = Number(theta);
  const d = Number(difficulty);
  const y = Number(outcome);

  // Bad inputs must never poison a stored ability: fall back to the current theta
  // (or the neutral midpoint if that's unusable) instead of writing NaN.
  if (!Number.isFinite(t) || !Number.isFinite(d) || (y !== 0 && y !== 1)) {
    return Number.isFinite(t)
      ? clamp(t, ABILITY_THETA_MIN, ABILITY_THETA_MAX)
      : (ABILITY_THETA_MIN + ABILITY_THETA_MAX) / 2;
  }

  const lr = Number.isFinite(Number(learningRate))
    ? Number(learningRate)
    : THETA_LEARNING_RATE;

  const p = sigmoid(t - d);
  let next = t + lr * (y - p);

  // Decaying pull toward the self-report seed. Weight 1 → 0 across
  // SELF_REPORT_DECAY_EVENTS events, so a cold profile is restrained by its
  // (weak) self-report while behavior accumulates, then fully overrides it.
  // Guard null/undefined explicitly — Number(null) is 0 (a valid finite anchor),
  // which would wrongly drag an un-anchored update toward the midpoint.
  if (theta0 != null && Number.isFinite(Number(theta0))) {
    const n = Number.isFinite(Number(eventCount)) ? Math.max(0, Number(eventCount)) : 0;
    const priorWeight = Math.max(0, 1 - n / SELF_REPORT_DECAY_EVENTS);
    next += lr * SELF_REPORT_ANCHOR_STRENGTH * priorWeight * (Number(theta0) - t);
  }

  return clamp(next, ABILITY_THETA_MIN, ABILITY_THETA_MAX);
};
