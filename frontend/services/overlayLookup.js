import { Platform } from 'react-native';

import {
    addOverlayExplainRequestedListener,
    addOverlayHanjaRequestedListener,
    addOverlayLookupRequestedListener,
    addOverlayRelatedKnownToggleRequestedListener,
    addOverlaySaveRequestedListener,
    addOverlayTranslationRequestedListener,
    addOcrResultListener,
    rejectOverlayLookup,
    rejectOverlaySave,
    rejectOverlayHanja,
    resolveOverlayLookup,
    resolveOverlaySave,
    resolveOverlayHanja,
    updateOverlayLookup,
} from '../modules/screen-ocr-overlay/src';
import { explainInContext } from './api/explainInContext';
import { fetchHanjaRelated } from './api/hanjaRelated';
import { translateText } from './api/googleTranslate';
import { addRelatedKnownWord, getCachedPKnown, getRelatedKnownWords, removeRelatedKnownWord } from './Database';
import { lookupWordForOverlay, saveOverlayLookupResult, unsaveOverlayLookupResult } from './dictionaryLookup';
import { getRuntimeInterfaceLanguage, getRuntimeTargetLanguage } from './interfaceLanguage';
import { getActiveOwnerId } from './localOwnerCoordinator';
import { getRuntimeActiveProfileId } from './profileScope';
import { translate } from '../i18n/translations';

let subscriptions = [];
let isInitialized = false;

const tRuntime = (key, params = {}) => translate(getRuntimeInterfaceLanguage(), key, params);

const HANJA_CHARACTER_PATTERN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/u;
const HANGUL_PATTERN = /[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F]/u;
const OCR_PREFETCH_SKIP_TOKENS = new Set([
    '은',
    '는',
    '이',
    '가',
    '을',
    '를',
    '에',
    '의',
    '와',
    '과',
    '도',
    '로',
    '으로',
]);
const MAX_HANJA_LOOKUP_CACHE_SIZE = 160;
const MAX_OVERLAY_LOOKUP_CACHE_SIZE = 240;
const MAX_OCR_PREFETCH_TARGETS = 32;
const OCR_PREFETCH_CONCURRENCY = 2;
const OVERLAY_HANJA_PRELOAD_LIMIT = 8;
const hanjaLookupCache = new Map();
const overlayLookupCache = new Map();
const overlayLookupEnrichmentCache = new Map();
let activeOcrPrefetchRun = 0;

const cleanValue = (value) => (typeof value === 'string' ? value.trim() : '');

// Shape stored related-known-words into the backend's anchor_words contract.
// Mirrors DictionaryContent's `toAnchorWords` so the OCR panel and the reader
// send grounding in the same form (see OCR-panel-parity note).
const toAnchorWords = (relatedKnownWords = []) => (
    (Array.isArray(relatedKnownWords) ? relatedKnownWords : [])
        .map((entry) => ({
            word: cleanValue(entry?.korean) || cleanValue(entry?.word),
            gloss: cleanValue(entry?.definition) || cleanValue(entry?.gloss),
        }))
        .filter((entry) => entry.word)
);

// Best-effort grounding for the agentic explanation workflow: the learner's
// cached P(known) for this word plus any related-known-word anchors. Each source
// is optional — a failure or empty result just yields an ungrounded explanation.
const gatherOverlayExplainGrounding = async (word, language) => {
    const ownerId = getActiveOwnerId();
    const profileId = getRuntimeActiveProfileId();
    const scope = { ownerId, profileId, language };

    const [pKnownResult, anchorsResult] = await Promise.allSettled([
        getCachedPKnown({ ...scope, word }),
        getRelatedKnownWords(word, language, { ownerId, profileId }),
    ]);

    const grounding = {};
    if (pKnownResult.status === 'fulfilled' && Number.isFinite(pKnownResult.value)) {
        grounding.pKnown = pKnownResult.value;
    }
    if (anchorsResult.status === 'fulfilled') {
        const anchorWords = toAnchorWords(anchorsResult.value);
        if (anchorWords.length) {
            grounding.anchorWords = anchorWords;
        }
    }
    return grounding;
};
const lookupCacheKey = ({ selectedText, selectedLineText }) => [
    getRuntimeTargetLanguage(),
    getRuntimeInterfaceLanguage(),
    cleanValue(selectedText),
    cleanValue(selectedLineText),
].join('\n');
const relatedWordKey = (entry) => `${entry?.korean ?? ''}|${entry?.hanja ?? ''}`;
const uniqueCleanValues = (values = []) => [...new Set(values.map(cleanValue).filter(Boolean))];
const formatTranslationLanguageCode = (language) => String(language || '')
    .trim()
    .split(/[-_]/)[0]
    .toUpperCase();
