/**
 * Tests for the Phase 4.1 feature assembly (see "personalization model
 * implementation plan.md" §4.1). Pure functions — no SQLite — so we just feed raw
 * rows and assert on the feature record.
 *
 * The contract these lock down (plan §4.1 acceptance): a feature vector is
 * produced for ANY (user, word) pair, and every MISSING feature is explicit
 * (value null + present:false + a note), never a silent zero. The numeric vector
 * carries a parallel mask so an imputed 0 is distinguishable from a real 0.
 */

import {
  FEATURE_KEYS,
  RECENCY_HALF_LIFE_DAYS,
  assembleFeatures,
  classifyWordOrigin,
  countSyllables,
  hanjaDensity,
  hanjaOverlapFraction,
  recencyDecay,
  toNumericVector,
} from '../featureAssembly';
import { SELF_REPORT_DECAY_EVENTS } from '../abilityModel';

describe('countSyllables', () => {
  it('counts Hangul blocks for ko, ideographs for zh, vowel groups for en', () => {
    expect(countSyllables('ko', '학교')).toBe(2);
    expect(countSyllables('ko', '안녕하세요')).toBe(5);
    expect(countSyllables('zh', '学校')).toBe(2);
    expect(countSyllables('en', 'banana')).toBe(3); // ba-na-na vowel groups
    expect(countSyllables('en', 'sky')).toBe(1); // 'y' counts, at least 1
  });

  it('returns 0 for empty input', () => {
    expect(countSyllables('ko', '')).toBe(0);
    expect(countSyllables('ko', '   ')).toBe(0);
  });
});

describe('classifyWordOrigin', () => {
  it('classifies ko words as sino / loan / native', () => {
    expect(classifyWordOrigin('ko', { stem: '학교', hanja: '學校' })).toBe('sino');
    expect(classifyWordOrigin('ko', { stem: '커피', hanja: null })).toBe('native'); // pure Hangul
    expect(classifyWordOrigin('ko', { stem: 'OK', hanja: null })).toBe('loan'); // latin letters
  });

  it('is ko-only: other languages return null so the caller can mark it absent', () => {
    expect(classifyWordOrigin('zh', { stem: '学校' })).toBeNull();
    expect(classifyWordOrigin('en', { stem: 'school' })).toBeNull();
  });
});

describe('hanjaDensity', () => {
  it('is the hanja-per-syllable fraction for ko', () => {
    expect(hanjaDensity('ko', { stem: '학교', hanja: '學校' })).toBe(1); // 2/2
    expect(hanjaDensity('ko', { stem: '컴퓨터', hanja: null })).toBe(0); // no hanja
  });

  it('is 1 for zh (the word is hanja) and null for en', () => {
    expect(hanjaDensity('zh', { stem: '学校' })).toBe(1);
    expect(hanjaDensity('en', { stem: 'school' })).toBeNull();
  });
});

describe('recencyDecay', () => {
  it('is 1 now and halves every half-life', () => {
    expect(recencyDecay(0)).toBe(1);
    expect(recencyDecay(RECENCY_HALF_LIFE_DAYS)).toBeCloseTo(0.5, 10);
    expect(recencyDecay(2 * RECENCY_HALF_LIFE_DAYS)).toBeCloseTo(0.25, 10);
  });

  it('treats unknown / future timestamps as full weight', () => {
    expect(recencyDecay(-5)).toBe(1);
    expect(recencyDecay(NaN)).toBe(1);
  });
});

describe('hanjaOverlapFraction', () => {
  it('is the fraction of a word’s hanja the user already knows', () => {
    const known = new Set(['學', '生']);
    expect(hanjaOverlapFraction('學校', known)).toBe(0.5); // 學 known, 校 not
    expect(hanjaOverlapFraction('學生', known)).toBe(1);
  });

  it('is null when the word has no hanja, 0 when the user knows none', () => {
    expect(hanjaOverlapFraction('커피', new Set(['學']))).toBeNull();
    expect(hanjaOverlapFraction('學校', new Set())).toBe(0);
  });
});

