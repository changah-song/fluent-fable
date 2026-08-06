import { api } from './api/client';
import {
    getCachedPKnown,
    insertCacheEntries,
    insertData,
    logInteractionEvent,
    lookupBookIndexBySurface,
    lookupCacheByStems,
    recordVocabContext,
    removeData,
    updateCacheRomanizations,
    updateThetaFromOutcome,
    vocabEntryExists,
} from './Database';
import { LOOKUP_LEARNING_RATE } from './abilityModel';
import stemWord from './api/stemWord';
import { getActiveOwnerId } from './localOwnerCoordinator';
import {
  getRuntimeChineseScript,
  getRuntimeInterfaceLanguage,
  getRuntimeTargetLanguage,
} from './interfaceLanguage';
import { requestUserDataSync } from './userDataSyncQueue';
import { normalizeBookLanguage, normalizeInterfaceLanguageCode } from '../constants/languages';
import { translate } from '../i18n/translations';

const STOP_STEMS = new Set([
    '하다',
    '되다',
    '있다',
    '없다',
    '이다',
    '아니다',
    '같다',
    '보다',
]);

const tRuntime = (key, params = {}) => translate(getRuntimeInterfaceLanguage(), key, params);

const KOREAN_RE = /[^\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F]/g;
const ENGLISH_EDGE_RE = /^[^A-Za-z]+|[^A-Za-z]+$/g;
const CHINESE_EDGE_RE = /^[^\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]+|[^\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]+$/g;
const MAX_ALTERNATIVES = 5;

const cleanValue = (value) => {
    if (typeof value !== 'string') {
        return '';
    }

    const trimmed = value.trim();
    return trimmed === 'N/A' || trimmed === 'Unknown' ? '' : trimmed;
};

const nullableValue = (value) => cleanValue(value) || null;

export const normalizeSurfaceWord = (word) => cleanValue(word).replace(KOREAN_RE, '');
const normalizeEnglishSurfaceWord = (word) => cleanValue(word).replace(ENGLISH_EDGE_RE, '').toLowerCase();
const normalizeChineseSurfaceWord = (word) => cleanValue(word).replace(CHINESE_EDGE_RE, '');
export const normalizeSurfaceWordForLanguage = (word, language) => {
    const targetLanguage = normalizeBookLanguage(language);
    if (targetLanguage === 'en') {
        return normalizeEnglishSurfaceWord(word);
    }
    if (targetLanguage === 'zh') {
        return normalizeChineseSurfaceWord(word);
    }
    return normalizeSurfaceWord(word);
};

const uniqueValues = (values) => [...new Set(
    (values || [])
        .map(cleanValue)
        .filter(Boolean)
)];

const uniqueCacheRowsByStem = (rows = []) => {
    const seen = new Set();
    return (rows || []).filter((row) => {
        const stem = cleanValue(row?.stem);
        if (!stem || seen.has(stem)) {
            return false;
        }

        seen.add(stem);
        return true;
    });
};

const splitCacheRows = (rows = [], usableCachedEntry = () => true) => {
    const uniqueRows = uniqueCacheRowsByStem(rows);
    const usableRows = [];
    const staleStems = [];

    uniqueRows.forEach((row) => {
        if (usableCachedEntry(row)) {
            usableRows.push(row);
        } else {
            const stem = cleanValue(row?.stem);
            if (stem) {
                staleStems.push(stem);
            }
        }
    });

    return { uniqueRows, usableRows, staleStems };
};

const cacheEntryToLookupResult = async ({
    entry,
    surface,
    sourceSentence,
    ownerId,
    includeEnrichment = true,
    wordOptions = [],
    interfaceLanguage = getRuntimeInterfaceLanguage(),
    targetLanguage = getRuntimeTargetLanguage(),
}) => {
    const primary = cacheEntryToDefinitionEntry(entry, surface);
    const liveEntries = includeEnrichment
        ? await fetchLiveEntriesForStem(primary.word, interfaceLanguage, targetLanguage)
        : [];
    const alternatives = includeEnrichment
        ? normalizeLiveAlternatives(liveEntries.slice(1), primary, targetLanguage).slice(0, MAX_ALTERNATIVES)
        : [];

    return buildLookupResult({
        surface,
        sourceSentence,
        primary,
        alternatives,
        ownerId,
        includeRomanization: includeEnrichment,
        wordOptions,
        interfaceLanguage,
        targetLanguage,
    });
};