const extractHanjaCharacters = (value) => uniqueCleanValues(
    Array.from(cleanValue(value)).filter(char => HANJA_CHARACTER_PATTERN.test(char))
);
const normalizeHanjaLookupLimit = (limit) => {
    if (limit === undefined || limit === null || limit === 'all') {
        return 'all';
    }

    const numericLimit = Number(limit);
    return Number.isFinite(numericLimit) && numericLimit > 0 ? String(Math.floor(numericLimit)) : 'all';
};
const gradeRank = (grade) => {
    switch (cleanValue(grade)) {
        case '초급':
            return 0;
        case '중급':
            return 1;
        case '고급':
            return 2;
        default:
            return 3;
    }
};

const getCachedHanjaRelated = (character, options = {}) => {
    const interfaceLanguage = getRuntimeInterfaceLanguage();
    const cleanedCharacter = cleanValue(character);
    const limit = normalizeHanjaLookupLimit(options.limit);
    const cacheKey = [interfaceLanguage, limit, cleanedCharacter].join('|');

    if (!cleanedCharacter) {
        return Promise.resolve({
            firstTableData: [],
            similarWordsTableData: [],
        });
    }

    const cachedLookup = hanjaLookupCache.get(cacheKey);
    if (cachedLookup) {
        return cachedLookup;
    }

    const lookupPromise = fetchHanjaRelated(cleanedCharacter, { interfaceLanguage, limit }).catch((error) => {
        hanjaLookupCache.delete(cacheKey);
        throw error;
    });

    hanjaLookupCache.set(cacheKey, lookupPromise);

    while (hanjaLookupCache.size > MAX_HANJA_LOOKUP_CACHE_SIZE) {
        const oldestKey = hanjaLookupCache.keys().next().value;
        hanjaLookupCache.delete(oldestKey);
    }

    return lookupPromise;
};

const preloadHanjaCharacters = async (characters = [], options = {}) => {
    const uniqueCharacters = uniqueCleanValues(characters);

    if (uniqueCharacters.length === 0) {
        return;
    }

    await Promise.allSettled(uniqueCharacters.map(character => getCachedHanjaRelated(character, options)));
};

const getLookupHanjaPreloadTargets = (result, fallbackSourceWord) => {
    const targets = [];
    const seen = new Set();
    const addTargets = (sourceWord, hanja) => {
        const cleanedSourceWord = cleanValue(sourceWord) || fallbackSourceWord;

        extractHanjaCharacters(hanja).forEach((character) => {
            const key = `${cleanedSourceWord}|${character}`;
            if (seen.has(key)) {
                return;
            }

            seen.add(key);
            targets.push({
                sourceWord: cleanedSourceWord,
                character,
            });
        });
    };

    addTargets(cleanValue(result?.stem) || cleanValue(result?.surface), result?.hanja);

    const alternatives = Array.isArray(result?.alternatives) ? result.alternatives : [];
    alternatives.forEach((alternative) => {
        addTargets(cleanValue(alternative?.word) || cleanValue(alternative?.stem), alternative?.hanja);
    });

    return targets;
};

