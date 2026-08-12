import { DEFAULT_TARGET_LANGUAGE, normalizeBookLanguage } from './languages';

export const PROFICIENCY_LEVEL_OPTIONS = {
  // Six "Noeul Reading Levels": the three NIKL grades (초급/중급/고급), each split
  // Lower/Upper by corpus frequency. rank here MUST match korean_nikl_vocab.reading_level
  // (backend BOOK_LEVEL_LABELS.ko) so level_rank normalizes across the full 1..6 span.
  ko: [
    {
      rank: 1,
      value: 'lower_elementary',
      label: 'Lower Elementary',
      shortLabel: '초급 하',
      description: 'Most frequent beginner (초급) vocabulary',
      system: 'Noeul Reading Levels',
    },
    {
      rank: 2,
      value: 'upper_elementary',
      label: 'Upper Elementary',
      shortLabel: '초급 상',
      description: 'Less frequent beginner (초급) vocabulary',
      system: 'Noeul Reading Levels',
    },
    {
      rank: 3,
      value: 'lower_intermediate',
      label: 'Lower Intermediate',
      shortLabel: '중급 하',
      description: 'Most frequent intermediate (중급) vocabulary',
      system: 'Noeul Reading Levels',
    },
    {
      rank: 4,
      value: 'upper_intermediate',
      label: 'Upper Intermediate',
      shortLabel: '중급 상',
      description: 'Less frequent intermediate (중급) vocabulary',
      system: 'Noeul Reading Levels',
    },
    {
      rank: 5,
      value: 'lower_advanced',
      label: 'Lower Advanced',
      shortLabel: '고급 하',
      description: 'Most frequent advanced (고급) vocabulary',
      system: 'Noeul Reading Levels',
    },
    {
      rank: 6,
      value: 'upper_advanced',
      label: 'Upper Advanced',
      shortLabel: '고급 상',
      description: 'Less frequent advanced (고급) vocabulary',
      system: 'Noeul Reading Levels',
    },
  ],
  zh: [
    {
      rank: 1,
      value: 'HSK1',
      label: 'HSK 1',
      shortLabel: 'HSK 1',
      description: 'Complete beginner',
      system: 'HSK',
    },
    {
      rank: 2,
      value: 'HSK2',
      label: 'HSK 2',
      shortLabel: 'HSK 2',
      description: 'Beginner',
      system: 'HSK',
    },
    {
      rank: 3,
      value: 'HSK3',
      label: 'HSK 3',
      shortLabel: 'HSK 3',
      description: 'Lower intermediate',
      system: 'HSK',
    },
    {
      rank: 4,
      value: 'HSK4',
      label: 'HSK 4',
      shortLabel: 'HSK 4',
      description: 'Intermediate',
      system: 'HSK',
    },
    {
      rank: 5,
      value: 'HSK5',
      label: 'HSK 5',
      shortLabel: 'HSK 5',
      description: 'Upper intermediate',
      system: 'HSK',
    },
    {
      rank: 6,
      value: 'HSK6',
      label: 'HSK 6',
      shortLabel: 'HSK 6',
      description: 'Advanced',
      system: 'HSK',
    },
    {
      rank: 7,
      value: 'HSK7',
      label: 'HSK 7',
      shortLabel: 'HSK 7',
      description: 'Advanced learner',
      system: 'HSK',
    },
  ],
  en: [
    {
      rank: 1,
      value: 'A1',
      label: 'A1',
      shortLabel: 'A1',
      description: 'Complete beginner',
      system: 'CEFR',
    },
    {
      rank: 2,
      value: 'A2',
      label: 'A2',
      shortLabel: 'A2',
      description: 'Beginner',
      system: 'CEFR',
    },
    {
      rank: 3,
      value: 'B1',
      label: 'B1',
      shortLabel: 'B1',
      description: 'Intermediate',
      system: 'CEFR',
    },
    {
      rank: 4,
      value: 'B2',
      label: 'B2',
      shortLabel: 'B2',
      description: 'Upper intermediate',
      system: 'CEFR',
    },
    {
      rank: 5,
      value: 'C1',
      label: 'C1',
      shortLabel: 'C1',
      description: 'Advanced',
      system: 'CEFR',
    },
    {
      rank: 6,
      value: 'C2',
      label: 'C2',
      shortLabel: 'C2',
      description: 'Near-native',
      system: 'CEFR',
    },
  ],
};

