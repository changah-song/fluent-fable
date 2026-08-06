import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  DEFAULT_LANGUAGE_SETTINGS,
  DEFAULT_CHINESE_SCRIPT,
  getLanguageLabel,
  normalizeChineseScript,
  normalizeLanguageCode,
  normalizeInterfaceLanguageForTarget,
} from '../constants/languages';
import {
  DEFAULT_PROFICIENCY_LEVELS_BY_LANGUAGE,
  getProficiencyLevelForLanguage,
  normalizeProficiencyLevelsByLanguage,
  normalizeProficiencyRank,
} from '../constants/proficiencyLevels';
import { useLocalOwner } from './LocalOwnerContext';
import { isCurrentSyncGeneration } from '../services/localOwnerCoordinator';
import {
  fetchUserAccountSettings,
  updateUserAccountSettingsFields,
  upsertUserAccountSettings,
} from '../services/accountSettingsCloudSync';
import {
  LANGUAGE_SETTINGS_KEY,
  setRuntimeChineseScript,
  setRuntimeInterfaceLanguage,
  setRuntimeTargetLanguage,
} from '../services/interfaceLanguage';
import {
  DEFAULT_ACTIVE_PROFILE_ID,
  getDefaultProfileIdForLanguage,
  setRuntimeActiveProfileId,
} from '../services/profileScope';
import {
  ensureProfileAbilitySeed,
  replaceDefaultProfileId,
} from '../services/Database';
import {
  fetchUserPreferences,
  getTimestampMs,
  updateUserPreferenceFields,
  upsertUserPreferences,
} from '../services/preferencesCloudSync';
import { upsertUserProfile } from '../services/profilesCloudSync';
import { ThemeProvider } from '../theme/tokens';

const AppContext = createContext({
  dictMode: true,
  setDictMode: () => {},
  ...DEFAULT_LANGUAGE_SETTINGS,
  setTargetLanguage: () => {},
  setChineseScript: () => {},
  setNativeLanguage: () => {},
  setInterfaceLanguage: () => {},
  levelsByLanguage: DEFAULT_PROFICIENCY_LEVELS_BY_LANGUAGE,
  targetLanguageLevel: getProficiencyLevelForLanguage(
    DEFAULT_LANGUAGE_SETTINGS.targetLanguage,
    DEFAULT_PROFICIENCY_LEVELS_BY_LANGUAGE
  ),
  setLanguageLevel: () => {},
  setTargetLanguageLevel: () => {},
  activeProfileId: DEFAULT_ACTIVE_PROFILE_ID,
  setActiveProfileId: () => {},
  switchProfile: () => {},
  isDarkMode: false,
  setIsDarkMode: () => {},
  toggleDarkMode: () => {},
  notificationsEnabled: true,
  setNotificationsEnabled: () => {},
  personalizedVocabEnabled: true,
  setPersonalizedVocabEnabled: () => {},
  languageSettingsReady: false,
  updateLanguageSettings: () => {},
  syncLanguagePreferences: () => Promise.resolve(),
});

const normalizeProfileId = (profileId, targetLanguage) => {
  const fallbackProfileId = getDefaultProfileIdForLanguage(targetLanguage);
  return typeof profileId === 'string' && profileId.trim()
    ? profileId.trim()
    : fallbackProfileId;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (value) => typeof value === 'string' && UUID_RE.test(value);

const normalizeBoolean = (value, fallback = false) => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'dark'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'light'].includes(normalized)) {
      return false;
    }
  }
  if (typeof value === 'number') {
    return value !== 0;
  }

  return fallback;
};