const preloadOverlayHanjaForLookupResult = async (result, fallbackSourceWord = '') => {
    const targets = getLookupHanjaPreloadTargets(result, cleanValue(fallbackSourceWord));
    const characters = targets.map(target => target.character);

    if (characters.length === 0) {
        return [];
    }

    const preloadOptions = { limit: OVERLAY_HANJA_PRELOAD_LIMIT };
    const knownWordCache = new Map();

    await preloadHanjaCharacters(characters, preloadOptions);
    const preloadResults = await Promise.allSettled(targets.map(async (target) => {
        const cachedResult = await getCachedHanjaRelated(target.character, preloadOptions);
        const normalized = await normalizeOverlayHanjaResult({
            requestId: '',
            character: target.character,
            sourceWord: target.sourceWord,
            result: cachedResult,
            knownWordCache,
        });

        return {
            sourceWord: target.sourceWord,
            character: target.character,
            meaning: normalized.meaning,
            sound: normalized.sound,
            relatedWords: normalized.relatedWords,
        };
    }));

    return preloadResults
        .filter(settledResult => settledResult.status === 'fulfilled')
        .map(settledResult => settledResult.value);
};

const trimOverlayLookupCache = () => {
    while (overlayLookupCache.size > MAX_OVERLAY_LOOKUP_CACHE_SIZE) {
        const oldestKey = overlayLookupCache.keys().next().value;
        overlayLookupCache.delete(oldestKey);
    }
    while (overlayLookupEnrichmentCache.size > MAX_OVERLAY_LOOKUP_CACHE_SIZE) {
        const oldestKey = overlayLookupEnrichmentCache.keys().next().value;
        overlayLookupEnrichmentCache.delete(oldestKey);
    }
};

const buildOverlayLookupPayload = async ({
    selectedText,
    selectedLineText,
    fetchLive = true,
    allowRemoteStemming = true,
}) => {
    const result = await lookupWordForOverlay({
        surface: selectedText,
        sourceSentence: selectedLineText,
        includeEnrichment: false,
        fetchLive,
        allowRemoteStemming,
    });

    return {
        ...result,
        sourceSentence: cleanValue(selectedLineText),
        hanjaPreloads: [],
    };
};

const buildOverlayLookupEnrichmentPayload = async ({ selectedText, selectedLineText }) => {
    const result = await lookupWordForOverlay({
        surface: selectedText,
        sourceSentence: selectedLineText,
        includeEnrichment: true,
    });
    const hanjaPreloads = await preloadOverlayHanjaForLookupResult(result, selectedText)
        .catch(() => []);

    return {
        ...result,
        sourceSentence: cleanValue(selectedLineText),
        hanjaPreloads,
    };
};

const buildOverlayTranslationPayload = async ({ requestId, query }) => {
    const targetLanguage = getRuntimeTargetLanguage();
    const interfaceLanguage = getRuntimeInterfaceLanguage();
    const translatedText = await translateText({
        query,
        source: targetLanguage,
        target: interfaceLanguage,
    });

    return {
        requestId,
        translation: cleanValue(translatedText),
        translationSourceLanguage: formatTranslationLanguageCode(targetLanguage),
        translationTargetLanguage: formatTranslationLanguageCode(interfaceLanguage),
    };
};

const getCachedOverlayLookup = ({ selectedText, selectedLineText }) => {
    const cacheKey = lookupCacheKey({ selectedText, selectedLineText });

    if (!cleanValue(selectedText)) {
        return Promise.reject(new Error('No text selected.'));
    }

    const cachedLookup = overlayLookupCache.get(cacheKey);
    if (cachedLookup) {
        return cachedLookup;
    }

    const lookupPromise = buildOverlayLookupPayload({ selectedText, selectedLineText })
        .catch((error) => {
            overlayLookupCache.delete(cacheKey);
            throw error;
        });

    overlayLookupCache.set(cacheKey, lookupPromise);
    trimOverlayLookupCache();

    return lookupPromise;
};

const getCachedOverlayLookupEnrichment = ({ selectedText, selectedLineText }) => {
    const cacheKey = lookupCacheKey({ selectedText, selectedLineText });

    if (!cleanValue(selectedText)) {
        return Promise.reject(new Error('No text selected.'));
    }

    const cachedLookup = overlayLookupEnrichmentCache.get(cacheKey);
    if (cachedLookup) {
        return cachedLookup;
    }

    const lookupPromise = buildOverlayLookupEnrichmentPayload({ selectedText, selectedLineText })
        .catch((error) => {
            overlayLookupEnrichmentCache.delete(cacheKey);
            throw error;
        });

    overlayLookupEnrichmentCache.set(cacheKey, lookupPromise);
    trimOverlayLookupCache();

    return lookupPromise;
};