const liveEntryToCacheEntry = (
    stem,
    entry,
    interfaceLanguage = getRuntimeInterfaceLanguage(),
    targetLanguage = getRuntimeTargetLanguage()
) => ({
    stem,
    language: normalizeBookLanguage(targetLanguage),
    definition: normalizeBookLanguage(targetLanguage) === 'ko'
        ? nullableValue(entry?.transWord)
        : nullableValue(entry?.definition),
    gloss: normalizeBookLanguage(targetLanguage) === 'ko' ? null : nullableValue(entry?.gloss),
    hanja: normalizeBookLanguage(targetLanguage) === 'ko' ? nullableValue(entry?.origin) : null,
    pos: nullableValue(entry?.pos),
    domain: null,
    romanization: normalizeBookLanguage(targetLanguage) === 'ko' ? nullableValue(entry?.romanization) : null,
    ipa: normalizeBookLanguage(targetLanguage) === 'zh'
        ? nullableValue(entry?.pinyin) || nullableValue(entry?.ipa)
        : nullableValue(entry?.ipa),
    audio_us: normalizeBookLanguage(targetLanguage) === 'en' ? nullableValue(entry?.audio_us) : null,
    audio_uk: normalizeBookLanguage(targetLanguage) === 'en' ? nullableValue(entry?.audio_uk) : null,
    etymology: normalizeBookLanguage(targetLanguage) === 'en' ? nullableValue(entry?.etymology) : null,
    derived: normalizeBookLanguage(targetLanguage) === 'en' ? entry?.derived : null,
    related: normalizeBookLanguage(targetLanguage) === 'en' ? entry?.related : null,
    word_parts: normalizeBookLanguage(targetLanguage) === 'en' ? (entry?.word_parts ?? entry?.wordParts ?? null) : null,
    interfaceLanguage,
});

const cacheEntryToDefinitionEntry = (entry, fallbackWord) => ({
    word: cleanValue(entry?.stem) || cleanValue(entry?.word) || fallbackWord,
    definition: nullableValue(entry?.definition),
    hanja: nullableValue(entry?.hanja),
    pos: nullableValue(entry?.pos),
    romanization: nullableValue(entry?.romanization) || nullableValue(entry?.pinyin) || nullableValue(entry?.ipa),
    audio_us: nullableValue(entry?.audio_us),
    audio_uk: nullableValue(entry?.audio_uk),
    wordParts: entry?.word_parts ?? entry?.wordParts ?? null,
    saved: false,
});

const liveEntryToDefinitionEntry = (entry, fallbackWord, targetLanguage = getRuntimeTargetLanguage()) => ({
    word: cleanValue(entry?.word) || cleanValue(entry?.stem) || fallbackWord,
    definition: nullableValue(entry?.transWord) || nullableValue(entry?.definition),
    hanja: normalizeBookLanguage(targetLanguage) === 'ko'
        ? nullableValue(entry?.origin) || nullableValue(entry?.hanja)
        : null,
    pos: nullableValue(entry?.pos),
    romanization: nullableValue(entry?.romanization) || nullableValue(entry?.pinyin) || nullableValue(entry?.ipa),
    audio_us: nullableValue(entry?.audio_us),
    audio_uk: nullableValue(entry?.audio_uk),
    wordParts: entry?.word_parts ?? entry?.wordParts ?? null,
    saved: false,
});

const definitionEntryKey = (entry) => [
    cleanValue(entry?.word),
    nullableValue(entry?.hanja) || '',
    nullableValue(entry?.definition) || '',
].join('|');

const normalizeLiveAlternatives = (entries, primary, targetLanguage = getRuntimeTargetLanguage()) => {
    const seen = new Set([definitionEntryKey(primary)]);

    return (entries || [])
        .map(entry => liveEntryToDefinitionEntry(entry, primary.word, targetLanguage))
        .filter((entry) => {
            if (!entry.word && !entry.definition) {
                return false;
            }

            const key = definitionEntryKey(entry);
            if (seen.has(key)) {
                return false;
            }

            seen.add(key);
            return true;
        });
};

