import {
  ABILITY_THETA_MAX,
  ABILITY_THETA_MIN,
  UNDERLINE_HARD_FLOOR,
  UNDERLINE_KNOWN_CEILING,
  difficultyFromLevelRank,
  levelUnderlineWeight,
  lowestUnderlinedRank,
  pKnown,
  underlineCategory,
} from '../abilityModel';

// The reader shades its level underlines on a green→amber→red gradient driven by
// P(known) rather than by the user's self-reported band. These cover the banding
// math; the colors themselves live in native (EpubPageView.applyLevelUnderlineShade).

describe('levelUnderlineWeight', () => {
  it('leaves well-known words unmarked', () => {
    expect(levelUnderlineWeight(0.99)).toBeNull();
    expect(levelUnderlineWeight(UNDERLINE_KNOWN_CEILING)).toBeNull();
  });

  it('saturates at the hard end for words far above the reader', () => {
    expect(levelUnderlineWeight(0.01)).toBe(1);
    expect(levelUnderlineWeight(UNDERLINE_HARD_FLOOR)).toBe(1);
  });

  it('ramps monotonically between the two cutoffs', () => {
    const samples = [0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2];
    const weights = samples.map(levelUnderlineWeight);

    weights.forEach((weight) => {
      expect(weight).toBeGreaterThan(0);
      expect(weight).toBeLessThanOrEqual(1);
    });
    // Lower P(known) => higher weight => redder.
    for (let i = 1; i < weights.length; i += 1) {
      expect(weights[i]).toBeGreaterThan(weights[i - 1]);
    }
  });

  it('puts the mid (amber) stop on the words the model is least sure about', () => {
    // The gradient midpoint should land near P = 0.5 — maximum uncertainty, which
    // is the same signal flashcardNomination scores candidates on.
    const midpointP = (UNDERLINE_KNOWN_CEILING + UNDERLINE_HARD_FLOOR) / 2;
    expect(levelUnderlineWeight(midpointP)).toBeCloseTo(0.5, 10);
    expect(midpointP).toBeCloseTo(0.5, 10);
  });

  it('draws nothing rather than an arbitrary color on bad input', () => {
    expect(levelUnderlineWeight(NaN)).toBeNull();
    expect(levelUnderlineWeight(undefined)).toBeNull();
    expect(levelUnderlineWeight(null)).toBeNull();
  });
});

describe('lowestUnderlinedRank', () => {
  it('lets a weak reader see easier bands than a strong one', () => {
    const weak = lowestUnderlinedRank('ko', ABILITY_THETA_MIN);
    const strong = lowestUnderlinedRank('ko', ABILITY_THETA_MAX);
    expect(weak).toBe(1);
    expect(strong == null || strong > weak).toBe(true);
  });

  it('never prunes a band that would have earned an underline', () => {
    // The SQL floor is only an optimization, so it must not drop a rank that
    // levelUnderlineWeight would have shaded.
    ['ko', 'zh', 'en'].forEach((language) => {
      [-2, -1, 0, 1, 2].forEach((theta) => {
        const floor = lowestUnderlinedRank(language, theta);
        for (let rank = 1; rank < (floor ?? 99); rank += 1) {
          const p = pKnown(theta, difficultyFromLevelRank(language, rank));
          expect(levelUnderlineWeight(p)).toBeNull();
        }
      });
    });
  });

  it('returns null when every band is known well enough to leave alone', () => {
    // A ceiling-ability reader out-levels even the hardest band.
    expect(lowestUnderlinedRank('ko', 100)).toBeNull();
  });
});

describe('underlineCategory (§8 hard+rare vs hard+frequent)', () => {
  it('leaves well-known words unmarked regardless of exposure', () => {
    expect(underlineCategory(0.99, 0)).toBeNull();
    expect(underlineCategory(0.99, 50)).toBeNull();
  });

  it('flags a hard, rare word as study-worthy and a hard, frequent one as reinforced', () => {
    const rare = underlineCategory(0.05, 0);
    const frequent = underlineCategory(0.05, 10);
    expect(rare).toMatchObject({ category: 'study' });
    expect(frequent).toMatchObject({ category: 'reinforced' });
    // Same difficulty → same underline weight; only the advice (color) differs.
    expect(rare.weight).toBe(levelUnderlineWeight(0.05));
    expect(frequent.weight).toBe(rare.weight);
  });

  it('treats unknown/zero remaining exposure as study — never assume reinforcement', () => {
    expect(underlineCategory(0.05, null).category).toBe('study');
    expect(underlineCategory(0.05, undefined).category).toBe('study');
    expect(underlineCategory(0.05, 0).category).toBe('study');
  });
});
