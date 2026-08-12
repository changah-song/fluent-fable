/**
 * Tests for the Phase 2 ability model math (see "personalization model
 * implementation plan.md" §2.1). These are the easiest kind of test to trust:
 * `seedThetaFromRank` and `sigmoid` are PURE functions — no database, no network,
 * no React. Same input, same output, every time — so there's nothing to mock. We
 * just call them and assert on the numbers.
 *
 * What we're pinning down:
 *  - a self-report rank maps to an ability on the documented [-3, 3] scale;
 *  - the mapping is monotonic (a higher self-report never yields a lower ability);
 *  - each language's lowest band lands at the floor and its highest at the ceiling,
 *    even though the languages have different numbers of bands (ko: 3, en: 6, zh: 7).
 */

import {
  ABILITY_THETA_MAX,
  ABILITY_THETA_MIN,
  OOV_DIFFICULTY,
  SELF_REPORT_DECAY_EVENTS,
  difficultyFromLevelRank,
  pKnown,
  seedThetaFromRank,
  sigmoid,
  updateThetaOnline,
} from '../abilityModel';

describe('seedThetaFromRank', () => {
  it('maps the lowest band to the floor and the highest to the ceiling (ko: 6 bands)', () => {
    expect(seedThetaFromRank('ko', 1)).toBe(ABILITY_THETA_MIN);
    expect(seedThetaFromRank('ko', 6)).toBe(ABILITY_THETA_MAX);
    // With six bands the midpoint (0) falls between bands 3 and 4.
    expect(seedThetaFromRank('ko', 3)).toBeLessThan(0);
    expect(seedThetaFromRank('ko', 4)).toBeGreaterThan(0);
  });

  it('spans the same [-3, 3] range for a language with more bands (en: 6 bands)', () => {
    expect(seedThetaFromRank('en', 1)).toBe(ABILITY_THETA_MIN);
    expect(seedThetaFromRank('en', 6)).toBe(ABILITY_THETA_MAX);
    // Every intermediate band stays inside the range.
    for (let rank = 1; rank <= 6; rank += 1) {
      const theta = seedThetaFromRank('en', rank);
      expect(theta).toBeGreaterThanOrEqual(ABILITY_THETA_MIN);
      expect(theta).toBeLessThanOrEqual(ABILITY_THETA_MAX);
    }
  });

  it('is monotonic: a higher self-report never yields a lower ability', () => {
    const zhThetas = [1, 2, 3, 4, 5, 6, 7].map((rank) => seedThetaFromRank('zh', rank));
    for (let i = 1; i < zhThetas.length; i += 1) {
      expect(zhThetas[i]).toBeGreaterThan(zhThetas[i - 1]);
    }
  });

  it('clamps out-of-range ranks to the floor and ceiling', () => {
    expect(seedThetaFromRank('ko', 0)).toBe(ABILITY_THETA_MIN);
    expect(seedThetaFromRank('ko', -5)).toBe(ABILITY_THETA_MIN);
    expect(seedThetaFromRank('ko', 99)).toBe(ABILITY_THETA_MAX);
  });

  it('falls back to a valid ability for an unknown language or non-numeric rank', () => {
    // Unknown language falls back to ko's band count; rank 1 → floor.
    expect(seedThetaFromRank('xx', 1)).toBe(ABILITY_THETA_MIN);
    // A non-numeric rank is treated as the lowest band, not NaN.
    expect(seedThetaFromRank('ko', undefined)).toBe(ABILITY_THETA_MIN);
    expect(Number.isNaN(seedThetaFromRank('ko', 'not-a-number'))).toBe(false);
  });
});

describe('difficultyFromLevelRank', () => {
  it('places a word on the SAME scale as the ability seed for the same band', () => {
    // This equality is the whole point: a word graded at band R and a user who
    // self-reports band R land on the same number, so P = sigmoid(theta - diff) = 0.5.
    for (const language of ['ko', 'en', 'zh']) {
      for (let rank = 1; rank <= 3; rank += 1) {
        expect(difficultyFromLevelRank(language, rank)).toBe(seedThetaFromRank(language, rank));
      }
    }
  });

  it('orders easy KB bands below hard ones', () => {
    // A1 (rank 1) is easier than C2 (rank 6) for English.
    expect(difficultyFromLevelRank('en', 1)).toBeLessThan(difficultyFromLevelRank('en', 6));
    expect(difficultyFromLevelRank('ko', 1)).toBe(ABILITY_THETA_MIN);
    expect(difficultyFromLevelRank('zh', 7)).toBe(ABILITY_THETA_MAX);
  });

  it('returns the flagged OOV fallback for an ungraded word (null rank)', () => {
    expect(difficultyFromLevelRank('ko', null)).toBe(OOV_DIFFICULTY);
    expect(difficultyFromLevelRank('en', undefined)).toBe(OOV_DIFFICULTY);
    expect(difficultyFromLevelRank('zh', 'nonsense')).toBe(OOV_DIFFICULTY);
    // OOV defaults to the hardest band, not an easy/neutral value.
    expect(OOV_DIFFICULTY).toBe(ABILITY_THETA_MAX);
  });
});