const fetchLiveDictionary = async (
    stems,
    interfaceLanguage = getRuntimeInterfaceLanguage(),
    targetLanguage = getRuntimeTargetLanguage(),
    script = getRuntimeChineseScript()
) => {
    if (!stems.length) {
        return [];
    }

    const normalizedTargetLanguage = normalizeBookLanguage(targetLanguage);
    const normalizedInterfaceLanguage = normalizeInterfaceLanguageCode(interfaceLanguage);
    if (normalizedTargetLanguage === 'en') {
        return Promise.all(stems.map(async (stem) => {
            const response = await api.get('/en_dict_search/', {
                params: { stem, interface_language: normalizedInterfaceLanguage },
                timeout: 10000,
            });
            const result = response.data?.result;
            return result ? [result] : [];
        }));
    }

    if (normalizedTargetLanguage === 'zh') {
        return Promise.all(stems.map(async (stem) => {
            const response = await api.get('/zh_dict_search/', {
                params: { stem, interface_language: normalizedInterfaceLanguage, script },
                timeout: 10000,
            });
            const resultList = response.data?.results;
            if (Array.isArray(resultList)) {
                return resultList;
            }
            const result = response.data?.result;
            return result ? [result] : [];
        }));
    }

    const response = await api.post('/krdict_search/', {
        queries: stems,
        language: normalizedInterfaceLanguage,
    }, {
        timeout: 10000,
    });

    return response.data?.results ?? [];
};

const fetchLiveEntriesForStem = async (
    stem,
    interfaceLanguage = getRuntimeInterfaceLanguage(),
    targetLanguage = getRuntimeTargetLanguage()
) => {
    const cleanedStem = cleanValue(stem);
    if (!cleanedStem) {
        return [];
    }

    try {
        const results = await fetchLiveDictionary([cleanedStem], interfaceLanguage, targetLanguage);
        return results[0] ?? [];
    } catch (error) {
        return [];
    }
};

const fetchAndCacheLiveDictionary = async ({
    stems,
    cacheScope,
    interfaceLanguage = getRuntimeInterfaceLanguage(),
    targetLanguage = getRuntimeTargetLanguage(),
    script = getRuntimeChineseScript(),
}) => {
    const uniqueStems = uniqueValues(stems);
    if (uniqueStems.length === 0) {
        return new Map();
    }

    const liveResults = await fetchLiveDictionary(uniqueStems, interfaceLanguage, targetLanguage, script);
    const cacheEntries = uniqueStems
        .map((stem, index) => {
            const first = liveResults[index]?.[0];
            return first ? liveEntryToCacheEntry(stem, first, interfaceLanguage, targetLanguage) : null;
        })
        .filter(Boolean);

    if (cacheEntries.length > 0) {
        await insertCacheEntries(cacheEntries, cacheScope);
    }

    return new Map(uniqueStems.map((stem, index) => [stem, liveResults[index] ?? []]));
};

