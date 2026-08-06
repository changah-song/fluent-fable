import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  DEFAULT_TARGET_LANGUAGE,
  DEFAULT_INTERFACE_LANGUAGE,
  DEFAULT_CHINESE_SCRIPT,
  normalizeBookLanguage,
  normalizeChineseScript,
  normalizeInterfaceLanguageCode,
  normalizeInterfaceLanguageForTarget,
} from '../constants/languages';

export const LANGUAGE_SETTINGS_KEY = '@ff/language-settings';

let runtimeTargetLanguage = DEFAULT_TARGET_LANGUAGE;
let runtimeInterfaceLanguage = DEFAULT_INTERFACE_LANGUAGE;
let runtimeChineseScript = DEFAULT_CHINESE_SCRIPT;

export const getRuntimeTargetLanguage = () => runtimeTargetLanguage;

export const getRuntimeInterfaceLanguage = () => runtimeInterfaceLanguage;

// The learner's preferred Han script. Dictionary/preprocess calls read this so
// Traditional users see Traditional headwords without every call site passing it.
export const getRuntimeChineseScript = () => runtimeChineseScript;

export const setRuntimeTargetLanguage = (language) => {
  runtimeTargetLanguage = normalizeBookLanguage(language, DEFAULT_TARGET_LANGUAGE);
  return runtimeTargetLanguage;
};

export const setRuntimeInterfaceLanguage = (language) => {
  runtimeInterfaceLanguage = normalizeInterfaceLanguageCode(language);
  return runtimeInterfaceLanguage;
};

export const setRuntimeChineseScript = (script) => {
  runtimeChineseScript = normalizeChineseScript(script, DEFAULT_CHINESE_SCRIPT);
  return runtimeChineseScript;
};

export const readStoredLanguageSettings = async () => {
  try {
    const stored = await AsyncStorage.getItem(LANGUAGE_SETTINGS_KEY);
    const parsed = stored ? JSON.parse(stored) : {};
    const targetLanguage = normalizeBookLanguage(
      parsed.targetLanguage ?? parsed.target_language,
      DEFAULT_TARGET_LANGUAGE
    );
    return {
      targetLanguage,
      interfaceLanguage: normalizeInterfaceLanguageForTarget(
        parsed.interfaceLanguage ?? parsed.interface_language,
        targetLanguage
      ),
      chineseScript: normalizeChineseScript(
        parsed.chineseScript ?? parsed.chinese_script,
        DEFAULT_CHINESE_SCRIPT
      ),
    };
  } catch (error) {
    console.warn('[interfaceLanguage] Failed to load language settings:', error);
    return {
      targetLanguage: DEFAULT_TARGET_LANGUAGE,
      interfaceLanguage: DEFAULT_INTERFACE_LANGUAGE,
      chineseScript: DEFAULT_CHINESE_SCRIPT,
    };
  }
};

export const readStoredInterfaceLanguage = async () => {
  const settings = await readStoredLanguageSettings();
  return settings.interfaceLanguage;
};

export const loadRuntimeInterfaceLanguage = async () => {
  const settings = await readStoredLanguageSettings();
  setRuntimeTargetLanguage(settings.targetLanguage);
  setRuntimeChineseScript(settings.chineseScript);
  return setRuntimeInterfaceLanguage(settings.interfaceLanguage);
};