const normalizeLanguageSettings = (settings = {}) => {
  const targetLanguage = normalizeLanguageCode(
    settings.targetLanguage ?? settings.target_language,
    DEFAULT_LANGUAGE_SETTINGS.targetLanguage
  );

  return {
    targetLanguage,
    chineseScript: normalizeChineseScript(
      settings.chineseScript ?? settings.chinese_script,
      DEFAULT_CHINESE_SCRIPT
    ),
    nativeLanguage: normalizeLanguageCode(
      settings.nativeLanguage ?? settings.native_language,
      DEFAULT_LANGUAGE_SETTINGS.nativeLanguage
    ),
    interfaceLanguage: normalizeInterfaceLanguageForTarget(
      settings.interfaceLanguage
        ?? settings.interface_language,
      targetLanguage
    ),
    activeProfileId: normalizeProfileId(
      settings.activeProfileId ?? settings.active_profile_id,
      targetLanguage
    ),
    levelsByLanguage: normalizeProficiencyLevelsByLanguage(
      settings.levelsByLanguage
        ?? settings.levels_by_language
        ?? settings.proficiencyLevelsByLanguage
        ?? settings.proficiency_levels_by_language
        ?? settings.readingLevelsByLanguage
        ?? settings.reading_levels_by_language
    ),
    isDarkMode: normalizeBoolean(
      settings.isDarkMode
        ?? settings.is_dark_mode
        ?? settings.darkMode
        ?? settings.dark_mode,
      false
    ),
    notificationsEnabled: normalizeBoolean(
      settings.notificationsEnabled
        ?? settings.notifications_enabled,
      true
    ),
    personalizedVocabEnabled: normalizeBoolean(
      settings.personalizedVocabEnabled
        ?? settings.personalized_vocab_enabled,
      true
    ),
    updatedAt: settings.updatedAt
      ?? settings.updated_at
      ?? null,
  };
};

const settingsFromCloudPreferences = (preferences = {}) => normalizeLanguageSettings({
  target_language: preferences.target_language,
  native_language: preferences.native_language,
  active_profile_id: preferences.active_profile_id,
  is_dark_mode: preferences.reader_settings?.isDarkMode
    ?? preferences.reader_settings?.is_dark_mode
    ?? preferences.reader_settings?.darkMode,
  updated_at: preferences.updated_at,
});

const settingsFromCloudAccount = (account = {}) => normalizeLanguageSettings({
  interface_language: account.interface_language,
  updated_at: account.updated_at,
});

const toCloudLanguagePreferencePatch = (settings) => ({
  target_language: settings.targetLanguage,
  native_language: settings.nativeLanguage,
  active_profile_id: isUuid(settings.activeProfileId) ? settings.activeProfileId : undefined,
  updated_at: settings.updatedAt,
});

const toCloudAccountLanguagePatch = (settings) => ({
  interface_language: settings.interfaceLanguage,
  updated_at: settings.updatedAt,
});

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

const hasLearningLanguagePatch = (patch = {}) => (
  hasOwn(patch, 'targetLanguage')
  || hasOwn(patch, 'target_language')
  || hasOwn(patch, 'nativeLanguage')
  || hasOwn(patch, 'native_language')
  || hasOwn(patch, 'activeProfileId')
  || hasOwn(patch, 'active_profile_id')
);

const hasInterfaceLanguagePatch = (patch = {}) => (
  hasOwn(patch, 'interfaceLanguage')
  || hasOwn(patch, 'interface_language')
);

const latestTimestamp = (...values) => values.reduce((latest, value) => (
  getTimestampMs(value) > getTimestampMs(latest) ? value : latest
), null);