export const resolveDictionaryLookup = async ({
    surface,
    currentBook = null,
    ownerId = getActiveOwnerId(),
    interfaceLanguage = getRuntimeInterfaceLanguage(),
    targetLanguage = getRuntimeTargetLanguage(),
    usableCachedEntry = () => true,
    fetchLive = true,
    allowRemoteStemming = true,
    fallbackToSurfaceForKorean = false,
    script = getRuntimeChineseScript(),
}) => {
    const rawSurface = cleanValue(surface);
    const normalizedTargetLanguage = normalizeBookLanguage(targetLanguage);
    const normalizedInterfaceLanguage = normalizeInterfaceLanguageCode(interfaceLanguage);
    const normalizedSurface = normalizeSurfaceWordForLanguage(rawSurface, normalizedTargetLanguage) || rawSurface;
    const cacheScope = {
        language: normalizedTargetLanguage,
        interfaceLanguage: normalizedInterfaceLanguage,
    };

    const baseResult = {
        rawSurface,
        normalizedSurface,
        stems: [],
        cachedResults: [],
        dictionaryData: [],
        needsLiveFetch: false,
        liveError: null,
        cacheScope,
    };

    if (!normalizedSurface) {
        return baseResult;
    }

    // Log the lookup once per user query. Both lookup flows funnel through here
    // (overlay via lookupWordForOverlay, and the reader panel directly), and every
    // caller is user-initiated, so this is the single choke point. Fire-and-forget
    // so dictionary resolution never waits on or fails because of logging.
    logInteractionEvent({
        ownerId,
        language: normalizedTargetLanguage,
        word: normalizedSurface,
        stem: normalizedSurface,
        eventType: 'lookup',
        sourceBookUri: currentBook ?? null,
    }).catch((error) => {
        console.warn('[dictionaryLookup] Failed to log lookup interaction event:', error);
    });

    // Phase 3.1: a lookup is a weak "probably didn't know it" signal — nudge theta
    // down gently (outcome 0, reduced learning rate). Fire-and-forget; profile
    // scope resolves to the runtime-active profile inside the helper. The helper
    // self-skips words with no graded KB rank, so this only moves on real signal.
    updateThetaFromOutcome({
        ownerId,
        language: normalizedTargetLanguage,
        stem: normalizedSurface,
        outcome: 0,
        learningRate: LOOKUP_LEARNING_RATE,
    }).catch((error) => {
        console.warn('[dictionaryLookup] Failed to update theta from lookup:', error);
    });

    const buildResolved = async (stems, cachedResults = [], liveStems = stems) => {
        const uniqueStems = uniqueValues(stems);
        const uniqueLiveStems = uniqueValues(liveStems);

        if (!fetchLive || uniqueLiveStems.length === 0) {
            return {
                ...baseResult,
                stems: uniqueStems,
                cachedResults,
                dictionaryData: uniqueStems.map(() => []),
                needsLiveFetch: uniqueLiveStems.length > 0,
            };
        }

        try {
            const liveByStem = await fetchAndCacheLiveDictionary({
                stems: uniqueLiveStems,
                cacheScope,
                interfaceLanguage: normalizedInterfaceLanguage,
                targetLanguage: normalizedTargetLanguage,
                script,
            });

            return {
                ...baseResult,
                stems: uniqueStems,
                cachedResults,
                dictionaryData: uniqueStems.map((stem) => liveByStem.get(stem) ?? []),
                needsLiveFetch: false,
            };
        } catch (error) {
            return {
                ...baseResult,
                stems: uniqueStems,
                cachedResults,
                dictionaryData: uniqueStems.map(() => []),
                needsLiveFetch: false,
                liveError: error?.message || tRuntime('lookup.dictionaryFailed'),
            };
        }
    };

    const buildCacheResolved = async (rows) => {
        const { uniqueRows, usableRows, staleStems } = splitCacheRows(rows, usableCachedEntry);
        if (uniqueRows.length === 0) {
            return null;
        }

        if (staleStems.length === 0) {
            return {
                ...baseResult,
                cachedResults: usableRows,
            };
        }

        return buildResolved(staleStems, usableRows, staleStems);
    };

    if (currentBook) {
        const indexRows = await lookupBookIndexBySurface(
            ownerId,
            currentBook,
            normalizedSurface,
            cacheScope
        );
        const indexedResult = await buildCacheResolved(indexRows);
        if (indexedResult) {
            return indexedResult;
        }
    }

    const directCacheRows = await lookupCacheByStems([normalizedSurface], cacheScope);
    const directResult = await buildCacheResolved(directCacheRows);
    if (directResult) {
        return directResult;
    }

    const stemCandidates = allowRemoteStemming
        ? uniqueValues(await stemWord({
            query: rawSurface || normalizedSurface,
            language: normalizedTargetLanguage,
        })).filter((stem) => normalizedTargetLanguage !== 'ko' || !STOP_STEMS.has(stem))
        : [];
    const shouldFallbackToSurface = normalizedTargetLanguage !== 'ko' || fallbackToSurfaceForKorean;
    const stems = stemCandidates.length > 0
        ? stemCandidates
        : (shouldFallbackToSurface ? [normalizedSurface] : []);

    if (stems.length === 0) {
        return baseResult;
    }

    const stemCacheRows = await lookupCacheByStems(stems, cacheScope);
    const { usableRows, staleStems } = splitCacheRows(stemCacheRows, usableCachedEntry);
    const usableStemSet = new Set(usableRows.map((row) => cleanValue(row?.stem)).filter(Boolean));
    const staleStemSet = new Set(staleStems);
    const liveStems = stems.filter((stem) => staleStemSet.has(stem) || !usableStemSet.has(stem));

    return buildResolved(stems, usableRows, liveStems);
};

const fetchRomanization = async (term, options = {}) => {
    const cleanedTerm = cleanValue(term);
    if (!cleanedTerm) {
        return null;
    }

    const cacheScope = {
        language: normalizeBookLanguage(options.targetLanguage ?? getRuntimeTargetLanguage()),
        interfaceLanguage: normalizeInterfaceLanguageCode(options.interfaceLanguage ?? getRuntimeInterfaceLanguage()),
    };

    try {
        const cachedRows = await lookupCacheByStems([cleanedTerm], cacheScope);
        const cachedRomanization = nullableValue(cachedRows[0]?.romanization);
        if (cachedRomanization) {
            return cachedRomanization;
        }
    } catch (error) {
        // Local cache misses should not block the lookup panel pronunciation.
    }

    try {
        const response = await api.get('/romanize/', {
            params: { text: cleanedTerm },
            timeout: 6000,
        });
        const romanization = nullableValue(response.data?.romanization);
        if (romanization && cacheScope.language === 'ko') {
            updateCacheRomanizations([{ stem: cleanedTerm, romanization }], cacheScope).catch(() => {});
        }
        return romanization;
    } catch (error) {
        return null;
    }
};