describe('sigmoid', () => {
  it('returns 0.5 at zero and saturates toward 0 and 1 at the extremes', () => {
    expect(sigmoid(0)).toBe(0.5);
    expect(sigmoid(10)).toBeGreaterThan(0.99);
    expect(sigmoid(-10)).toBeLessThan(0.01);
  });
});

describe('pKnown (Phase 2.3 baseline scorer)', () => {
  it('is exactly 0.5 when ability matches difficulty', () => {
    expect(pKnown(0, 0)).toBe(0.5);
    expect(pKnown(2, 2)).toBe(0.5);
    expect(pKnown(-1.5, -1.5)).toBe(0.5);
  });

  it('rises above 0.5 when the user out-levels the word, falls below when out-leveled', () => {
    expect(pKnown(2, -1)).toBeGreaterThan(0.5);
    expect(pKnown(-1, 2)).toBeLessThan(0.5);
  });

  it('gives a harder word a lower score for a fixed ability (sane ordering)', () => {
    const theta = 0;
    const easy = pKnown(theta, difficultyFromLevelRank('en', 1)); // A1
    const hard = pKnown(theta, difficultyFromLevelRank('en', 6)); // C2
    expect(hard).toBeLessThan(easy);
    // An ungraded (OOV) word is treated as hardest, so it scores lowest of all.
    expect(pKnown(theta, OOV_DIFFICULTY)).toBeLessThanOrEqual(hard);
  });

  it('stays strictly inside (0, 1) across the whole [-3, 3] × [-3, 3] domain', () => {
    for (let t = ABILITY_THETA_MIN; t <= ABILITY_THETA_MAX; t += 0.5) {
      for (let d = ABILITY_THETA_MIN; d <= ABILITY_THETA_MAX; d += 0.5) {
        const p = pKnown(t, d);
        expect(p).toBeGreaterThan(0);
        expect(p).toBeLessThan(1);
      }
    }
  });

  it('collapses non-finite input to the neutral midpoint instead of NaN', () => {
    expect(pKnown(NaN, 0)).toBe(0.5);
    expect(pKnown(0, undefined)).toBe(0.5);
    expect(pKnown(null, null)).toBe(0.5);
  });
});

describe('updateThetaOnline (Phase 3.1 online ability update)', () => {
  it('raises theta after a run of correct reviews', () => {
    let theta = 0;
    const difficulty = 0;
    for (let i = 0; i < 10; i += 1) {
      const next = updateThetaOnline({ theta, difficulty, outcome: 1, eventCount: i });
      expect(next).toBeGreaterThan(theta); // each correct review strictly raises theta
      theta = next;
    }
  });

  it('lowers theta after a lapse', () => {
    const theta = 0.5;
    const next = updateThetaOnline({ theta, difficulty: 0, outcome: 0, eventCount: 5 });
    expect(next).toBeLessThan(theta);
  });

  it('moves more when the outcome is surprising than when it is expected', () => {
    // A correct answer on a word we thought was too hard (low P) is a big update;
    // a correct answer on a word we already expected to know (high P) is a small one.
    const surprising = updateThetaOnline({ theta: -2, difficulty: 2, outcome: 1 }) - -2;
    const expected = updateThetaOnline({ theta: 2, difficulty: -2, outcome: 1 }) - 2;
    expect(surprising).toBeGreaterThan(expected);
  });

  it('shrinks the self-report anchor to nothing past N events', () => {
    // With a below-current seed, the anchor pulls theta DOWN while cold. Isolate
    // the anchor by using a word exactly at the current ability (evidence step 0
    // for outcome... but P=0.5 so evidence ≠ 0). Instead compare the anchor's pull
    // at cold vs. warm by holding evidence identical and reading the difference.
    const theta = 1;
    const theta0 = -1; // seed well below current ability
    const cold = updateThetaOnline({ theta, difficulty: 1, outcome: 1, eventCount: 0, theta0 });
    const warm = updateThetaOnline({
      theta,
      difficulty: 1,
      outcome: 1,
      eventCount: SELF_REPORT_DECAY_EVENTS,
      theta0,
    });
    // Cold is dragged down toward the low seed; warm ignores the seed entirely.
    expect(cold).toBeLessThan(warm);
    // Past N events the anchor is gone, so warm equals the no-anchor update.
    const noAnchor = updateThetaOnline({ theta, difficulty: 1, outcome: 1, eventCount: 0, theta0: null });
    expect(warm).toBeCloseTo(noAnchor, 10);
  });

  it('never escapes the [-3, 3] scale even under a long correct streak', () => {
    let theta = 0;
    for (let i = 0; i < 500; i += 1) {
      theta = updateThetaOnline({ theta, difficulty: -3, outcome: 1, eventCount: i });
    }
    expect(theta).toBeLessThanOrEqual(ABILITY_THETA_MAX);
    expect(theta).toBeGreaterThanOrEqual(ABILITY_THETA_MIN);
  });

  it('returns a safe value instead of NaN on bad input', () => {
    expect(updateThetaOnline({ theta: 1.2, difficulty: NaN, outcome: 1 })).toBe(1.2);
    expect(updateThetaOnline({ theta: NaN, difficulty: 0, outcome: 1 })).toBe(0);
    // A non-binary outcome is rejected (theta unchanged).
    expect(updateThetaOnline({ theta: 0.7, difficulty: 0, outcome: 0.5 })).toBe(0.7);
  });
});