export const DEFAULT_PROFICIENCY_LEVELS_BY_LANGUAGE = {
  ko: 1,
  zh: 1,
  en: 1,
};

const LEVEL_ALIASES = {
  ko: {
    '1': 1,
    '2': 2,
    '3': 3,
    '4': 4,
    '5': 5,
    '6': 6,
    'lower elementary': 1,
    'upper elementary': 2,
    'lower intermediate': 3,
    'upper intermediate': 4,
    'lower advanced': 5,
    'upper advanced': 6,
    // Legacy 3-grade NIKL names map to the lower band of each grade's Lower/Upper pair.
    beginner: 1,
    'complete beginner': 1,
    '초급': 1,
    'topik 1': 1,
    'topik 1 level 1': 1,
    intermediate: 3,
    '중급': 3,
    'topik 2': 3,
    advanced: 5,
    'advanced learner': 5,
    '고급': 5,
    'topik 3': 5,
  },
  zh: {
    hsk1: 1,
    'hsk 1': 1,
    hsk2: 2,
    'hsk 2': 2,
    hsk3: 3,
    'hsk 3': 3,
    hsk4: 4,
    'hsk 4': 4,
    hsk5: 5,
    'hsk 5': 5,
    hsk6: 6,
    'hsk 6': 6,
    hsk7: 7,
    'hsk 7': 7,
  },
  en: {
    a1: 1,
    a2: 2,
    b1: 3,
    b2: 4,
    c1: 5,
    c2: 6,
  },
};

export const getProficiencyLevelOptions = (language = DEFAULT_TARGET_LANGUAGE) => (
  PROFICIENCY_LEVEL_OPTIONS[normalizeBookLanguage(language)] ?? PROFICIENCY_LEVEL_OPTIONS[DEFAULT_TARGET_LANGUAGE]
);

export const normalizeProficiencyRank = (language = DEFAULT_TARGET_LANGUAGE, value = null) => {
  const normalizedLanguage = normalizeBookLanguage(language);
  const options = getProficiencyLevelOptions(normalizedLanguage);
  const fallback = DEFAULT_PROFICIENCY_LEVELS_BY_LANGUAGE[normalizedLanguage]
    ?? DEFAULT_PROFICIENCY_LEVELS_BY_LANGUAGE[DEFAULT_TARGET_LANGUAGE];

  if (value == null || value === '') {
    return fallback;
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    const rank = Math.round(numeric);
    return options.some((option) => option.rank === rank) ? rank : fallback;
  }

  const raw = String(value).trim();
  const normalized = raw.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  const compact = normalized.replace(/\s+/g, '');
  const aliasRank = LEVEL_ALIASES[normalizedLanguage]?.[normalized]
    ?? LEVEL_ALIASES[normalizedLanguage]?.[compact];

  if (Number.isFinite(aliasRank)) {
    return aliasRank;
  }

  const matchedOption = options.find((option) => (
    option.value.toLowerCase() === raw.toLowerCase()
    || option.label.toLowerCase() === raw.toLowerCase()
    || option.shortLabel.toLowerCase() === raw.toLowerCase()
  ));

  return matchedOption?.rank ?? fallback;
};

export const normalizeProficiencyLevelsByLanguage = (levels = {}) => {
  const source = levels && typeof levels === 'object' ? levels : {};

  return Object.keys(PROFICIENCY_LEVEL_OPTIONS).reduce((normalized, language) => ({
    ...normalized,
    [language]: normalizeProficiencyRank(
      language,
      source[language]
        ?? source[language.toUpperCase()]
        ?? DEFAULT_PROFICIENCY_LEVELS_BY_LANGUAGE[language]
    ),
  }), {});
};

export const getProficiencyLevelForLanguage = (
  language = DEFAULT_TARGET_LANGUAGE,
  levelsByLanguage = DEFAULT_PROFICIENCY_LEVELS_BY_LANGUAGE
) => {
  const normalizedLanguage = normalizeBookLanguage(language);
  const rank = normalizeProficiencyRank(
    normalizedLanguage,
    levelsByLanguage?.[normalizedLanguage]
  );

  return getProficiencyLevelOptions(normalizedLanguage).find((option) => option.rank === rank)
    ?? getProficiencyLevelOptions(normalizedLanguage)[0];
};

export const formatProficiencyLevelLabel = (level) => (
  level ? `${level.label} · ${level.description}` : ''
);
