import { Platform } from 'react-native';
import { EventEmitter, requireNativeModule } from 'expo-modules-core';
import { translate, UI_TRANSLATIONS } from '../../../i18n/translations';
import { getRuntimeInterfaceLanguage, getRuntimeTargetLanguage } from '../../../services/interfaceLanguage';

const NativeScreenOcrOverlay = Platform.OS === 'android'
    ? requireNativeModule('ScreenOcrOverlay')
    : null;

const eventEmitter = NativeScreenOcrOverlay
    ? new EventEmitter(NativeScreenOcrOverlay)
    : null;

const androidOnly = () => Promise.reject(new Error(
    translate(getRuntimeInterfaceLanguage(), 'ocr.androidOnly')
));
const emptySubscription = { remove: () => {} };

// The overlay is drawn by a native Service that can't read these tables itself,
// so we hand it the active language's strings. Keys match OverlayText.t() in
// OverlayText.kt: overlay.* minus the prefix, plus pos.* and languageName.* for
// its POS badges and translation header.
const OVERLAY_POS_KEYS = [
    'noun', 'verb', 'adverb', 'adjective', 'modifier', 'determiner', 'interjection',
    'pronoun', 'numeral', 'particle', 'affix', 'ending',
];
const OVERLAY_POS_COMPOUND_KEYS = {
    auxiliary_verb: 'pos.auxiliaryVerb',
    auxiliary_adjective: 'pos.auxiliaryAdjective',
    dependent_noun: 'pos.dependentNoun',
};
const OVERLAY_LANGUAGE_NAME_CODES = ['ko', 'en', 'zh', 'ja', 'es', 'fr'];

const buildOverlayStrings = (language) => {
    const table = UI_TRANSLATIONS[language] ?? UI_TRANSLATIONS.en;
    const strings = {};

    for (const key of Object.keys(table)) {
        if (key.startsWith('overlay.')) {
            strings[key.slice('overlay.'.length)] = table[key];
        }
    }

    // The native fromSurface() template lives under lookup.* in the app tables.
    // Read it raw — translate() would substitute the {{surface}} placeholder
    // away, and the native side is what fills it in.
    strings.fromSurface = table['lookup.fromSurface'] ?? UI_TRANSLATIONS.en['lookup.fromSurface'];

    for (const pos of OVERLAY_POS_KEYS) {
        strings[`pos.${pos}`] = translate(language, `pos.${pos}`);
    }
    for (const [nativeKey, appKey] of Object.entries(OVERLAY_POS_COMPOUND_KEYS)) {
        strings[`pos.${nativeKey}`] = translate(language, appKey);
    }

    for (const code of OVERLAY_LANGUAGE_NAME_CODES) {
        strings[`languageName.${code}`] = translate(language, `language.${code}`);
    }

    return strings;
};

// setOverlayInterfaceLanguage runs before every native call, so only rebuild and
// ship the bundle when the language actually changed. Native holds the strings
// process-wide, and a JS reload resets this cache, so a re-push always follows.
let lastPushedLanguage = null;

export const setOverlayInterfaceLanguage = (language = getRuntimeInterfaceLanguage()) => {
    if (!NativeScreenOcrOverlay?.setInterfaceLanguage) {
        return;
    }

    if (language === lastPushedLanguage) {
        NativeScreenOcrOverlay.setInterfaceLanguage(language, null);
        return;
    }

    NativeScreenOcrOverlay.setInterfaceLanguage(language, buildOverlayStrings(language));
    lastPushedLanguage = language;
};

// The overlay Service picks its OCR recognizer from the target language it last
// received, so push the current one (mirrors the Profile page) before every native
// call — cheap and keeps a freshly started capture session on the right script.
let lastPushedTargetLanguage = null;
export const setOverlayTargetLanguage = (language = getRuntimeTargetLanguage()) => {
    if (!NativeScreenOcrOverlay?.setTargetLanguage || language === lastPushedTargetLanguage) {
        return;
    }
    NativeScreenOcrOverlay.setTargetLanguage(language);
    lastPushedTargetLanguage = language;
};

const callNative = (method, ...args) => {
    if (!NativeScreenOcrOverlay?.[method]) {
        return androidOnly();
    }
    setOverlayInterfaceLanguage();
    setOverlayTargetLanguage();
    return NativeScreenOcrOverlay[method](...args);
};

export const requestOverlayPermission = () => (
    callNative('requestOverlayPermission')
);

export const isOverlayPermissionGranted = () => (
    NativeScreenOcrOverlay
        ? (setOverlayInterfaceLanguage(), NativeScreenOcrOverlay.isOverlayPermissionGranted?.() ?? false)
        : false
);

export const requestScreenCapture = () => (
    callNative('requestScreenCapture')
);