const hydrateDefinitionEntry = async (entry, ownerId, options = {}) => {
    const word = cleanValue(entry?.word);
    const definition = nullableValue(entry?.definition);
    const hanja = nullableValue(entry?.hanja);
    const includeRomanization = options.includeRomanization !== false;
    const targetLanguage = normalizeBookLanguage(options.targetLanguage ?? getRuntimeTargetLanguage());
    const interfaceLanguage = normalizeInterfaceLanguageCode(options.interfaceLanguage ?? getRuntimeInterfaceLanguage());
    const pronunciation = nullableValue(entry?.romanization)
        || nullableValue(entry?.pinyin)
        || nullableValue(entry?.ipa);

    return {
        word,
        definition,
        hanja,
        pos: nullableValue(entry?.pos),
        romanization: pronunciation
            || (includeRomanization && targetLanguage === 'ko'
                ? await fetchRomanization(word, { interfaceLanguage, targetLanguage })
                : null),
        audio_us: nullableValue(entry?.audio_us),
        audio_uk: nullableValue(entry?.audio_uk),
        wordParts: entry?.wordParts ?? entry?.word_parts ?? null,
        saved: definition ? await vocabEntryExists(word, hanja, definition, targetLanguage, { ownerId }) : false,
    };
};

const buildLookupResult = async ({
    surface,
    sourceSentence,
    primary,
    alternatives = [],
    ownerId,
    includeRomanization = true,
    wordOptions = [],
    interfaceLanguage = getRuntimeInterfaceLanguage(),
    targetLanguage = getRuntimeTargetLanguage(),
}) => {
    const normalizedTargetLanguage = normalizeBookLanguage(targetLanguage);
    const hydratedPrimary = await hydrateDefinitionEntry(primary, ownerId, {
        includeRomanization,
        interfaceLanguage,
        targetLanguage: normalizedTargetLanguage,
    });
    const hydratedAlternatives = await Promise.all(
        alternatives
            .slice(0, MAX_ALTERNATIVES)
            .map((entry) => hydrateDefinitionEntry(entry, ownerId, {
                includeRomanization,
                interfaceLanguage,
                targetLanguage: normalizedTargetLanguage,
            }))
    );

    return {
        surface,
        stem: hydratedPrimary.word || surface,
        definition: hydratedPrimary.definition,
        hanja: hydratedPrimary.hanja,
        pos: hydratedPrimary.pos,
        romanization: hydratedPrimary.romanization,
        wordParts: hydratedPrimary.wordParts,
        saved: hydratedPrimary.saved,
        sourceSentence: cleanValue(sourceSentence),
        alternatives: hydratedAlternatives,
        wordOptions: uniqueValues(wordOptions).length > 0
            ? uniqueValues(wordOptions)
            : uniqueValues([hydratedPrimary.word]),
    };
};

