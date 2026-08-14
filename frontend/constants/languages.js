export const SUPPORTED_LANGUAGES = {
  ko: 'Korean',
  zh: 'Chinese',
};

// Book/reading languages the app can actually open and look up words for today.
// A book whose language falls outside this set can't be imported yet. Keep in
// sync with the dictionaries that ship on the backend (ko_dict / zh_dict).
export const SUPPORTED_BOOK_LANGUAGES = ['ko', 'zh'];

export const DEFAULT_CHINESE_SCRIPT = 'zh-Hans';

export const KRDICT_INTERFACE_LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English' },
  { code: 'zh', label: '简体中文' },
  { code: 'zh-Hant', label: '繁體中文' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
  { code: 'ar', label: 'العربية' },
  { code: 'mn', label: 'Монгол' },
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'th', label: 'ไทย' },
  { code: 'id', label: 'Bahasa Indonesia' },
  { code: 'ru', label: 'Русский' },
];

export const SUPPORTED_INTERFACE_LANGUAGES = KRDICT_INTERFACE_LANGUAGE_OPTIONS.reduce(
  (languages, option) => ({
    ...languages,
    [option.code]: option.label,
  }),
  {}
);

export const DEFAULT_TARGET_LANGUAGE = 'ko';
export const DEFAULT_INTERFACE_LANGUAGE = 'en';

export const normalizeChineseScript = (script, fallback = 'zh-Hans') => {
  const raw = String(script || '').trim().toLowerCase().replace('_', '-');
  if (['zh-hant', 'hant', 'traditional', 'trad'].includes(raw)) {
    return 'zh-Hant';
  }
  if (['zh-hans', 'hans', 'simplified', 'simp'].includes(raw)) {
    return 'zh-Hans';
  }
  return fallback;
};

export const getInterfaceLanguageFallbackForTarget = (targetLanguage = DEFAULT_TARGET_LANGUAGE) => (
  KRDICT_INTERFACE_LANGUAGE_OPTIONS.find((option) => option.code !== targetLanguage)?.code
    ?? DEFAULT_INTERFACE_LANGUAGE
);

export const DEFAULT_LANGUAGE_SETTINGS = {
  targetLanguage: DEFAULT_TARGET_LANGUAGE,
  nativeLanguage: 'en',
  interfaceLanguage: DEFAULT_INTERFACE_LANGUAGE,
  // Which Han script the learner reads Chinese in. Purely a display/lookup
  // preference — the dictionary indexes both Simplified and Traditional, so this
  // only decides which headword form is shown, not whether a word is found.
  chineseScript: DEFAULT_CHINESE_SCRIPT,
};

export const normalizeLanguageCode = (code, fallback = DEFAULT_TARGET_LANGUAGE) => {
  const raw = String(code || '').trim().toLowerCase();
  const shortCode = raw.split(/[-_]/)[0];

  return SUPPORTED_LANGUAGES[shortCode] ? shortCode : fallback;
};

export const normalizeInterfaceLanguageCode = (code, fallback = DEFAULT_INTERFACE_LANGUAGE) => {
  const raw = String(code || '').trim().toLowerCase().replace('_', '-');

  // Traditional Chinese keeps its script tag — plain short-code stripping below
  // would collapse it into Simplified 'zh'.
  if (['zh-hant', 'zh-tw', 'zh-hk', 'zh-mo'].includes(raw)) {
    return 'zh-Hant';
  }

  const shortCode = raw.split(/[-_]/)[0];

  return SUPPORTED_INTERFACE_LANGUAGES[shortCode] ? shortCode : fallback;
};

export const normalizeInterfaceLanguageForTarget = (
  code,
  targetLanguage = DEFAULT_TARGET_LANGUAGE
) => {
  const normalizedTargetLanguage = normalizeLanguageCode(targetLanguage, DEFAULT_TARGET_LANGUAGE);
  const fallback = getInterfaceLanguageFallbackForTarget(normalizedTargetLanguage);
  const normalizedInterfaceLanguage = normalizeInterfaceLanguageCode(code, fallback);

  return normalizedInterfaceLanguage === normalizedTargetLanguage
    ? fallback
    : normalizedInterfaceLanguage;
};

export const normalizeBookLanguage = (value, fallback = DEFAULT_TARGET_LANGUAGE) => {
  const raw = String(value || '').trim().toLowerCase();

  if (raw.startsWith('ko')) return 'ko';
  if (raw.startsWith('en')) return 'en';
  if (raw.startsWith('zh')) return 'zh';

  return fallback;
};

export const isKoreanLanguage = (language) => normalizeBookLanguage(language) === 'ko';

// Options shown in the "learning language" picker. Chinese is a single option:
// the dictionary indexes both Simplified and Traditional and the definition panel
// shows both forms, so the learner no longer picks a script here. `chineseScript`
// stays as an internal display/lookup default (see DEFAULT_CHINESE_SCRIPT).
export const TARGET_LANGUAGE_OPTIONS = [
  { id: 'ko', targetLanguage: 'ko', label: '한국어' },
  { id: 'zh', targetLanguage: 'zh', label: '中文' },
];

// Which picker row is currently active, given the stored target language.
export const getActiveTargetLanguageOptionId = (targetLanguage) => (
  normalizeLanguageCode(targetLanguage)
);

export const getLanguageLabel = (code) => (
  SUPPORTED_LANGUAGES[normalizeLanguageCode(code)] ?? SUPPORTED_LANGUAGES[DEFAULT_TARGET_LANGUAGE]
);

export const getInterfaceLanguageLabel = (code) => (
  SUPPORTED_INTERFACE_LANGUAGES[normalizeInterfaceLanguageCode(code)]
    ?? SUPPORTED_INTERFACE_LANGUAGES[DEFAULT_INTERFACE_LANGUAGE]
);