export const isScreenCaptureActive = () => (
    NativeScreenOcrOverlay
        ? (setOverlayInterfaceLanguage(), NativeScreenOcrOverlay.isScreenCaptureActive?.() ?? false)
        : false
);

export const startFloatingWidget = () => (
    callNative('startFloatingWidget')
);

export const stopFloatingWidget = () => (
    callNative('stopFloatingWidget')
);

export const analyzeCurrentScreen = () => (
    callNative('analyzeCurrentScreen')
);

export const resolveOverlayLookup = (requestId, result) => (
    callNative('resolveOverlayLookup', requestId, result)
);

export const updateOverlayLookup = (requestId, result) => (
    callNative('updateOverlayLookup', requestId, result)
);

export const rejectOverlayLookup = (requestId, message) => (
    callNative('rejectOverlayLookup', requestId, message)
);

export const resolveOverlaySave = (requestId, result) => (
    callNative('resolveOverlaySave', requestId, result)
);

export const rejectOverlaySave = (requestId, message) => (
    callNative('rejectOverlaySave', requestId, message)
);

export const resolveOverlayHanja = (requestId, result) => (
    callNative('resolveOverlayHanja', requestId, result)
);

export const rejectOverlayHanja = (requestId, message) => (
    callNative('rejectOverlayHanja', requestId, message)
);

export const addOverlayStatusListener = (listener) => (
    eventEmitter?.addListener('onOverlayStatus', listener) ?? emptySubscription
);

export const onOverlayStatus = addOverlayStatusListener;

export const addOcrResultListener = (listener) => (
    eventEmitter?.addListener('onOcrResult', listener) ?? emptySubscription
);

export const onOcrResult = addOcrResultListener;

export const addOcrWordSelectedListener = (listener) => (
    eventEmitter?.addListener('onOcrWordSelected', listener) ?? emptySubscription
);

export const onOcrWordSelected = addOcrWordSelectedListener;

export const addOverlayLookupRequestedListener = (listener) => (
    eventEmitter?.addListener('onOverlayLookupRequested', listener) ?? emptySubscription
);

export const onOverlayLookupRequested = addOverlayLookupRequestedListener;

export const addOverlayTranslationRequestedListener = (listener) => (
    eventEmitter?.addListener('onOverlayTranslationRequested', listener) ?? emptySubscription
);

export const onOverlayTranslationRequested = addOverlayTranslationRequestedListener;

export const addOverlayExplainRequestedListener = (listener) => (
    eventEmitter?.addListener('onOverlayExplainRequested', listener) ?? emptySubscription
);

export const onOverlayExplainRequested = addOverlayExplainRequestedListener;

export const addOverlaySaveRequestedListener = (listener) => (
    eventEmitter?.addListener('onOverlaySaveRequested', listener) ?? emptySubscription
);

export const onOverlaySaveRequested = addOverlaySaveRequestedListener;

export const addOverlayHanjaRequestedListener = (listener) => (
    eventEmitter?.addListener('onOverlayHanjaRequested', listener) ?? emptySubscription
);

export const onOverlayHanjaRequested = addOverlayHanjaRequestedListener;

export const addOverlayRelatedKnownToggleRequestedListener = (listener) => (
    eventEmitter?.addListener('onOverlayRelatedKnownToggleRequested', listener) ?? emptySubscription
);

export const onOverlayRelatedKnownToggleRequested = addOverlayRelatedKnownToggleRequestedListener;

export const addOverlayErrorListener = (listener) => (
    eventEmitter?.addListener('onOverlayError', listener) ?? emptySubscription
);

export const onOverlayError = addOverlayErrorListener;

export default {
    requestOverlayPermission,
    isOverlayPermissionGranted,
    requestScreenCapture,
    isScreenCaptureActive,
    startFloatingWidget,
    stopFloatingWidget,
    analyzeCurrentScreen,
    resolveOverlayLookup,
    updateOverlayLookup,
    rejectOverlayLookup,
    resolveOverlaySave,
    rejectOverlaySave,
    resolveOverlayHanja,
    rejectOverlayHanja,
    setOverlayInterfaceLanguage,
    addOverlayStatusListener,
    addOcrResultListener,
    addOcrWordSelectedListener,
    addOverlayLookupRequestedListener,
    addOverlayTranslationRequestedListener,
    addOverlayExplainRequestedListener,
    addOverlaySaveRequestedListener,
    addOverlayHanjaRequestedListener,
    addOverlayRelatedKnownToggleRequestedListener,
    addOverlayErrorListener,
    onOverlayStatus,
    onOcrResult,
    onOcrWordSelected,
    onOverlayLookupRequested,
    onOverlayExplainRequested,
    onOverlaySaveRequested,
    onOverlayHanjaRequested,
    onOverlayRelatedKnownToggleRequested,
    onOverlayError,
};