const warmCachedOverlayLookup = async ({ selectedText, selectedLineText }) => {
    const cacheKey = lookupCacheKey({ selectedText, selectedLineText });

    if (!cleanValue(selectedText) || overlayLookupCache.has(cacheKey)) {
        return;
    }

    const result = await buildOverlayLookupPayload({
        selectedText,
        selectedLineText,
        fetchLive: false,
        allowRemoteStemming: false,
    });

    if (!cleanValue(result?.definition)) {
        return;
    }

    overlayLookupCache.set(cacheKey, Promise.resolve(result));
    trimOverlayLookupCache();
};

const enrichOverlayLookupInBackground = ({ requestId, selectedText, selectedLineText }) => {
    getCachedOverlayLookupEnrichment({ selectedText, selectedLineText })
        .then(async (result) => {
            await updateOverlayLookup(requestId, {
                requestId,
                ...result,
                sourceSentence: selectedLineText,
            });
        })
        .catch((error) => {
            console.warn(`[overlayLookup] enrichment failed for "${selectedText}":`, error?.message ?? error);
        });
};

const extractOcrPrefetchTargets = (ocrResult = {}) => {
    const targets = Array.isArray(ocrResult.targets) ? ocrResult.targets : [];
    const seen = new Set();
    const prefetchTargets = [];

    targets
        .filter(target => cleanValue(target?.kind) === 'word')
        .forEach((target) => {
            const selectedText = cleanValue(target?.text);
            const selectedLineText = cleanValue(target?.lineText) || selectedText;
            const key = lookupCacheKey({ selectedText, selectedLineText });

            if (!isUsefulOcrPrefetchTarget(target) || seen.has(key)) {
                return;
            }

            seen.add(key);
            prefetchTargets.push({ selectedText, selectedLineText });
        });

    return prefetchTargets.slice(0, MAX_OCR_PREFETCH_TARGETS);
};

const isUsefulOcrPrefetchTarget = (target = {}) => {
    const selectedText = cleanValue(target?.text);
    const lookupChars = Array.from(selectedText).filter(char => (
        /[0-9A-Za-z\u1100-\u11FF\u3130-\u318F\uAC00-\uD7A3\u4E00-\u9FFF]/.test(char)
    ));
    const box = target?.box ?? {};
    const boxWidth = Number(box.width) || 0;
    const boxHeight = Number(box.height) || 0;

    if (!selectedText || !HANGUL_PATTERN.test(selectedText)) {
        return false;
    }
    if (OCR_PREFETCH_SKIP_TOKENS.has(selectedText)) {
        return false;
    }
    if (lookupChars.length < 2 || /^\d+$/.test(selectedText)) {
        return false;
    }
    if (boxWidth > 0 && boxHeight > 0 && (boxWidth < 8 || boxHeight < 8)) {
        return false;
    }

    return true;
};

const prefetchOcrLookups = async (ocrResult = {}) => {
    const runId = activeOcrPrefetchRun + 1;
    activeOcrPrefetchRun = runId;

    const targets = extractOcrPrefetchTargets(ocrResult);
    if (targets.length === 0) {
        return;
    }

    let nextIndex = 0;
    const workerCount = Math.min(OCR_PREFETCH_CONCURRENCY, targets.length);
    const workers = Array.from({ length: workerCount }, async () => {
        while (runId === activeOcrPrefetchRun && nextIndex < targets.length) {
            const target = targets[nextIndex];
            nextIndex += 1;

            try {
                await warmCachedOverlayLookup(target);
            } catch (_error) {
                // Cache-only prefetch misses retry normally on tap.
            }
        }
    });

    await Promise.allSettled(workers);
};