describe('assembleFeatures — explicit missingness contract', () => {
  it('produces every declared feature key for a bare (user, word) pair', () => {
    const f = assembleFeatures({ language: 'ko', stem: '학교' });
    expect(Object.keys(f).sort()).toEqual([...FEATURE_KEYS].sort());
    expect(FEATURE_KEYS.length).toBeGreaterThan(0);
  });

  it('marks absent features present:false with null value — never silent zero', () => {
    const f = assembleFeatures({ language: 'ko', stem: '학교' }); // no dict/ability/vocab
    // deferred data sources
    expect(f.user_reading_speed).toMatchObject({ present: false, value: null, note: 'deferred:phase6' });
    expect(f.explicit_hanja_confirmed).toMatchObject({ present: false, value: null, note: 'deferred:phase8' });
    expect(f.item_homophone_risk.present).toBe(false);
    // no ability row → user features absent, not 0
    expect(f.user_theta).toMatchObject({ present: false, value: null });
    // no dictionary row → KB rank absent, but difficulty still defined via OOV fallback
    expect(f.kb_level_rank.present).toBe(false);
    expect(f.kb_difficulty).toMatchObject({ present: true, note: 'fallback:oov' });
  });

  it('fills knowledge + item features from a dictionary row', () => {
    const f = assembleFeatures({
      language: 'ko',
      stem: '학교',
      dict: { pos: 'noun', hanja: '學校', level_rank: 1, definition: null },
    });
    expect(f.kb_level_rank).toMatchObject({ present: true, value: 1 });
    expect(f.kb_syllable_count.value).toBe(2);
    expect(f.kb_origin_sino.value).toBe(1);
    expect(f.kb_origin_native.value).toBe(0);
    expect(f.item_pos).toMatchObject({ present: true, value: 'noun' });
    expect(f.item_hanja_density.value).toBe(1);
  });

  it('prefers the continuous difficulty percentile over the coarse band', () => {
    const easy = assembleFeatures({
      language: 'ko',
      stem: '학교',
      dict: { pos: 'noun', level_rank: 5, difficulty_percentile: 0.02 },
    });
    const hard = assembleFeatures({
      language: 'ko',
      stem: '난해',
      dict: { pos: 'noun', level_rank: 5, difficulty_percentile: 0.98 },
    });
    // Same coarse band (5), but the continuous percentile still orders them — a very
    // frequent word is far easier than a very rare one — and the note is unflagged.
    expect(easy.kb_difficulty.note).toBeUndefined();
    expect(hard.kb_difficulty.note).toBeUndefined();
    expect(easy.kb_difficulty.value).toBeLessThan(hard.kb_difficulty.value);
  });

  it('flags band-only difficulty when a graded word lacks a percentile', () => {
    const f = assembleFeatures({
      language: 'ko',
      stem: '학교',
      dict: { pos: 'noun', level_rank: 1, definition: null },
    });
    expect(f.kb_difficulty).toMatchObject({ present: true, note: 'band-only' });
  });

  it('turns on SRS + explicit features only when the word is saved', () => {
    const now = Date.parse('2026-07-07T00:00:00Z');
    const savedAgo = new Date(now - 30 * 86400000).toISOString(); // 30 days ago
    const unsaved = assembleFeatures({ language: 'ko', stem: '학교', now });
    expect(unsaved.srs_saved.value).toBe(0);
    expect(unsaved.srs_stability).toMatchObject({ present: false, note: 'unsaved' });
    expect(unsaved.explicit_save_recency_decay).toMatchObject({ present: false, note: 'unsaved' });

    const saved = assembleFeatures({
      language: 'ko',
      stem: '학교',
      now,
      vocab: {
        stability: 12, difficulty: 5, correct_count: 3, wrong_count: 1,
        last_reviewed_at: savedAgo, next_review_at: new Date(now + 5 * 86400000).toISOString(),
        updated_at: savedAgo,
      },
    });
    expect(saved.srs_saved.value).toBe(1);
    expect(saved.srs_stability.value).toBe(12);
    expect(saved.srs_days_since_review.value).toBeCloseTo(30, 5);
    expect(saved.explicit_save_recency_decay.present).toBe(true);
    // 30 days ≈ half a half-life → decay between 0.5 and 1.
    expect(saved.explicit_save_recency_decay.value).toBeGreaterThan(0.5);
    expect(saved.explicit_save_recency_decay.value).toBeLessThan(1);
  });

  it('decays the self-report weight as event_count grows', () => {
    const cold = assembleFeatures({ language: 'ko', stem: 'x', ability: { theta: 0, self_report_rank: 2, event_count: 0 } });
    const warm = assembleFeatures({ language: 'ko', stem: 'x', ability: { theta: 0, self_report_rank: 2, event_count: SELF_REPORT_DECAY_EVENTS } });
    expect(cold.user_self_report_weight.value).toBe(1);
    expect(warm.user_self_report_weight.value).toBe(0);
  });

  it('flags the cross-word hanja overlap as capped until Tier 4', () => {
    const f = assembleFeatures({
      language: 'ko', stem: '학생',
      dict: { hanja: '學生' },
      knownHanjaSet: new Set(['學']),
    });
    expect(f.item_cross_hanja_overlap).toMatchObject({ present: true, value: 0.5, note: 'capped:tier4' });
  });
});

describe('toNumericVector', () => {
  it('imputes 0 for missing features but records mask 0 so it is not silently 0', () => {
    const f = assembleFeatures({ language: 'ko', stem: '학교' });
    const { vector, mask, categorical } = toNumericVector(f);
    // user_theta is absent here
    expect(vector.user_theta).toBe(0);
    expect(mask.user_theta).toBe(0);
    // srs_saved is a real present 0/1
    expect(mask.srs_saved).toBe(1);
    // POS (a string) goes to categorical, not the numeric vector, when present
    const withPos = toNumericVector(assembleFeatures({ language: 'ko', stem: '학교', dict: { pos: 'noun' } }));
    expect(withPos.categorical.item_pos).toBe('noun');
    expect(withPos.vector.item_pos).toBeUndefined();
    expect(categorical.item_pos).toBeUndefined();
  });
});