export const lookupWordForOverlay = async ({
    surface,
    sourceSentence = '',
    includeEnrichment = true,
    fetchLive = true,
    allowRemoteStemming = true,
}) => {
    const rawSurface = cleanValue(surface);
    const targetLanguage = normalizeBookLanguage(getRuntimeTargetLanguage());
    const ownerId = getActiveOwnerId();
    const interfaceLanguage = getRuntimeInterfaceLanguage();
    const resolved = await resolveDictionaryLookup({
        surface: rawSurface,
        ownerId,
        interfaceLanguage,
        targetLanguage,
        fetchLive,
        allowRemoteStemming,
        fallbackToSurfaceForKorean: true,
    });
    const normalizedSurface = resolved.normalizedSurface || rawSurface;
    const stems = resolved.stems.length > 0 ? resolved.stems : [normalizedSurface].filter(Boolean);
    const cachedRows = resolved.cachedResults;

    if (!normalizedSurface) {
        throw new Error('No text selected.');
    }

    if (cachedRows.length > 0) {
        const wordOptions = stems.length > 0
            ? stems
            : [cachedRows[0].stem].filter(Boolean);
        return cacheEntryToLookupResult({
            entry: cachedRows[0],
            surface: rawSurface || normalizedSurface,
            sourceSentence,
            ownerId,
            includeEnrichment,
            wordOptions,
            interfaceLanguage,
            targetLanguage,
        });
    }

    const firstResultIndex = resolved.dictionaryData.findIndex(entries => entries?.[0]);
    if (firstResultIndex >= 0) {
        const primaryStem = stems[firstResultIndex] || normalizedSurface;
        const liveEntries = resolved.dictionaryData[firstResultIndex] ?? [];
        const primary = liveEntryToDefinitionEntry(liveEntries[0], primaryStem, targetLanguage);
        const alternatives = includeEnrichment
            ? normalizeLiveAlternatives(liveEntries.slice(1), primary, targetLanguage).slice(0, MAX_ALTERNATIVES)
            : [];

        return buildLookupResult({
            surface: rawSurface || normalizedSurface,
            sourceSentence,
            primary,
            alternatives,
            ownerId,
            includeRomanization: includeEnrichment,
            wordOptions: stems,
            interfaceLanguage,
            targetLanguage,
        });
    }

    if (resolved.liveError) {
        throw new Error(resolved.liveError);
    }

    return {
        surface: rawSurface || normalizedSurface,
        stem: stems[0] || normalizedSurface,
        definition: null,
        hanja: null,
        pos: null,
        romanization: null,
        saved: false,
        sourceSentence: cleanValue(sourceSentence),
        alternatives: [],
        wordOptions: stems,
    };
};

export const saveOverlayLookupResult = async ({
    stem,
    definition,
    hanja = null,
    sourceSentence = '',
}) => {
    const ownerId = getActiveOwnerId();
    const targetLanguage = normalizeBookLanguage(getRuntimeTargetLanguage());
    const word = cleanValue(stem);
    const cleanedDefinition = cleanValue(definition);
    const cleanedHanja = nullableValue(hanja);
    const createdAt = new Date().toISOString();
    const normalizedSourceSentence = cleanValue(sourceSentence) || null;

    if (!word || !cleanedDefinition) {
        throw new Error(tRuntime('lookup.noDefinitionToSave'));
    }

    const alreadySaved = await vocabEntryExists(word, cleanedHanja, cleanedDefinition, targetLanguage, { ownerId });
    if (!alreadySaved) {
        // Phase 4.4: seed the new card's FSRS interval from its cached P(known).
        const pKnown = await getCachedPKnown({ ownerId, language: targetLanguage, word });
        await insertData(word, cleanedHanja, cleanedDefinition, {
            ownerId,
            level: 'unorganized',
            sourceBookUri: null,
            sourceBookTitle: tRuntime('ocr.floatingTitle'),
            contextSentence: normalizedSourceSentence,
            createdAt,
            updatedAt: createdAt,
            language: targetLanguage,
            pKnown,
        });
    }
    const recordedContext = await recordVocabContext({
        ownerId,
        word,
        hanja: cleanedHanja,
        definition: cleanedDefinition,
        sentence: sourceSentence,
        sourceBookTitle: tRuntime('ocr.floatingTitle'),
        language: targetLanguage,
    });

    if (!alreadySaved || recordedContext) {
        requestUserDataSync('overlay-vocab-save');
    }

    logInteractionEvent({
        ownerId,
        language: targetLanguage,
        word,
        hanja: cleanedHanja,
        def: cleanedDefinition,
        eventType: 'save',
        sentence: normalizedSourceSentence,
    }).catch((error) => {
        console.warn('[dictionaryLookup] Failed to log save interaction event:', error);
    });

    return { saved: true };
};

export const unsaveOverlayLookupResult = async ({
    stem,
    definition,
    hanja = null,
}) => {
    const ownerId = getActiveOwnerId();
    const targetLanguage = normalizeBookLanguage(getRuntimeTargetLanguage());
    const word = cleanValue(stem);
    const cleanedDefinition = cleanValue(definition);
    const cleanedHanja = nullableValue(hanja);

    if (!word || !cleanedDefinition) {
        throw new Error(tRuntime('lookup.noDefinitionToUnsave'));
    }

    await removeData(word, cleanedHanja, cleanedDefinition, targetLanguage, { ownerId });
    requestUserDataSync('overlay-vocab-unsave');

    logInteractionEvent({
        ownerId,
        language: targetLanguage,
        word,
        hanja: cleanedHanja,
        def: cleanedDefinition,
        eventType: 'unsave',
    }).catch((error) => {
        console.warn('[dictionaryLookup] Failed to log unsave interaction event:', error);
    });

    return { saved: false };
};