const getKnownRelatedWordKeys = async (sourceWord, knownWordCache = null) => {
    const cleanedSourceWord = cleanValue(sourceWord);
    if (!cleanedSourceWord) {
        return new Set();
    }

    const ownerId = getActiveOwnerId();
    const cacheKey = [ownerId, cleanedSourceWord].join('|');
    if (knownWordCache?.has(cacheKey)) {
        return knownWordCache.get(cacheKey);
    }

    const knownWords = await getRelatedKnownWords(cleanedSourceWord, 'ko', { ownerId }).catch(() => []);
    const knownKeys = new Set(knownWords.map(relatedWordKey));
    knownWordCache?.set(cacheKey, knownKeys);
    return knownKeys;
};

const normalizeOverlayHanjaResult = async ({ requestId, character, sourceWord, result, knownWordCache = null }) => {
    // Mirror the reader's HanjaDetails header: "바를 정" (Korean hun + reading)
    // as the title line, with the interface-language meaning underneath.
    const readings = uniqueCleanValues((result?.firstTableData ?? []).map(row => (
        [cleanValue(row?.hun_korean), cleanValue(row?.reading)].filter(Boolean).join(' ')
    )));
    const meanings = uniqueCleanValues((result?.firstTableData ?? []).map(row => (
        row?.hun_display || row?.meaning || row?.hun_english
    )));
    const characters = uniqueCleanValues((result?.firstTableData ?? []).map(row => row?.hanja));
    const knownKeys = await getKnownRelatedWordKeys(sourceWord, knownWordCache);
    const relatedWords = (result?.similarWordsTableData ?? [])
        .slice()
        .sort((left, right) => (
            gradeRank(left?.word_grade) - gradeRank(right?.word_grade)
            || cleanValue(left?.korean).localeCompare(cleanValue(right?.korean), 'ko')
        ))
        .map(item => {
            const relatedWord = {
                korean: cleanValue(item?.korean),
                hanja: cleanValue(item?.hanja),
                meaning: cleanValue(item?.meaning),
            };

            return {
                ...relatedWord,
                known: knownKeys.has(relatedWordKey(relatedWord)),
            };
        })
        .filter(item => item.korean || item.hanja || item.meaning);

    return {
        requestId,
        character: characters[0] || character,
        meaning: meanings.length > 0 ? meanings.join(' · ') : null,
        sound: readings.length > 0 ? readings.join(' / ') : null,
        relatedWords,
    };
};