export const AppProvider = ({ children, user }) => {
  const { activeOwnerId, syncPaused, syncGeneration } = useLocalOwner();
  const [dictMode, setDictMode] = useState(true);
  const [languageSettings, setLanguageSettings] = useState({
    ...DEFAULT_LANGUAGE_SETTINGS,
    levelsByLanguage: DEFAULT_PROFICIENCY_LEVELS_BY_LANGUAGE,
    activeProfileId: DEFAULT_ACTIVE_PROFILE_ID,
    isDarkMode: false,
    updatedAt: null,
  });
  const [languageSettingsReady, setLanguageSettingsReady] = useState(false);
  const latestLanguageSettingsRef = useRef(languageSettings);
  const lastSyncedUserIdRef = useRef(null);

  useEffect(() => {
    latestLanguageSettingsRef.current = languageSettings;
  }, [languageSettings]);

  const persistLocalLanguageSettings = useCallback(async (settings) => {
    await AsyncStorage.setItem(LANGUAGE_SETTINGS_KEY, JSON.stringify(settings));
  }, []);

  const saveLanguageSettings = useCallback((patch, options = {}) => {
    const {
      syncCloud = true,
      updatedAt = new Date().toISOString(),
    } = options;

    setLanguageSettings((current) => {
      const next = normalizeLanguageSettings({
        ...current,
        ...patch,
        updatedAt,
      });

      latestLanguageSettingsRef.current = next;
      setRuntimeInterfaceLanguage(next.interfaceLanguage);
      setRuntimeTargetLanguage(next.targetLanguage);
      setRuntimeChineseScript(next.chineseScript);
      setRuntimeActiveProfileId(next.activeProfileId, next.targetLanguage);
      persistLocalLanguageSettings(next).catch((error) => {
        console.warn('[AppContext] Failed to persist language settings:', error);
      });

      if (
        syncCloud
        && user?.id
        && activeOwnerId === user.id
        && !syncPaused
        && isCurrentSyncGeneration(syncGeneration)
      ) {
        const syncTasks = [];
        if (hasLearningLanguagePatch(patch)) {
          syncTasks.push(updateUserPreferenceFields({
            user,
            ownerId: activeOwnerId,
            generation: syncGeneration,
            patch: toCloudLanguagePreferencePatch(next),
          }));
        }
        if (hasInterfaceLanguagePatch(patch)) {
          syncTasks.push(updateUserAccountSettingsFields({
            user,
            ownerId: activeOwnerId,
            generation: syncGeneration,
            patch: toCloudAccountLanguagePatch(next),
          }));
        }

        Promise.all(syncTasks).catch((error) => {
          console.warn('[AppContext] Failed to sync language settings:', error?.message ?? error);
        });
      }

      return next;
    });
  }, [activeOwnerId, persistLocalLanguageSettings, syncGeneration, syncPaused, user]);

  const ensureCloudProfileForSettings = useCallback(async (nextUser, ownerId, generation, settings) => {
    if (!nextUser?.id) {
      return settings;
    }

    if (isUuid(settings.activeProfileId)) {
      return settings;
    }

    const profile = await upsertUserProfile({
      user: nextUser,
      ownerId,
      generation,
      targetLanguage: settings.targetLanguage,
      script: settings.targetLanguage === 'zh'
        ? normalizeChineseScript(settings.chineseScript, DEFAULT_CHINESE_SCRIPT)
        : undefined,
      displayName: getLanguageLabel(settings.targetLanguage),
    });

    if (!isCurrentSyncGeneration(generation)) {
      return null;
    }

    const nextSettings = normalizeLanguageSettings({
      ...settings,
      activeProfileId: profile.id,
    });

    replaceDefaultProfileId(profile.id, settings.targetLanguage).catch((error) => {
      console.warn('[AppContext] Failed to backfill local profile id:', error?.message ?? error);
    });

    return nextSettings;
  }, []);

  const syncLanguagePreferences = useCallback(async (nextUser = user) => {
    if (
      !languageSettingsReady
      || !nextUser?.id
      || syncPaused
      || activeOwnerId !== nextUser.id
      || !isCurrentSyncGeneration(syncGeneration)
    ) {
      return;
    }

    const ownerId = activeOwnerId;
    const generation = syncGeneration;
    const localSettings = latestLanguageSettingsRef.current;
    const [cloudPreferences, cloudAccount] = await Promise.all([
      fetchUserPreferences(nextUser.id),
      fetchUserAccountSettings(nextUser.id),
    ]);
    if (!isCurrentSyncGeneration(generation)) {
      return;
    }

    let localWithTimestamp = {
      ...localSettings,
      updatedAt: localSettings.updatedAt ?? new Date().toISOString(),
    };
    localWithTimestamp = await ensureCloudProfileForSettings(
      nextUser,
      ownerId,
      generation,
      localWithTimestamp
    );
    if (!localWithTimestamp) {
      return;
    }

    if (!cloudPreferences && !cloudAccount) {
      await Promise.all([
        upsertUserPreferences({
          user: nextUser,
          ownerId,
          generation,
          preferences: toCloudLanguagePreferencePatch(localWithTimestamp),
        }),
        upsertUserAccountSettings({
          user: nextUser,
          ownerId,
          generation,
          account: toCloudAccountLanguagePatch(localWithTimestamp),
        }),
      ]);
      if (!isCurrentSyncGeneration(generation)) {
        return;
      }
      latestLanguageSettingsRef.current = localWithTimestamp;
      setRuntimeInterfaceLanguage(localWithTimestamp.interfaceLanguage);
      setRuntimeTargetLanguage(localWithTimestamp.targetLanguage);
      setRuntimeChineseScript(localWithTimestamp.chineseScript);
      setRuntimeActiveProfileId(localWithTimestamp.activeProfileId, localWithTimestamp.targetLanguage);
      setLanguageSettings(localWithTimestamp);
      await persistLocalLanguageSettings(localWithTimestamp);
      return;
    }

    const cloudTimestamp = latestTimestamp(
      cloudPreferences?.updated_at,
      cloudAccount?.updated_at
    );
    const cloudPreferenceSettings = settingsFromCloudPreferences({
      ...cloudPreferences,
      interface_language: localSettings.interfaceLanguage,
    });
    const cloudAccountSettings = settingsFromCloudAccount({
      ...cloudAccount,
      target_language: localSettings.targetLanguage,
      native_language: localSettings.nativeLanguage,
    });
    let cloudSettings = normalizeLanguageSettings({
      // chineseScript is a local-only display preference (not yet a cloud column),
      // so always carry the local value through a cloud merge rather than defaulting.
      chineseScript: localSettings.chineseScript,
      targetLanguage: cloudPreferences
        ? cloudPreferenceSettings.targetLanguage
        : localSettings.targetLanguage,
      nativeLanguage: cloudPreferences
        ? cloudPreferenceSettings.nativeLanguage
        : localSettings.nativeLanguage,
      interfaceLanguage: cloudAccount
        ? cloudAccountSettings.interfaceLanguage
        : localSettings.interfaceLanguage,
      activeProfileId: cloudPreferences
        ? cloudPreferenceSettings.activeProfileId
        : localSettings.activeProfileId,
      levelsByLanguage: localSettings.levelsByLanguage,
      isDarkMode: cloudPreferences
        ? cloudPreferenceSettings.isDarkMode
        : localSettings.isDarkMode,
      updatedAt: cloudTimestamp,
    });
    cloudSettings = await ensureCloudProfileForSettings(
      nextUser,
      ownerId,
      generation,
      cloudSettings
    );
    if (!cloudSettings) {
      return;
    }
    const localTimestamp = localSettings.updatedAt;

    if (cloudTimestamp && getTimestampMs(cloudTimestamp) > getTimestampMs(localTimestamp)) {
      const nextSettings = {
        ...cloudSettings,
        updatedAt: cloudTimestamp,
      };
      if (!isCurrentSyncGeneration(generation)) {
        return;
      }
      latestLanguageSettingsRef.current = nextSettings;
      setRuntimeInterfaceLanguage(nextSettings.interfaceLanguage);
      setRuntimeTargetLanguage(nextSettings.targetLanguage);
      setRuntimeChineseScript(nextSettings.chineseScript);
      setRuntimeActiveProfileId(nextSettings.activeProfileId, nextSettings.targetLanguage);
      setLanguageSettings(nextSettings);
      await persistLocalLanguageSettings(nextSettings);
      if (!cloudPreferences?.active_profile_id && isUuid(nextSettings.activeProfileId)) {
        await updateUserPreferenceFields({
          user: nextUser,
          ownerId,
          generation,
          patch: toCloudLanguagePreferencePatch(nextSettings),
        });
      }
      return;
    }

    await Promise.all([
      cloudPreferences ? updateUserPreferenceFields({
        user: nextUser,
        ownerId,
        generation,
        patch: toCloudLanguagePreferencePatch(localWithTimestamp),
      }) : upsertUserPreferences({
        user: nextUser,
        ownerId,
        generation,
        preferences: toCloudLanguagePreferencePatch(localWithTimestamp),
      }),
      cloudAccount ? updateUserAccountSettingsFields({
        user: nextUser,
        ownerId,
        generation,
        patch: toCloudAccountLanguagePatch(localWithTimestamp),
      }) : upsertUserAccountSettings({
        user: nextUser,
        ownerId,
        generation,
        account: toCloudAccountLanguagePatch(localWithTimestamp),
      }),
    ]);
  }, [
    activeOwnerId,
    ensureCloudProfileForSettings,
    languageSettingsReady,
    persistLocalLanguageSettings,
    syncGeneration,
    syncPaused,
    user,
  ]);

  useEffect(() => {
    let isMounted = true;

    const loadLanguageSettings = async () => {
      try {
        const stored = await AsyncStorage.getItem(LANGUAGE_SETTINGS_KEY);
        const parsed = stored ? JSON.parse(stored) : {};
        const nextSettings = normalizeLanguageSettings({
          ...DEFAULT_LANGUAGE_SETTINGS,
          ...parsed,
          updatedAt: parsed.updatedAt ?? parsed.updated_at ?? null,
        });

        if (!isMounted) {
          return;
        }

        latestLanguageSettingsRef.current = nextSettings;
        setRuntimeInterfaceLanguage(nextSettings.interfaceLanguage);
        setRuntimeTargetLanguage(nextSettings.targetLanguage);
        setRuntimeChineseScript(nextSettings.chineseScript);
        setRuntimeActiveProfileId(nextSettings.activeProfileId, nextSettings.targetLanguage);
        setLanguageSettings(nextSettings);
      } catch (error) {
        console.warn('[AppContext] Failed to load language settings:', error);
      } finally {
        if (isMounted) {
          setLanguageSettingsReady(true);
        }
      }
    };

    loadLanguageSettings();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!languageSettingsReady) {
      return;
    }

    if (!user?.id || syncPaused || activeOwnerId !== user.id || !isCurrentSyncGeneration(syncGeneration)) {
      lastSyncedUserIdRef.current = null;
      return;
    }

    if (lastSyncedUserIdRef.current === user.id) {
      return;
    }

    lastSyncedUserIdRef.current = user.id;
    syncLanguagePreferences(user).catch((error) => {
      lastSyncedUserIdRef.current = null;
      console.warn('[AppContext] Failed to merge cloud language preferences:', error?.message ?? error);
    });
  }, [activeOwnerId, languageSettingsReady, syncGeneration, syncLanguagePreferences, syncPaused, user]);

  // Cold start: give the active profile a neutral, non-null ability row so
  // scoring and reader underlines have a theta to move. Level is no longer
  // self-reported — it's learned from reading (lookups / reviews / exposure move
  // theta from neutral). `ensureProfileAbilitySeed` is cold-only idempotent, so
  // re-running on every profile / language change never clobbers a theta that
  // behavior has already moved (Phase 3).
  useEffect(() => {
    if (!languageSettingsReady) {
      return;
    }

    ensureProfileAbilitySeed({
      ownerId: activeOwnerId,
      profileId: languageSettings.activeProfileId,
      language: languageSettings.targetLanguage,
    }).catch((error) => {
      console.warn('[AppContext] Failed to seed profile ability:', error?.message ?? error);
    });
  }, [
    activeOwnerId,
    languageSettingsReady,
    languageSettings.activeProfileId,
    languageSettings.targetLanguage,
  ]);

  const value = useMemo(() => ({
    dictMode,
    setDictMode,
    targetLanguage: languageSettings.targetLanguage,
    setTargetLanguage: (targetLanguage) => saveLanguageSettings({ targetLanguage }),
    chineseScript: languageSettings.chineseScript,
    setChineseScript: (chineseScript) => saveLanguageSettings({ chineseScript }),
    nativeLanguage: languageSettings.nativeLanguage,
    setNativeLanguage: (nativeLanguage) => saveLanguageSettings({ nativeLanguage }),
    interfaceLanguage: languageSettings.interfaceLanguage,
    setInterfaceLanguage: (interfaceLanguage) => saveLanguageSettings({ interfaceLanguage }),
    levelsByLanguage: languageSettings.levelsByLanguage,
    targetLanguageLevel: getProficiencyLevelForLanguage(
      languageSettings.targetLanguage,
      languageSettings.levelsByLanguage
    ),
    setLanguageLevel: (language, level) => {
      const normalizedLanguage = normalizeLanguageCode(language, languageSettings.targetLanguage);
      const rank = normalizeProficiencyRank(normalizedLanguage, level);
      saveLanguageSettings({
        levelsByLanguage: {
          ...languageSettings.levelsByLanguage,
          [normalizedLanguage]: rank,
        },
      });
    },
    setTargetLanguageLevel: (level) => {
      const normalizedLanguage = languageSettings.targetLanguage;
      const rank = normalizeProficiencyRank(normalizedLanguage, level);
      saveLanguageSettings({
        levelsByLanguage: {
          ...languageSettings.levelsByLanguage,
          [normalizedLanguage]: rank,
        },
      });
    },
    activeProfileId: languageSettings.activeProfileId,
    setActiveProfileId: (activeProfileId) => saveLanguageSettings({ activeProfileId }),
    switchProfile: (profileId, targetLanguage) => saveLanguageSettings({
      activeProfileId: profileId,
      targetLanguage,
    }),
    isDarkMode: languageSettings.isDarkMode,
    setIsDarkMode: (isDarkMode) => saveLanguageSettings({ isDarkMode }),
    toggleDarkMode: () => saveLanguageSettings({ isDarkMode: !languageSettings.isDarkMode }),
    notificationsEnabled: languageSettings.notificationsEnabled ?? true,
    setNotificationsEnabled: (notificationsEnabled) => saveLanguageSettings({ notificationsEnabled }),
    personalizedVocabEnabled: languageSettings.personalizedVocabEnabled ?? true,
    setPersonalizedVocabEnabled: (personalizedVocabEnabled) => saveLanguageSettings({ personalizedVocabEnabled }),
    languageSettingsReady,
    updateLanguageSettings: saveLanguageSettings,
    syncLanguagePreferences,
  }), [
    dictMode,
    languageSettings.chineseScript,
    languageSettings.interfaceLanguage,
    languageSettings.levelsByLanguage,
    languageSettings.nativeLanguage,
    languageSettings.activeProfileId,
    languageSettings.isDarkMode,
    languageSettings.notificationsEnabled,
    languageSettings.personalizedVocabEnabled,
    languageSettings.targetLanguage,
    languageSettingsReady,
    saveLanguageSettings,
    syncLanguagePreferences,
  ]);

  return (
    <AppContext.Provider value={value}>
      <ThemeProvider isDarkMode={languageSettings.isDarkMode}>
        {children}
      </ThemeProvider>
    </AppContext.Provider>
  );
};

export const useAppContext = () => useContext(AppContext);