export const initializeOverlayLookupBridge = () => {
    if (Platform.OS !== 'android' || isInitialized) {
        return () => {};
    }

    isInitialized = true;

    const ocrResultSubscription = addOcrResultListener((event = {}) => {
        prefetchOcrLookups(event);
    });

    const lookupSubscription = addOverlayLookupRequestedListener(async (event = {}) => {
        const requestId = cleanValue(event.requestId);
        const selectedText = cleanValue(event.selectedText);
        const selectedLineText = cleanValue(event.selectedLineText);

        if (!requestId) {
            return;
        }

        try {
            const result = await getCachedOverlayLookup({
                selectedText,
                selectedLineText,
            });

            await resolveOverlayLookup(requestId, {
                requestId,
                ...result,
                sourceSentence: selectedLineText,
            });
            enrichOverlayLookupInBackground({
                requestId,
                selectedText,
                selectedLineText,
            });
        } catch (error) {
            await rejectOverlayLookup(requestId, error?.message || tRuntime('lookup.lookupFailed'));
        }
    });

    const translationSubscription = addOverlayTranslationRequestedListener(async (event = {}) => {
        const requestId = cleanValue(event.requestId);
        const query = cleanValue(event.query);

        if (!requestId || !query) {
            return;
        }

        try {
            const result = await buildOverlayTranslationPayload({ requestId, query });
            await updateOverlayLookup(requestId, result);
        } catch (error) {
            console.warn(`[overlayLookup] translation failed for "${query}":`, error?.message ?? error);
            await updateOverlayLookup(requestId, {
                requestId,
                translation: '',
                translationSourceLanguage: formatTranslationLanguageCode(getRuntimeTargetLanguage()),
                translationTargetLanguage: formatTranslationLanguageCode(getRuntimeInterfaceLanguage()),
            });
        }
    });

    const explainSubscription = addOverlayExplainRequestedListener(async (event = {}) => {
        const requestId = cleanValue(event.requestId);
        const word = cleanValue(event.word);
        const sentence = cleanValue(event.sentence);

        if (!requestId || !word) {
            return;
        }

        try {
            const targetLanguage = getRuntimeTargetLanguage();
            const grounding = await gatherOverlayExplainGrounding(word, targetLanguage);
            const response = await explainInContext({
                word,
                sentence: sentence || word,
                language: targetLanguage,
                interfaceLanguage: getRuntimeInterfaceLanguage(),
                pKnown: grounding.pKnown,
                anchorWords: grounding.anchorWords,
            });
            const explanation = cleanValue(response?.explanation);
            await updateOverlayLookup(requestId, {
                requestId,
                explanation: explanation || tRuntime('lookup.explainFailed'),
                explanationGloss: cleanValue(response?.gloss),
            });
        } catch (error) {
            console.warn(`[overlayLookup] explanation failed for "${word}":`, error?.message ?? error);
            await updateOverlayLookup(requestId, {
                requestId,
                explanation: error?.message || tRuntime('lookup.explainFailed'),
            });
        }
    });

    const saveSubscription = addOverlaySaveRequestedListener(async (event = {}) => {
        const requestId = cleanValue(event.requestId);

        if (!requestId) {
            return;
        }

        try {
            const payload = {
                stem: event.stem,
                definition: event.definition,
                hanja: event.hanja,
                sourceSentence: event.sourceSentence,
            };
            const result = event.action === 'unsave'
                ? await unsaveOverlayLookupResult(payload)
                : await saveOverlayLookupResult(payload);

            overlayLookupCache.clear();
            overlayLookupEnrichmentCache.clear();
            await resolveOverlaySave(requestId, {
                requestId,
                ...result,
            });
        } catch (error) {
            await rejectOverlaySave(requestId, error?.message || tRuntime('lookup.saveFailed'));
        }
    });

    const hanjaSubscription = addOverlayHanjaRequestedListener(async (event = {}) => {
        const requestId = cleanValue(event.requestId);
        const character = cleanValue(event.character);
        const sourceWord = cleanValue(event.sourceWord);

        if (!requestId) {
            return;
        }

        try {
            const result = await getCachedHanjaRelated(character, { limit: 'all' });
            await resolveOverlayHanja(requestId, await normalizeOverlayHanjaResult({
                requestId,
                character,
                sourceWord,
                result,
            }));
        } catch (error) {
            await rejectOverlayHanja(requestId, error?.message || tRuntime('hanja.lookupFailed'));
        }
    });

    const relatedKnownSubscription = addOverlayRelatedKnownToggleRequestedListener(async (event = {}) => {
        const sourceWord = cleanValue(event.sourceWord);
        const relatedWord = event.relatedWord ?? {};
        const entry = {
            korean: cleanValue(relatedWord.korean),
            hanja: cleanValue(relatedWord.hanja),
            meaning: cleanValue(relatedWord.meaning),
            sourceHanja: cleanValue(event.sourceHanja) || cleanValue(relatedWord.sourceHanja),
        };

        if (!sourceWord || (!entry.korean && !entry.hanja)) {
            return;
        }

        try {
            const ownerId = getActiveOwnerId();
            if (event.known) {
                await addRelatedKnownWord(sourceWord, entry, { ownerId });
            } else {
                await removeRelatedKnownWord(sourceWord, entry, 'ko', { ownerId });
            }
        } catch (error) {
            console.warn(`[overlayLookup] related known word toggle failed for "${sourceWord}":`, error?.message);
        }
    });

    subscriptions = [
        ocrResultSubscription,
        lookupSubscription,
        translationSubscription,
        explainSubscription,
        saveSubscription,
        hanjaSubscription,
        relatedKnownSubscription,
    ];

    return () => {
        subscriptions.forEach((subscription) => subscription?.remove?.());
        subscriptions = [];
        isInitialized = false;
        activeOcrPrefetchRun += 1;
        overlayLookupCache.clear();
        overlayLookupEnrichmentCache.clear();
    };
};
