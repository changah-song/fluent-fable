import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Text, View, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { api } from '../../../services/api/client';
import { explainInContext } from '../../../services/api/explainInContext';
import { useAppContext } from '../../../contexts/AppContext';
import { useTranslation } from '../../../hooks/useTranslation';
import { useLocalOwner } from '../../../contexts/LocalOwnerContext';
import {
    getCachedPKnown,
    insertData,
    logInteractionEvent,
    lookupCacheByStems,
    removeData,
    recordVocabContext,
    updateCacheRomanizations,
    vocabEntryExists,
} from '../../../services/Database';
import HanjaDetails from './HanjaDetails';
import TranslationContent from './TranslationContent';
import LookupLoadingSkeleton from './LookupLoadingSkeleton';
import { normalizeBookLanguage, normalizeInterfaceLanguageCode } from '../../../constants/languages';
import { fontFamilies, radii, spacing, textStyles, useTheme } from '../../../theme';
import { playEnglishPronunciation } from '../../../services/pronunciationAudio';
import { requestUserDataSync } from '../../../services/userDataSyncQueue';
import {
    normalizeSurfaceWordForLanguage,
    resolveDictionaryLookup,
} from '../../../services/dictionaryLookup';

const ENGLISH_EDGE_RE = /^[^A-Za-z]+|[^A-Za-z]+$/g;
const HANJA_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;
const LATIN_RE = /[A-Za-z]/;
const HANGUL_RE = /[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F]/;
const CJK_RE = /[\u4E00-\u9FFF]/;
// Maps raw POS strings (English or Korean, as the dictionaries emit them) to
// pos.* translation keys. Empty string = deliberately show no badge.
const POS_KEYS = {
    Noun: 'pos.noun',
    Verb: 'pos.verb',
    Adverb: 'pos.adverb',
    Adjective: 'pos.adjective',
    Modifier: 'pos.modifier',
    Determiner: 'pos.determiner',
    명사: 'pos.noun',
    동사: 'pos.verb',
    형용사: 'pos.adjective',
    부사: 'pos.adverb',
    관형사: 'pos.determiner',
    감탄사: 'pos.interjection',
    대명사: 'pos.pronoun',
    수사: 'pos.numeral',
    조사: 'pos.particle',
    접사: 'pos.affix',
    어미: 'pos.ending',
    '보조 동사': 'pos.auxiliaryVerb',
    보조동사: 'pos.auxiliaryVerb',
    '보조 형용사': 'pos.auxiliaryAdjective',
    보조형용사: 'pos.auxiliaryAdjective',
    의존명사: 'pos.dependentNoun',
    '의존 명사': 'pos.dependentNoun',
    품사없음: '',
    '품사 없음': '',
};

const cleanValue = (value) => {
    if (typeof value !== 'string') {
        return '';
    }
    const trimmed = value.trim();
    return trimmed === 'N/A' || trimmed === 'Unknown' ? '' : trimmed;
};

const normalizeEnglishSurfaceWord = (word) => cleanValue(word).replace(ENGLISH_EDGE_RE, '').toLowerCase();

const hasSavableDefinition = (definition) => {
    const normalized = cleanValue(definition);
    return normalized.length > 0;
};

const hasHanja = (value) => HANJA_RE.test(cleanValue(value));
const getHanjaCharacters = (value) => cleanValue(value).split('').filter((char) => HANJA_RE.test(char));

const getEntryWord = (entry, fallback) => cleanValue(entry?.stem) || cleanValue(entry?.word) || fallback;
const getEntryHanja = (entry) => cleanValue(entry?.hanja) || cleanValue(entry?.origin);
const getEntryDefinition = (entry) => cleanValue(entry?.definition) || cleanValue(entry?.transWord);
const getEntryGloss = (entry) => cleanValue(entry?.gloss);
const getEntryPos = (entry) => cleanValue(entry?.pos);
const getEntryRomanization = (entry) => cleanValue(entry?.romanization);
const getEntryIpa = (entry) => cleanValue(entry?.ipa);
const getEntryPinyin = (entry) => cleanValue(entry?.pinyin) || getEntryIpa(entry);
const getEntryEtymology = (entry) => cleanValue(entry?.etymology);
const getEntryAudioUs = (entry) => cleanValue(entry?.audio_us ?? entry?.audioUs);
const getEntryAudioUk = (entry) => cleanValue(entry?.audio_uk ?? entry?.audioUk);
const parseWordParts = (value) => {
    if (!value) {
        return null;
    }

    if (typeof value === 'string') {
        try {
            return parseWordParts(JSON.parse(value));
        } catch {
            return null;
        }
    }

    if (Array.isArray(value)) {
        return value.length > 0 ? { parts: value } : null;
    }

    if (typeof value === 'object' && Array.isArray(value.parts) && value.parts.length > 0) {
        return value;
    }

    return null;
};
const getEntryWordParts = (entry) => parseWordParts(entry?.word_parts ?? entry?.wordParts);
const mergeWordParts = (...values) => {
    const parsedValues = values.map(parseWordParts).filter(Boolean);
    if (parsedValues.length === 0) {
        return null;
    }

    return parsedValues.slice(1).reduce((merged, current) => {
        if (!merged.related_roots && current.related_roots) {
            return { ...merged, related_roots: current.related_roots };
        }
        if (!merged.relatedRoots && current.relatedRoots) {
            return { ...merged, relatedRoots: current.relatedRoots };
        }
        return merged;
    }, parsedValues[0]);
};
const getMergedEntryWordParts = (...entries) => mergeWordParts(
    ...entries.map((entry) => entry?.word_parts ?? entry?.wordParts)
);
const WORD_PART_TYPES_REQUIRING_MEANING = new Set(['prefix', 'suffix', 'bound_root', 'combining_form']);
const HIDDEN_WORD_PART_CONFIDENCE = new Set(['low']);
const VISIBLE_WORD_PART_CONFIDENCE = 'high';
const VISIBLE_WORD_PART_SOURCE = 'curated_morpheme';
const MAX_RENDERED_WORD_PARTS = 4;
const MAX_WORD_PART_TEXT_LENGTH = 36;
const MAX_WORD_PART_MEANING_LENGTH = 48;
const MAX_RELATED_ROOT_GROUPS = 2;
const MAX_RELATED_WORDS_PER_ROOT = 6;
const MAX_ORIGIN_LENGTH = 130;
const OPAQUE_WORD_PART_WORDS = new Set(['because', 'understand']);
const ORIGIN_BLOCKLIST_RE = /Etymology tree|PIE word|Proto-|possibly|unknown|uncertain/i;
const ORIGIN_START_RE = /^(From|Borrowed from|Inherited from|Equivalent to|By surface analysis|Compound of)\b/i;
const getRenderableWordPartItems = (wordParts) => (
    Array.isArray(wordParts?.parts)
        ? wordParts.parts
            .map((part) => ({
                text: cleanValue(part?.display) || cleanValue(part?.text),
                lookupText: cleanValue(part?.text) || cleanValue(part?.display),
                type: cleanValue(part?.type),
                meaning: cleanValue(part?.meaning),
                note: cleanValue(part?.note),
            }))
            .filter(part => part.text)
        : []
);
const hasExplainedRootParts = (parts) => (
    parts.every((part) => (
        !WORD_PART_TYPES_REQUIRING_MEANING.has(part.type) || !!part.meaning
    ))
);
const hasCompactWordParts = (parts) => (
    parts.length >= 2
    && parts.length <= MAX_RENDERED_WORD_PARTS
    && parts.every((part) => (
        part.text.length <= MAX_WORD_PART_TEXT_LENGTH
        && (!part.meaning || part.meaning.length <= MAX_WORD_PART_MEANING_LENGTH)
        && (!part.note || part.note.length <= MAX_WORD_PART_MEANING_LENGTH)
    ))
);
const isDrilldownWordPart = (part) => (
    part?.type === 'base' && Boolean(normalizeEnglishSurfaceWord(part?.lookupText))
);
const hasRenderableWordParts = (wordParts, word = '') => {
    if (OPAQUE_WORD_PART_WORDS.has(normalizeEnglishSurfaceWord(word))) {
        return false;
    }

    if (HIDDEN_WORD_PART_CONFIDENCE.has(cleanValue(wordParts?.confidence).toLowerCase())) {
        return false;
    }

    if (
        cleanValue(wordParts?.confidence).toLowerCase() !== VISIBLE_WORD_PART_CONFIDENCE
        || cleanValue(wordParts?.source) !== VISIBLE_WORD_PART_SOURCE
    ) {
        return false;
    }

    const parts = getRenderableWordPartItems(wordParts);
    return hasCompactWordParts(parts) && hasExplainedRootParts(parts);
};
const getRenderableRelatedRootGroups = (wordParts, currentWord = '') => {
    if (!hasRenderableWordParts(wordParts, currentWord)) {
        return [];
    }

    const current = normalizeEnglishSurfaceWord(currentWord);
    const groups = Array.isArray(wordParts?.related_roots)
        ? wordParts.related_roots
        : (Array.isArray(wordParts?.relatedRoots) ? wordParts.relatedRoots : []);

    return groups
        .map((group) => {
            const root = cleanValue(group?.display) || cleanValue(group?.text);
            const words = (Array.isArray(group?.words) ? group.words : [])
                .map((entry) => ({
                    word: normalizeEnglishSurfaceWord(entry?.word),
                    definition: cleanValue(entry?.definition),
                }))
                .filter((entry) => entry.word && entry.word !== current)
                .slice(0, MAX_RELATED_WORDS_PER_ROOT);

            return {
                root,
                meaning: cleanValue(group?.meaning),
                words,
            };
        })
        .filter((group) => group.root && group.words.length > 0)
        .slice(0, MAX_RELATED_ROOT_GROUPS);
};
const isSafeOrigin = (etymology, word = '') => {
    if (OPAQUE_WORD_PART_WORDS.has(normalizeEnglishSurfaceWord(word))) {
        return false;
    }

    const rawOrigin = cleanValue(etymology);
    const origin = rawOrigin.replace(/\s+/g, ' ');
    return Boolean(
        origin
        && origin.length <= MAX_ORIGIN_LENGTH
        && !rawOrigin.includes('\n')
        && !ORIGIN_BLOCKLIST_RE.test(origin)
        && ORIGIN_START_RE.test(origin)
    );
};
const isLikelyUntranslatedEnglishDefinition = (definition, interfaceLanguage) => {
    const text = cleanValue(definition);

    if (!text || !LATIN_RE.test(text)) {
        return false;
    }

    if (interfaceLanguage === 'ko') {
        return !HANGUL_RE.test(text);
    }

    if (String(interfaceLanguage || '').startsWith('zh')) {
        return !CJK_RE.test(text);
    }

    return false;
};
const getRelatedKnownWordKey = (entry) => `${entry?.korean ?? ''}|${entry?.hanja ?? ''}`;

const formatPos = (pos, t) => {
    const normalized = cleanValue(pos).replace(/\s+/g, ' ');
    if (!normalized) {
        return '';
    }

    const toLabel = (key) => (key === '' ? '' : t(key));

    const compact = normalized.replace(/\s+/g, '');
    if (POS_KEYS[normalized] !== undefined) {
        return toLabel(POS_KEYS[normalized]);
    }
    if (POS_KEYS[compact] !== undefined) {
        return toLabel(POS_KEYS[compact]);
    }

    const koreanLabel = Object.keys(POS_KEYS)
        .filter((label) => /[\uAC00-\uD7A3]/.test(label))
        .sort((a, b) => b.length - a.length)
        .find((label) => normalized.includes(label));
    if (koreanLabel) {
        return toLabel(POS_KEYS[koreanLabel]);
    }

    return /[\uAC00-\uD7A3]/.test(normalized) ? '' : normalized.replace(/_/g, ' ').toUpperCase();
};

const getWordPartLabelKey = (type) => {
    switch (cleanValue(type)) {
        case 'prefix':
            return 'lookup.wordPart.prefix';
        case 'suffix':
            return 'lookup.wordPart.suffix';
        case 'base':
            return 'lookup.wordPart.base';
        case 'bound_root':
            return 'lookup.wordPart.boundRoot';
        case 'compound_component':
            return 'lookup.wordPart.component';
        case 'blend_component':
            return 'lookup.wordPart.blendComponent';
        case 'combining_form':
            return 'lookup.wordPart.combiningForm';
        default:
            return 'lookup.wordPart.part';
    }
};

const getWordPartsTitleKey = (parts) => {
    const types = new Set((parts || []).map(part => cleanValue(part?.type)).filter(Boolean));
    if (types.has('blend_component')) {
        return 'lookup.wordBlend';
    }
    if (types.has('compound_component')) {
        return 'lookup.wordComponents';
    }
    if (types.has('combining_form')) {
        return 'lookup.combiningForms';
    }
    return 'lookup.wordAnatomy';
};

const uniqueEntriesByWord = (entries, excludedWord = '') => {
    const seen = new Set(cleanValue(excludedWord) ? [cleanValue(excludedWord)] : []);

    return (entries || []).filter((entry) => {
        const word = cleanValue(entry?.word) || cleanValue(entry?.stem);
        if (!word || seen.has(word)) {
            return false;
        }

        seen.add(word);
        return true;
    });
};

const DictionaryContent = ({
    highlightedWord,
    sourceSentence = '',
    isDarkMode,
    onContentLoaded,
    onWordSave,
    onWordUnsave,
    onSavedWordsChanged,
    onTranslatePress,
    onExpandedStateChange,
    onExplainModeChange,
    onContentHeightChange,
    onCanExpandChange,
    isPanelExpanded = false,
    currentBook,
    sourceBook,
    savedWords = [],
}) => {
    const { interfaceLanguage } = useAppContext();
    const { t } = useTranslation();
    const { colors } = useTheme();
    const styles = useMemo(() => createStyles(colors), [colors]);
    const { activeOwnerId } = useLocalOwner();
    const palette = useMemo(() => ({
        text: colors.readerBodyInk,
        mutedText: colors.readerMutedInk,
        secondaryText: colors.textSecondary,
        emptyText: colors.readerSubtleInk,
        surface: colors.readerSurface,
        border: colors.readerBorder,
        action: colors.readerTappedWordBg,
        actionText: colors.readerTappedWordText,
        secondaryButtonBg: colors.surfaceMuted,
        secondaryButtonText: colors.textMuted,
        icon: colors.readerTappedWordText,
    }), [colors]);

    const targetLanguage = normalizeBookLanguage(sourceBook?.language ?? 'ko');
    const isEnglishBook = targetLanguage === 'en';
    const isChineseBook = targetLanguage === 'zh';
    const isKoreanBook = targetLanguage === 'ko';
    const cacheScope = useMemo(() => ({
        language: targetLanguage,
        interfaceLanguage,
    }), [interfaceLanguage, targetLanguage]);
    const isUsableCachedEntry = useCallback((entry) => {
        if ((!isEnglishBook && !isChineseBook) || interfaceLanguage === 'en') {
            return true;
        }

        const definition = getEntryDefinition(entry);
        return Boolean(definition)
            && !isLikelyUntranslatedEnglishDefinition(definition, interfaceLanguage);
    }, [interfaceLanguage, isChineseBook, isEnglishBook]);
    const contextSentence = cleanValue(sourceSentence);
    const [translationMode, setTranslationMode] = useState(false);
    // Smart-definition ("what it means here") mode. When active, the panel is
    // replaced by the AI explanation view (short gloss + save on top, longer
    // explanation below) and the sheet is expanded to make room. explainData
    // caches results keyed by tapped surface: { loading, text, gloss, lemma, error }.
    const [explainMode, setExplainMode] = useState(false);
    const [explainData, setExplainData] = useState({});

    // Reset smart-definition state whenever a new word/sentence context is opened so
    // we never show an explanation fetched for a different sentence.
    useEffect(() => {
        setExplainMode(false);
        setExplainData({});
    }, [highlightedWord, contextSentence]);

    const fetchExplanation = useCallback(async (key) => {
        setExplainData((prev) => ({ ...prev, [key]: { loading: true, text: '', error: null } }));

        try {
            const response = await explainInContext({
                word: key,
                sentence: contextSentence,
                language: targetLanguage,
                interfaceLanguage,
            });
            const text = cleanValue(response?.explanation);
            const gloss = cleanValue(response?.gloss);
            const lemma = cleanValue(response?.lemma);
            setExplainData((prev) => ({
                ...prev,
                [key]: text
                    ? { loading: false, text, gloss, lemma, error: null }
                    : { loading: false, text: '', gloss: '', lemma: '', error: t('lookup.explainFailed') },
            }));
        } catch (error) {
            setExplainData((prev) => ({
                ...prev,
                [key]: { loading: false, text: '', error: error?.message || t('lookup.explainFailed') },
            }));
        }
    }, [contextSentence, targetLanguage, interfaceLanguage, t]);

    // Toggle the smart-definition panel mode. Entering it kicks off the fetch (if
    // not already cached/in-flight) and leaves translation mode.
    const handleSmartDefinitionPress = useCallback((word) => {
        const key = cleanValue(word);
        if (!key || !contextSentence) {
            return;
        }

        if (explainMode) {
            setExplainMode(false);
            return;
        }

        setTranslationMode(false);
        setExplainMode(true);

        const existing = explainData[key];
        if (existing && (existing.loading || existing.text)) {
            return; // already fetched or in flight
        }
        fetchExplanation(key);
    }, [explainMode, explainData, contextSentence, fetchExplanation]);

    const [drilldownStack, setDrilldownStack] = useState([]);
    const lookupWord = drilldownStack.length > 0 ? drilldownStack[drilldownStack.length - 1] : highlightedWord;
    const rootLookupWord = cleanValue(normalizeSurfaceWordForLanguage(highlightedWord, targetLanguage)) || cleanValue(highlightedWord);
    const parentLookupWord = drilldownStack.length > 1
        ? drilldownStack[drilldownStack.length - 2]
        : rootLookupWord;
    const tappedSurface = cleanValue(normalizeSurfaceWordForLanguage(lookupWord, targetLanguage)) || cleanValue(lookupWord);
    const [expandedWords, setExpandedWords] = useState([]);
    const [stemWordList, setStemWordList] = useState([]);
    const [cachedResults, setCachedResults] = useState(null);
    const [needsLiveFetch, setNeedsLiveFetch] = useState(false);
    const [dictionaryData, setDictionaryData] = useState([]);
    const [isLiveLoading, setIsLiveLoading] = useState(false);
    const [liveError, setLiveError] = useState(null);
    const [extraDefs, setExtraDefs] = useState({});
    const [liveEntryMeta, setLiveEntryMeta] = useState({});
    const [romanizations, setRomanizations] = useState({});
    const romanizationsRef = useRef({});
    const [expandedCached, setExpandedCached] = useState({});
    const [relatedKnownByWord, setRelatedKnownByWord] = useState({});
    const [currentHanja, setCurrentHanja] = useState(null);
    const [activeWordIndex, setActiveWordIndex] = useState(0);
    const [dictionaryViewportHeight, setDictionaryViewportHeight] = useState(0);
    const [dictionaryContentHeight, setDictionaryContentHeight] = useState(0);
    const dictionaryScrollRef = useRef(null);
    // Temporary handoff QA toggles for dictionary translation panel states.
    const [translationLoadingPreview] = useState(false);
    const [translationErrorPreview] = useState(false);
    const [translationTextPreview] = useState('');
    useEffect(() => {
        romanizationsRef.current = romanizations;
    }, [romanizations]);

    const handleHanjaPress = (hanja, sourceWord = null, options = {}) => {
        if (!hanja) {
            setCurrentHanja(null);
            return;
        }

        const optionCharacters = Array.isArray(options.characters)
            ? options.characters.map(cleanValue).filter(hasHanja)
            : [];
        const characters = optionCharacters.length > 0 ? optionCharacters : getHanjaCharacters(hanja);
        const fallbackCharacters = characters.length > 0 ? characters : [cleanValue(hanja)];
        const requestedIndex = Number.isInteger(options.index)
            ? options.index
            : fallbackCharacters.indexOf(cleanValue(hanja));
        const activeIndex = requestedIndex >= 0
            ? Math.min(requestedIndex, fallbackCharacters.length - 1)
            : 0;

        setCurrentHanja({
            character: fallbackCharacters[activeIndex],
            characters: fallbackCharacters,
            activeIndex,
            sourceWord: cleanValue(sourceWord) || null,
            sourceWordDetails: options.sourceWordDetails ?? {},
        });
    };

    useEffect(() => {
        setTranslationMode(false);
        setDrilldownStack([]);
    }, [highlightedWord, targetLanguage]);

    useEffect(() => {
        setCachedResults(null);
        setNeedsLiveFetch(false);
        setStemWordList([]);
        setDictionaryData([]);
        setLiveError(null);
        setIsLiveLoading(false);
        setExtraDefs({});
        setLiveEntryMeta({});
        romanizationsRef.current = {};
        setRomanizations({});
        setExpandedCached({});
        setExpandedWords([]);
        setRelatedKnownByWord({});
        setActiveWordIndex(0);

        if (!lookupWord) return;

        let isCancelled = false;

        const resolveLookup = async () => {
            setIsLiveLoading(true);

            try {
                const result = await resolveDictionaryLookup({
                    surface: lookupWord,
                    currentBook,
                    ownerId: activeOwnerId,
                    interfaceLanguage,
                    targetLanguage,
                    usableCachedEntry: isUsableCachedEntry,
                });
                if (isCancelled) {
                    return;
                }

                setCachedResults(result.cachedResults);
                setStemWordList(result.stems);
                setNeedsLiveFetch(result.needsLiveFetch);
                setDictionaryData(result.dictionaryData);
                setLiveError(result.liveError);
            } catch (error) {
                if (isCancelled) {
                    return;
                }

                setCachedResults([]);
                setStemWordList([]);
                setNeedsLiveFetch(false);
                setDictionaryData([]);
                setLiveError(error?.message || t('lookup.dictionaryFailed'));
            } finally {
                if (!isCancelled) {
                    setIsLiveLoading(false);
                    onContentLoaded?.();
                }
            }
        };

        resolveLookup();

        return () => {
            isCancelled = true;
        };
    }, [activeOwnerId, currentBook, interfaceLanguage, isUsableCachedEntry, lookupWord, onContentLoaded, targetLanguage]);

    useEffect(() => {
        // Smart-definition mode expands the sheet to full height (any positive row
        // count makes the parent size it to DICTIONARY_EXPANDED_MAX_HEIGHT) so the
        // gloss, save button, and longer explanation all have room.
        if (explainMode) {
            onExplainModeChange?.(true);
            onExpandedStateChange?.(1);
            return;
        }

        onExplainModeChange?.(false);

        if (translationMode) {
            onExpandedStateChange?.(-1);
            return;
        }

        if (!isPanelExpanded) {
            onExpandedStateChange?.(0);
            return;
        }

        const expandedCachedCount = Object.entries(expandedCached).reduce((maxCount, [stem, isExpanded]) => {
            if (!isExpanded || !Array.isArray(extraDefs[stem])) {
                return maxCount;
            }

            return Math.max(maxCount, extraDefs[stem].length);
        }, 0);

        const expandedLiveCount = expandedWords.reduce((maxCount, word) => {
            const index = stemWordList.indexOf(word);
            const entries = index >= 0 ? (dictionaryData[index] || []) : [];
            const first = entries[0];
            if (!first) {
                return maxCount;
            }

            return Math.max(maxCount, uniqueEntriesByWord(entries.slice(1), first?.word || word).length);
        }, 0);

        onExpandedStateChange?.(Math.max(expandedCachedCount, expandedLiveCount));
    }, [dictionaryData, expandedCached, expandedWords, explainMode, extraDefs, isPanelExpanded, onExpandedStateChange, onExplainModeChange, stemWordList, translationMode]);

    const storeRomanizationPairs = useCallback((pairs) => {
        const normalizedPairs = (pairs || [])
            .map(([term, romanization]) => [cleanValue(term), cleanValue(romanization)])
            .filter(([term]) => Boolean(term));

        if (normalizedPairs.length === 0) {
            return;
        }

        setRomanizations(prev => {
            const next = { ...prev };
            normalizedPairs.forEach(([term, romanization]) => {
                next[term] = romanization;
            });
            romanizationsRef.current = next;
            return next;
        });
    }, []);

    const fetchRomanizations = useCallback(async (terms, seedEntries = []) => {
        if (!isKoreanBook) {
            return;
        }

        const seedPairs = (seedEntries || [])
            .map((entry) => [getEntryWord(entry, ''), getEntryRomanization(entry)])
            .filter(([term, romanization]) => cleanValue(term) && cleanValue(romanization));

        if (seedPairs.length > 0) {
            storeRomanizationPairs(seedPairs);
        }

        const missingTerms = [...new Set((terms || []).map(cleanValue).filter(Boolean))]
            .filter((term) => romanizationsRef.current[term] === undefined);

        if (missingTerms.length === 0) {
            return;
        }

        let cachedRows = [];
        try {
            cachedRows = await lookupCacheByStems(missingTerms, cacheScope);
        } catch (error) {
            console.warn('[DictionaryContent] Failed to read cached romanizations:', error?.message ?? error);
        }
        const cachedPairs = cachedRows
            .map((entry) => [getEntryWord(entry, ''), getEntryRomanization(entry)])
            .filter(([term, romanization]) => cleanValue(term) && cleanValue(romanization));

        if (cachedPairs.length > 0) {
            storeRomanizationPairs(cachedPairs);
        }

        const cachedTermSet = new Set(cachedPairs.map(([term]) => cleanValue(term)));
        const apiTerms = missingTerms.filter((term) => (
            !cachedTermSet.has(term) && romanizationsRef.current[term] === undefined
        ));

        if (apiTerms.length === 0) {
            return;
        }

        const pairs = await Promise.all(apiTerms.map(async (term) => {
            try {
                const response = await api.get('/romanize/', {
                    params: { text: term },
                    timeout: 6000,
                });
                return [term, cleanValue(response.data?.romanization)];
            } catch (error) {
                return [term, ''];
            }
        }));

        storeRomanizationPairs(pairs);
        updateCacheRomanizations(
            pairs
                .map(([stem, romanization]) => ({ stem, romanization: cleanValue(romanization) }))
                .filter(({ stem, romanization }) => cleanValue(stem) && romanization),
            cacheScope
        ).catch((error) => {
            console.warn('[DictionaryContent] Failed to cache romanizations:', error?.message ?? error);
        });
    }, [cacheScope, isKoreanBook, storeRomanizationPairs]);

    useEffect(() => {
        if (!cachedResults || cachedResults.length === 0) {
            return;
        }

        fetchRomanizations(cachedResults.map((entry) => getEntryWord(entry, lookupWord)), cachedResults);
    }, [cachedResults, fetchRomanizations, lookupWord]);

    useEffect(() => {
        if (stemWordList.length === 0) {
            return;
        }

        fetchRomanizations(stemWordList);
    }, [fetchRomanizations, stemWordList]);

    const prefetchExtra = async (stem) => {
        if (isEnglishBook) {
            setExtraDefs(prev => ({ ...prev, [stem]: 'prefetching' }));
            try {
                const response = await api.get('/en_dict_search/', {
                    params: { stem, interface_language: interfaceLanguage },
                    timeout: 10000,
                });
                const entry = response.data?.result;
                if (entry) {
                    setLiveEntryMeta(prev => ({ ...prev, [stem]: entry }));
                }
            } catch {
                // Root-related links are optional; keep the expanded panel usable if enrichment fails.
            } finally {
                setExtraDefs(prev => ({ ...prev, [stem]: [] }));
            }
            return;
        }

        if (isChineseBook) {
            setExtraDefs(prev => ({ ...prev, [stem]: 'prefetching' }));
            try {
                const response = await api.get('/zh_dict_search/', {
                    params: { stem, interface_language: interfaceLanguage },
                    timeout: 10000,
                });
                const entries = response.data?.results ?? [];
                if (entries[0]) {
                    setLiveEntryMeta(prev => ({ ...prev, [stem]: entries[0] }));
                }
                setExtraDefs(prev => ({ ...prev, [stem]: uniqueEntriesByWord(entries.slice(1), entries[0]?.word) }));
            } catch {
                setExtraDefs(prev => ({ ...prev, [stem]: [] }));
            }
            return;
        }

        setExtraDefs(prev => ({ ...prev, [stem]: 'prefetching' }));
        try {
            const response = await api.post('/krdict_search/', {
                queries: [stem],
                language: interfaceLanguage,
            }, {
                timeout: 10000,
            });
            const entries = response.data?.results?.[0] ?? [];
            if (entries[0]) {
                setLiveEntryMeta(prev => ({ ...prev, [stem]: entries[0] }));
            }
            setExtraDefs(prev => ({ ...prev, [stem]: uniqueEntriesByWord(entries.slice(1), entries[0]?.word) }));
        } catch {
            setExtraDefs(prev => ({ ...prev, [stem]: [] }));
        }
    };

    const lookupItems = useMemo(() => {
        const itemsByStem = new Map();

        stemWordList.forEach((stem, index) => {
            if (!cleanValue(stem)) {
                return;
            }

            itemsByStem.set(stem, {
                key: `live-${stem}-${index}`,
                stem,
                liveEntries: dictionaryData[index] || [],
            });
        });

        (cachedResults || []).forEach((entry, index) => {
            const stem = cleanValue(entry?.stem) || getEntryWord(entry, lookupWord) || `cached-${index}`;
            const existing = itemsByStem.get(stem) || {
                key: `cached-${stem}-${index}`,
                stem,
                liveEntries: [],
            };

            itemsByStem.set(stem, {
                ...existing,
                cachedEntry: entry,
            });
        });

        const isAwaitingLive = needsLiveFetch && !liveError;

        return [...itemsByStem.values()].filter((item) => (
            item.cachedEntry
            || item.liveEntries?.[0]
            || (isAwaitingLive && cleanValue(item.stem))
        ));
    }, [cachedResults, dictionaryData, liveError, lookupWord, needsLiveFetch, stemWordList]);

    const lookupItemCount = lookupItems.length;
    const currentLookupIndex = lookupItemCount > 0
        ? Math.min(activeWordIndex, lookupItemCount - 1)
        : 0;
    const activeLookupItem = lookupItems[currentLookupIndex] || null;
    const hasWordNavigation = drilldownStack.length === 0 && lookupItemCount > 1;
    const isDictionaryScrollable = dictionaryViewportHeight > 0
        && dictionaryContentHeight > dictionaryViewportHeight + 2;
    const activeLookupDetails = useMemo(() => {
        const cachedEntry = activeLookupItem?.cachedEntry || null;
        const firstLiveEntry = activeLookupItem?.liveEntries?.[0] || null;
        const entry = cachedEntry || firstLiveEntry;
        const stem = cleanValue(activeLookupItem?.stem) || getEntryWord(entry, lookupWord);
        const liveMeta = cachedEntry
            ? (liveEntryMeta[cachedEntry.stem] || firstLiveEntry || {})
            : {};
        const word = getEntryWord(entry, stem || lookupWord);
        const wordParts = getMergedEntryWordParts(cachedEntry, liveMeta, firstLiveEntry);

        return {
            hanja: getEntryHanja(entry),
            word,
            wordParts,
        };
    }, [activeLookupItem, liveEntryMeta, lookupWord]);
    const activeLookupHanja = activeLookupDetails.hanja;
    const canExpandCurrentLookup = (
        (isKoreanBook && hasHanja(activeLookupHanja))
        || (isEnglishBook && hasRenderableWordParts(activeLookupDetails.wordParts, activeLookupDetails.word))
    );

    useEffect(() => {
        onCanExpandChange?.(canExpandCurrentLookup);
        if (!canExpandCurrentLookup && isPanelExpanded) {
            onExpandedStateChange?.(0);
        }
    }, [canExpandCurrentLookup, isPanelExpanded, onCanExpandChange, onExpandedStateChange]);

    useEffect(() => {
        setActiveWordIndex((currentIndex) => {
            if (lookupItemCount <= 0) {
                return 0;
            }

            return Math.min(currentIndex, lookupItemCount - 1);
        });
    }, [lookupItemCount]);

    useEffect(() => {
        const entry = activeLookupItem?.cachedEntry;
        if (!isPanelExpanded || !entry?.definition || extraDefs[entry.stem] !== undefined) {
            return;
        }

        prefetchExtra(entry.stem);
        setExpandedCached(prev => ({ ...prev, [entry.stem]: true }));
    }, [activeLookupItem, extraDefs, isPanelExpanded]);

    const handleRelatedKnownWordMarked = (sourceWord, relatedWord) => {
        const normalizedSource = cleanValue(sourceWord);
        if (!normalizedSource) {
            return;
        }

        setRelatedKnownByWord((previous) => {
            const current = previous[normalizedSource] ?? [];
            const key = getRelatedKnownWordKey(relatedWord);
            if (current.some((entry) => getRelatedKnownWordKey(entry) === key)) {
                return previous;
            }

            return {
                ...previous,
                [normalizedSource]: [...current, relatedWord],
            };
        });
    };

    const handleRelatedKnownWordRemoved = (sourceWord, relatedWord) => {
        const normalizedSource = cleanValue(sourceWord);
        if (!normalizedSource) {
            return;
        }

        setRelatedKnownByWord((previous) => {
            const current = previous[normalizedSource] ?? [];
            const next = current.filter(
                (entry) => getRelatedKnownWordKey(entry) !== getRelatedKnownWordKey(relatedWord)
            );

            return {
                ...previous,
                [normalizedSource]: next,
            };
        });
    };

    const buildSourceWordDetails = ({ hanja, definition }) => ({
        hanja: cleanValue(hanja) || null,
        definition: cleanValue(definition) || null,
        level: 'unorganized',
        sourceBookUri: sourceBook?.uri ?? currentBook ?? null,
        sourceBookTitle: sourceBook?.title ?? null,
        contextSentence: contextSentence || null,
        language: targetLanguage,
    });

    const handleSourceWordAutoSaved = async (word, details = {}) => {
        const normalizedWord = cleanValue(word);
        if (!normalizedWord) {
            return;
        }

        onWordSave?.(normalizedWord, { includeSurface: false });
        requestUserDataSync('reader-source-word-auto-save');
    };

    const toggleSave = async (word, origin, definition, options = {}) => {
        const { source = null } = options;
        onWordSave?.(word, options);
        const createdAt = new Date().toISOString();
        const relatedKnownWords = relatedKnownByWord[word] ?? [];
        const alreadySaved = await vocabEntryExists(word, origin, definition, targetLanguage, {
            ownerId: activeOwnerId,
        });
        if (!alreadySaved) {
            // Phase 4.4: seed the new card's FSRS interval from its cached P(known).
            const pKnown = await getCachedPKnown({
                ownerId: activeOwnerId,
                language: targetLanguage,
                word,
            });
            await insertData(word, origin, definition, {
                ownerId: activeOwnerId,
                level: 'unorganized',
                sourceBookUri: sourceBook?.uri ?? currentBook ?? null,
                sourceBookTitle: sourceBook?.title ?? null,
                contextSentence: contextSentence || null,
                createdAt,
                updatedAt: createdAt,
                language: targetLanguage,
                relatedKnownWords,
                pKnown,
                source,
            });
        }
        const recordedContext = await recordVocabContext({
            ownerId: activeOwnerId,
            word,
            hanja: origin,
            definition,
            sentence: contextSentence,
            sourceBookUri: sourceBook?.uri ?? currentBook ?? null,
            sourceBookTitle: sourceBook?.title ?? null,
            language: targetLanguage,
        });

        if (!alreadySaved || recordedContext) {
            requestUserDataSync('reader-vocab-save');
        }

        // The DB write has committed — let the parent re-read its book-scoped
        // saved list so the top-bar badge count reflects this save immediately
        // rather than only on the next time the saved panel is opened.
        onSavedWordsChanged?.();

        logInteractionEvent({
            ownerId: activeOwnerId,
            language: targetLanguage,
            word,
            hanja: origin,
            def: definition,
            eventType: 'save',
            sourceBookUri: sourceBook?.uri ?? currentBook ?? null,
            sentence: contextSentence || null,
        }).catch((error) => {
            console.warn('[DictionaryContent] Failed to log save interaction event:', error);
        });
    };

    const toggleUnSave = async (word, origin, definition, options = {}) => {
        onWordUnsave?.(word, options);
        const ownerId = activeOwnerId;
        await removeData(word, origin, definition, targetLanguage, {
            ownerId,
        });
        requestUserDataSync('reader-vocab-unsave');

        // Commit landed — refresh the parent's badge count for this book.
        onSavedWordsChanged?.();

        logInteractionEvent({
            ownerId,
            language: targetLanguage,
            word,
            hanja: origin,
            def: definition,
            eventType: 'unsave',
            sourceBookUri: sourceBook?.uri ?? currentBook ?? null,
        }).catch((error) => {
            console.warn('[DictionaryContent] Failed to log unsave interaction event:', error);
        });
    };

    // Save a word using the AI's short contextual gloss as its definition. Used
    // for OOV / force-decomposed words the dictionary can't resolve (e.g. archaic
    // contractions like 설워하다). The caller passes the AI-stemmed base form (with a
    // surface fallback) as the headword, and we tag it `source: 'ai'` so the
    // saved-words list can badge it as AI-explained.
    const saveWithAiDefinition = async (headword, gloss) => {
        const wordToSave = cleanValue(headword);
        const def = cleanValue(gloss);
        if (!wordToSave || !def) {
            return;
        }
        if (isWordSaved(wordToSave)) {
            await toggleUnSave(wordToSave, '', def);
        } else {
            await toggleSave(wordToSave, '', def, { source: 'ai' });
        }
    };

    const isWordSaved = (word) => savedWords.includes(word);

    const handleWordPartPress = (part) => {
        if (!isDrilldownWordPart(part)) {
            return;
        }

        const nextWord = normalizeEnglishSurfaceWord(part.lookupText);
        if (!nextWord || nextWord === normalizeEnglishSurfaceWord(lookupWord)) {
            return;
        }

        setCurrentHanja(null);
        setDrilldownStack(prev => [...prev, nextWord]);
    };

    const handleRelatedRootWordPress = (word) => {
        const nextWord = normalizeEnglishSurfaceWord(word);
        if (!nextWord || nextWord === normalizeEnglishSurfaceWord(lookupWord)) {
            return;
        }

        setCurrentHanja(null);
        setDrilldownStack(prev => [...prev, nextWord]);
    };

    const goBackFromDrilldown = () => {
        setCurrentHanja(null);
        setDrilldownStack(prev => prev.slice(0, -1));
    };

    const goToPreviousWord = () => {
        if (lookupItemCount <= 1 || currentLookupIndex <= 0) {
            return;
        }

        setExpandedCached({});
        setExpandedWords([]);
        onExpandedStateChange?.(0);
        setActiveWordIndex((currentIndex) => (
            Math.max(0, currentIndex - 1)
        ));
        handleHanjaPress(null);
    };

    const goToNextWord = () => {
        if (lookupItemCount <= 1 || currentLookupIndex >= lookupItemCount - 1) {
            return;
        }

        setExpandedCached({});
        setExpandedWords([]);
        onExpandedStateChange?.(0);
        setActiveWordIndex((currentIndex) => (
            Math.min(lookupItemCount - 1, currentIndex + 1)
        ));
        handleHanjaPress(null);
    };

    const scrollDictionaryToTop = useCallback(() => {
        dictionaryScrollRef.current?.scrollTo?.({ y: 0, animated: true });
    }, []);

    const renderDrilldownBackRow = () => {
        if (drilldownStack.length === 0) {
            return null;
        }

        return (
            <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={t('lookup.backToWord', { word: parentLookupWord })}
                activeOpacity={0.78}
                onPress={goBackFromDrilldown}
                style={[styles.drilldownBackRow, { borderBottomColor: palette.border }]}
            >
                <MaterialIcons name="chevron-left" size={18} color={palette.mutedText} />
                <Text style={[styles.drilldownBackText, { color: palette.mutedText }]}>
                    {parentLookupWord}
                </Text>
            </TouchableOpacity>
        );
    };

    const renderDictionaryPanel = (children, { word, hanja, definition } = {}) => (
        <View style={[styles.panelContent, styles.dictionaryPanelContent, { backgroundColor: palette.surface }]}>
            <ScrollView
                ref={dictionaryScrollRef}
                style={styles.dictionaryScroll}
                contentContainerStyle={[
                    styles.dictionaryScrollContent,
                    hasWordNavigation && styles.dictionaryScrollContentWithNav,
                ]}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled={isDictionaryScrollable}
                scrollEnabled={isDictionaryScrollable}
                showsVerticalScrollIndicator={isDictionaryScrollable}
                bounces={isDictionaryScrollable}
                onLayout={(event) => {
                    setDictionaryViewportHeight(event.nativeEvent.layout.height);
                }}
                onContentSizeChange={(_, height) => {
                    setDictionaryContentHeight(height);
                    onContentHeightChange?.(height);
                }}
            >
                {renderDrilldownBackRow()}
                {children}
            </ScrollView>
            {word ? renderActionRow(word, hanja, definition, false) : null}
        </View>
    );

    const renderHanja = (hanja, variant = 'entry', sourceWord = null, sourceWordDetails = {}) => {
        if (!hasHanja(hanja)) {
            return null;
        }

        const isEntry = variant === 'entry';
        const hanjaStyle = [
            isEntry ? styles.entryHanja : styles.extraHanja,
            { color: isEntry ? colors.textMuted : palette.mutedText },
        ];
        const hanjaCharacters = getHanjaCharacters(hanja);
        let hanjaTokenIndex = -1;

        return (
            <View style={[styles.hanjaGroup, isEntry ? styles.entryHanjaGroup : styles.extraHanjaGroup]}>
                {!isEntry ? <Text style={hanjaStyle}>(</Text> : null}
                {cleanValue(hanja).split('').map((char, index) => {
                    if (!HANJA_RE.test(char)) {
                        return <Text key={`${char}-${index}`} style={hanjaStyle}>{char}</Text>;
                    }

                    hanjaTokenIndex += 1;
                    const selectedHanjaIndex = hanjaTokenIndex;

                    return (
                        <TouchableOpacity
                            key={`${char}-${index}`}
                            activeOpacity={0.7}
                            hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                            onPress={() => handleHanjaPress(char, sourceWord, {
                                characters: hanjaCharacters,
                                index: selectedHanjaIndex,
                                sourceWordDetails,
                            })}
                            style={styles.hanjaToken}
                        >
                            <Text style={hanjaStyle}>{char}</Text>
                        </TouchableOpacity>
                    );
                })}
                {!isEntry ? <Text style={hanjaStyle}>)</Text> : null}
            </View>
        );
    };


    const renderBookmarkButton = (word, hanja, definition) => {
        if (!hasSavableDefinition(definition)) {
            return null;
        }

        const saved = isWordSaved(word);

        return (
            <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={saved
                    ? t('lookup.removeWord', { word })
                    : t('lookup.saveWord', { word })}
                activeOpacity={0.8}
                onPress={() =>
                    saved
                        ? toggleUnSave(word, hanja, definition)
                        : toggleSave(word, hanja, definition)
                }
                style={[
                    styles.bookmarkButton,
                    {
                        backgroundColor: colors.transparent,
                        borderColor: colors.transparent,
                    },
                ]}
            >
                <MaterialIcons
                    name={saved ? 'bookmark' : 'bookmark-border'}
                    size={25}
                    color={saved ? palette.action : palette.mutedText}
                />
            </TouchableOpacity>
        );
    };

    const renderTranslateButton = (word) => (
        <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t('lookup.translateWord', { word })}
            activeOpacity={0.8}
            onPress={() => onTranslatePress?.(cleanValue(word) || tappedSurface)}
            style={styles.translateButton}
        >
            <MaterialIcons
                name="translate"
                size={21}
                color={palette.mutedText}
            />
        </TouchableOpacity>
    );

    const renderActionRow = (word, hanja, definition, inTranslationMode) => {
        const saved = hasSavableDefinition(definition) && isWordSaved(word);
        const canSave = hasSavableDefinition(definition);
        const saveLabel = saved ? t('lookup.saved') : t('lookup.save');
        const translateLabel = inTranslationMode ? t('lookup.dictionary') : t('lookup.translate');

        return (
            <View style={styles.actionRow}>
                <View style={styles.actionButtonGroup}>
                    {!explainMode ? (
                    <TouchableOpacity
                        style={[
                            styles.actionButton,
                            saved ? styles.actionButtonSaved : null,
                            !canSave && styles.actionButtonDisabled,
                        ]}
                        onPress={() => {
                            if (!canSave) {
                                return;
                            }
                            saved ? toggleUnSave(word, hanja, definition) : toggleSave(word, hanja, definition);
                        }}
                        activeOpacity={canSave ? 0.7 : 1}
                        accessibilityRole="button"
                        accessibilityLabel={saveLabel}
                    >
                        <MaterialIcons
                            name={saved ? 'bookmark' : 'bookmark-border'}
                            size={16}
                            color={saved ? palette.actionText : palette.text}
                            style={styles.actionButtonIcon}
                        />
                        <Text style={[styles.actionLabel, { color: saved ? palette.actionText : palette.text }]}>
                            {saveLabel}
                        </Text>
                    </TouchableOpacity>
                    ) : null}
                    {!inTranslationMode ? renderExplainActionButton() : null}
                    <TouchableOpacity
                        style={[
                            styles.actionButton,
                            styles.actionButtonRight,
                            inTranslationMode && styles.actionButtonRightActive,
                        ]}
                        onPress={() => { setExplainMode(false); setTranslationMode(!inTranslationMode); }}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel={translateLabel}
                    >
                        <MaterialIcons
                            name={inTranslationMode ? 'menu-book' : 'translate'}
                            size={15}
                            color={palette.text}
                            style={styles.actionButtonIcon}
                        />
                        <Text style={[styles.actionLabel, { color: palette.text }]} numberOfLines={1} adjustsFontSizeToFit>
                            {translateLabel}
                        </Text>
                    </TouchableOpacity>
                </View>
            </View>
        );
    };

    const renderNotFoundActionRow = (word) => {
        const notFoundSaved = isWordSaved(word);

        return (
            <View style={styles.actionRow}>
                <View style={styles.actionButtonGroup}>
                    {!explainMode ? (
                    <TouchableOpacity
                        style={[styles.actionButton, notFoundSaved ? styles.actionButtonSaved : null]}
                        onPress={() => notFoundSaved ? toggleUnSave(word, '', '') : toggleSave(word, '', '')}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel={notFoundSaved ? t('lookup.saved') : t('lookup.save')}
                    >
                        <MaterialIcons
                            name={notFoundSaved ? 'bookmark' : 'bookmark-border'}
                            size={16}
                            color={notFoundSaved ? palette.actionText : palette.text}
                            style={styles.actionButtonIcon}
                        />
                        <Text style={[styles.actionLabel, { color: notFoundSaved ? palette.actionText : palette.text }]}>
                            {notFoundSaved ? t('lookup.saved') : t('lookup.save')}
                        </Text>
                    </TouchableOpacity>
                    ) : null}
                    {renderExplainActionButton()}
                    <TouchableOpacity
                        style={[styles.actionButton, styles.actionButtonRight]}
                        onPress={() => { setExplainMode(false); onTranslatePress?.(word); }}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel={t('lookup.translate')}
                    >
                        <MaterialIcons
                            name="translate"
                            size={15}
                            color={palette.text}
                            style={styles.actionButtonIcon}
                        />
                        <Text style={[styles.actionLabel, { color: palette.text }]} numberOfLines={1} adjustsFontSizeToFit>{t('lookup.translate')}</Text>
                    </TouchableOpacity>
                </View>
            </View>
        );
    };

    const renderTranslationPanel = ({
        word,
        hanja,
        definition,
        pos,
        romanization,
        ipa,
        pinyin,
        audioUs,
        audioUk,
    }) => {
        const bookLanguage = normalizeBookLanguage(sourceBook?.language ?? 'ko');
        const interfaceLanguageCode = normalizeInterfaceLanguageCode(interfaceLanguage);

        return (
            <View style={[styles.panelContent, styles.dictionaryPanelContent, { backgroundColor: palette.surface }]}>
                <View style={styles.translationPanelBody}>
                    {renderEntryHeading({ word, hanja, definition, pos, romanization, ipa, pinyin, audioUs, audioUk })}
                    <Text style={styles.translationSectionTitle}>{t('lookup.translate')}</Text>
                    <View style={styles.translationContentWrap}>
                        <TranslationContent
                            highlightedWord={word}
                            isDarkMode={isDarkMode}
                            onContentLoaded={onContentLoaded}
                            sourceLanguage={bookLanguage}
                            targetLanguage={interfaceLanguageCode}
                            compact
                            forceLoading={translationLoadingPreview}
                            forceError={translationErrorPreview}
                            forceErrorMessage={t('lookup.noTranslation')}
                            forceTranslatedText={translationTextPreview}
                            maxScrollHeight={176}
                            bottomPadding={0}
                            nestedScrollEnabled
                        />
                    </View>
                </View>
                {renderActionRow(word, hanja, definition, true)}
            </View>
        );
    };

    const handlePronunciationPress = async ({ word, audioUs, audioUk, preferredAccent }) => {
        try {
            await playEnglishPronunciation({
                word,
                audioUs,
                audioUk,
                preferredAccent,
            });
        } catch (error) {
            console.warn('[DictionaryContent] pronunciation playback failed:', error?.message || error);
        }
    };

    const renderPronunciationControls = ({ word, audioUs, audioUk }) => {
        if (!isEnglishBook || !cleanValue(word)) {
            return null;
        }

        return (
            <View style={styles.pronunciationControls}>
                {[
                    ['us', 'US', t('lookup.playUsPronunciation', { word })],
                    ['uk', 'UK', t('lookup.playUkPronunciation', { word })],
                ].map(([accent, label, accessibilityLabel]) => (
                    <TouchableOpacity
                        key={accent}
                        accessibilityRole="button"
                        accessibilityLabel={accessibilityLabel}
                        activeOpacity={0.78}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        onPress={() => handlePronunciationPress({
                            word,
                            audioUs,
                            audioUk,
                            preferredAccent: accent,
                        })}
                        style={[
                            styles.pronunciationAccentButton,
                            {
                                borderColor: palette.border,
                                backgroundColor: palette.secondaryButtonBg,
                            },
                        ]}
                    >
                        <MaterialIcons name="volume-up" size={13} color={palette.mutedText} />
                        <Text style={[styles.pronunciationAccentText, { color: palette.mutedText }]}>
                            {label}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>
        );
    };

    const renderHeadwordChevron = (direction) => {
        const isPrevious = direction === 'previous';
        const disabled = !hasWordNavigation
            || (isPrevious ? currentLookupIndex <= 0 : currentLookupIndex >= lookupItemCount - 1);

        return (
            <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={isPrevious ? t('lookup.previousDetectedWord') : t('lookup.nextDetectedWord')}
                activeOpacity={disabled ? 1 : 0.78}
                disabled={disabled}
                onPress={isPrevious ? goToPreviousWord : goToNextWord}
                hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
                style={styles.headwordChevronButton}
            >
                {hasWordNavigation ? (
                    <MaterialIcons
                        name={isPrevious ? 'chevron-left' : 'chevron-right'}
                        size={24}
                        color={disabled ? colors.frame : colors.textSecondary}
                    />
                ) : null}
            </TouchableOpacity>
        );
    };

    const renderEntryHeading = ({ word, hanja, definition, pos, romanization, ipa, pinyin, audioUs, audioUk }) => {
        const sourceWordDetails = buildSourceWordDetails({ hanja, definition });
        const hanjaElement = isKoreanBook ? renderHanja(hanja, 'entry', word, sourceWordDetails) : null;
        const romanizationText = cleanValue(romanization);
        const ipaText = cleanValue(ipa);
        const pinyinText = cleanValue(pinyin);
        const pronunciationText = isEnglishBook ? ipaText : (isChineseBook ? pinyinText : romanizationText);
        const pronunciationControls = renderPronunciationControls({ word, audioUs, audioUk });

        return (
            <View style={styles.entryHeading}>
                <View style={styles.headwordRow}>
                    {renderHeadwordChevron('previous')}
                    <View style={styles.wordLine}>
                        <Text selectable style={[styles.entryWord, { color: palette.text }]}>
                            {word}
                        </Text>
                        {hanjaElement}
                        {pronunciationText ? (
                            <Text selectable style={[styles.entryMeta, { color: palette.mutedText }]}>
                                {pronunciationText}
                            </Text>
                        ) : null}
                    </View>
                    {renderHeadwordChevron('next')}
                </View>
                {pronunciationControls ? (
                    <View style={styles.entryMetaRow}>
                        {pronunciationControls}
                    </View>
                ) : null}
            </View>
        );
    };

    const renderExtraDefinitions = (entries) => {
        if (!Array.isArray(entries) || entries.length === 0) {
            return null;
        }

        return (
            <ScrollView
                style={[styles.extraList, { borderTopColor: palette.border }]}
                contentContainerStyle={styles.extraListContent}
                nestedScrollEnabled
                showsVerticalScrollIndicator={false}
            >
                {entries.map((entry, index) => {
                    const word = cleanValue(entry.word) || lookupWord;
                    const hanja = getEntryHanja(entry);
                    const definition = getEntryDefinition(entry);
                    const pinyin = getEntryPinyin(entry);
                    const sourceWordDetails = buildSourceWordDetails({ hanja, definition });
                    const saved = isWordSaved(word);

                    return (
                        <View
                            key={`${word}-${hanja}-${definition}-${index}`}
                            style={[
                                styles.extraDefinitionRow,
                                index > 0 && { borderTopColor: palette.border, borderTopWidth: StyleSheet.hairlineWidth },
                            ]}
                        >
                            <View style={styles.extraDefinitionBody}>
                                <View style={styles.extraWordLine}>
                                    <Text selectable style={[styles.extraWord, { color: palette.text }]}>{word}</Text>
                                    {isKoreanBook ? renderHanja(hanja, 'extra', word, sourceWordDetails) : null}
                                </View>
                                {isChineseBook && pinyin ? (
                                    <Text selectable style={[styles.extraMeta, { color: palette.mutedText }]}>
                                        {pinyin}
                                    </Text>
                                ) : null}
                                <Text selectable style={[styles.extraDefinition, { color: palette.secondaryText }]}>
                                    {definition || t('lookup.noEnglishDefinition')}
                                </Text>
                            </View>
                            {hasSavableDefinition(definition) ? (
                                <TouchableOpacity
                                    accessibilityRole="button"
                                    accessibilityLabel={saved
                                        ? t('lookup.removeWord', { word })
                                        : t('lookup.saveWord', { word })}
                                    activeOpacity={0.85}
                                    style={[
                                        styles.extraSaveButton,
                                        {
                                            backgroundColor: saved ? palette.action : palette.secondaryButtonBg,
                                            borderColor: saved ? palette.action : palette.border,
                                        },
                                    ]}
                                    onPress={() =>
                                        saved
                                            ? toggleUnSave(word, hanja, definition, { includeSurface: false })
                                            : toggleSave(word, hanja, definition, { includeSurface: false })
                                    }
                                >
                                    <MaterialIcons
                                        name={saved ? 'check' : 'add'}
                                        size={18}
                                        color={saved ? palette.icon : palette.secondaryButtonText}
                                    />
                                </TouchableOpacity>
                            ) : null}
                        </View>
                    );
                })}
            </ScrollView>
        );
    };

    const renderWordParts = (wordParts, word) => {
        const confidence = cleanValue(wordParts?.confidence);
        const parts = getRenderableWordPartItems(wordParts);
        const relatedRootGroups = getRenderableRelatedRootGroups(wordParts, word);

        if (!isEnglishBook || !hasRenderableWordParts(wordParts, word)) {
            return null;
        }

        return (
            <View style={[styles.wordPartsSection, { borderTopColor: palette.border }]}>
                <View style={styles.wordPartsHeader}>
                    <Text style={[styles.wordPartsTitle, { color: palette.mutedText }]}>
                        {t(getWordPartsTitleKey(parts))}
                    </Text>
                    {confidence === 'low' ? (
                        <Text
                            style={[
                                styles.wordPartsConfidence,
                                {
                                    color: palette.mutedText,
                                    borderColor: palette.border,
                                    backgroundColor: palette.secondaryButtonBg,
                                },
                            ]}
                        >
                            {t('lookup.wordParts.inferred')}
                        </Text>
                    ) : null}
                </View>
                <View style={styles.wordPartsRow}>
                    {parts.map((part, index) => {
                        const canDrillDown = isDrilldownWordPart(part);
                        const itemContent = (
                            <>
                                <View style={styles.wordPartTextRow}>
                                    <Text selectable={!canDrillDown} style={[styles.wordPartText, { color: palette.text }]}>
                                        {part.text}
                                    </Text>
                                    {canDrillDown ? (
                                        <MaterialIcons name="chevron-right" size={14} color={palette.mutedText} />
                                    ) : null}
                                </View>
                                <Text style={[styles.wordPartType, { color: palette.mutedText }]}>
                                    {t(getWordPartLabelKey(part.type))}
                                </Text>
                                {part.meaning || part.note ? (
                                    <Text selectable style={[styles.wordPartMeaning, { color: palette.secondaryText }]}>
                                        {part.meaning || part.note}
                                    </Text>
                                ) : null}
                            </>
                        );

                        return (
                            <React.Fragment key={`${part.text}-${part.type}-${index}`}>
                                {index > 0 ? (
                                    <Text style={[styles.wordPartJoiner, { color: palette.mutedText }]}>+</Text>
                                ) : null}
                                {canDrillDown ? (
                                    <TouchableOpacity
                                        accessibilityRole="button"
                                        accessibilityLabel={t('lookup.openWordPart', { word: part.lookupText })}
                                        activeOpacity={0.82}
                                        onPress={() => handleWordPartPress(part)}
                                        style={[
                                            styles.wordPartItem,
                                            styles.wordPartItemInteractive,
                                            { borderColor: palette.border },
                                        ]}
                                    >
                                        {itemContent}
                                    </TouchableOpacity>
                                ) : (
                                    <View style={[styles.wordPartItem, { borderColor: palette.border }]}>
                                        {itemContent}
                                    </View>
                                )}
                            </React.Fragment>
                        );
                    })}
                </View>
                {relatedRootGroups.length > 0 ? (
                    <View style={[styles.relatedRootsSection, { borderTopColor: palette.border }]}>
                        <Text style={[styles.relatedRootsTitle, { color: palette.mutedText }]}>
                            {t('lookup.relatedRoots')}
                        </Text>
                        {relatedRootGroups.map((group) => (
                            <View key={group.root} style={styles.relatedRootGroup}>
                                <View style={styles.relatedRootHeader}>
                                    <Text selectable style={[styles.relatedRootName, { color: palette.text }]}>
                                        {group.root}
                                    </Text>
                                    {group.meaning ? (
                                        <Text
                                            selectable
                                            style={[styles.relatedRootMeaning, { color: palette.secondaryText }]}
                                            numberOfLines={1}
                                        >
                                            {group.meaning}
                                        </Text>
                                    ) : null}
                                </View>
                                <View style={styles.relatedWordRow}>
                                    {group.words.map((entry) => (
                                        <TouchableOpacity
                                            key={`${group.root}-${entry.word}`}
                                            accessibilityRole="button"
                                            accessibilityLabel={t('lookup.openRelatedWord', { word: entry.word })}
                                            activeOpacity={0.82}
                                            onPress={() => handleRelatedRootWordPress(entry.word)}
                                            style={[styles.relatedWordChip, { borderColor: palette.border }]}
                                        >
                                            <Text style={[styles.relatedWordText, { color: palette.text }]}>
                                                {entry.word}
                                            </Text>
                                            {entry.definition ? (
                                                <Text
                                                    style={[styles.relatedWordDefinition, { color: palette.secondaryText }]}
                                                    numberOfLines={1}
                                                >
                                                    {entry.definition}
                                                </Text>
                                            ) : null}
                                        </TouchableOpacity>
                                    ))}
                                </View>
                            </View>
                        ))}
                    </View>
                ) : null}
            </View>
        );
    };

    const renderOrigin = (etymology, word) => {
        const origin = cleanValue(etymology).replace(/\s+/g, ' ');
        if (!isEnglishBook || !isSafeOrigin(etymology, word)) {
            return null;
        }

        return (
            <View style={[styles.originSection, { borderTopColor: palette.border }]}>
                <Text style={[styles.originTitle, { color: palette.mutedText }]}>
                    {t('lookup.origin')}
                </Text>
                <Text selectable style={[styles.originText, { color: palette.secondaryText }]}>
                    {origin}
                </Text>
            </View>
        );
    };

    // Smart-definition is keyed on the tapped SURFACE form (tappedSurface) rather
    // than any single dictionary stem — so an eojeol Kiwi shattered into fragments
    // (설워하는 → 설/워/하다) is explained and saved as one word (lemma 설워하다).
    const explainKey = cleanValue(tappedSurface);
    const canExplain = !!explainKey && !!contextSentence;
    // The AI returns a stemmed base form (lemma) for the tapped surface — Kiwi
    // often can't lemmatize the words that land here (archaic/dialectal). Once the
    // fetch resolves we show and save that base form; until then (or if the model
    // returns none) we fall back to the tapped surface itself.
    const explainLemma = cleanValue(explainData[explainKey]?.lemma);
    const explainHeadword = explainLemma || explainKey;

    // Body-only smart-definition content: the short gloss + save button on top
    // (immediately visible and saveable), then the longer contextual explanation
    // underneath. It REPLACES the dictionary definition body while keeping the
    // entry's title (word + hanja + pronunciation) rendered above it by the caller.
    const renderExplainBodySection = () => {
        const data = explainData[explainKey] || {};
        // Save the AI-stemmed base form (falling back to the tapped surface when the
        // model returns none), so title and flashcard both show a clean headword.
        const saveWord = explainHeadword;
        const glossText = cleanValue(data.gloss);
        const hasGloss = !data.loading && !!data.text && !!glossText;
        const aiSaved = hasGloss && isWordSaved(saveWord);

        return (
            <View style={styles.explainSection}>
                {hasGloss ? (
                    <View style={styles.explainGlossRow}>
                        <Text selectable style={[styles.explainGloss, { color: palette.text }]}>
                            {glossText}
                        </Text>
                        <TouchableOpacity
                            style={[styles.aiSaveButton, aiSaved ? styles.actionButtonSaved : null]}
                            onPress={() => saveWithAiDefinition(saveWord, glossText)}
                            activeOpacity={0.7}
                            accessibilityRole="button"
                            accessibilityLabel={aiSaved ? t('lookup.saved') : t('lookup.saveAiDefinition')}
                        >
                            <MaterialIcons
                                name={aiSaved ? 'bookmark' : 'bookmark-border'}
                                size={16}
                                color={aiSaved ? palette.actionText : palette.text}
                                style={styles.actionButtonIcon}
                            />
                            <Text style={[styles.actionLabel, { color: aiSaved ? palette.actionText : palette.text }]}>
                                {aiSaved ? t('lookup.saved') : t('lookup.saveAiDefinition')}
                            </Text>
                        </TouchableOpacity>
                    </View>
                ) : null}

                <View style={[styles.explainBody, { borderTopColor: palette.border }]}>
                    <Text style={[styles.explainBodyTitle, { color: palette.mutedText }]}>
                        {t('lookup.explainInThisSentence')}
                    </Text>
                    {data.loading ? (
                        <View style={styles.explainLoadingRow}>
                            <ActivityIndicator size="small" color={palette.action} />
                            <Text style={[styles.explainLoadingText, { color: palette.mutedText }]}>
                                {t('lookup.explainLoading')}
                            </Text>
                        </View>
                    ) : data.text ? (
                        <Text selectable style={[styles.explainBodyText, { color: palette.secondaryText }]}>
                            {data.text}
                        </Text>
                    ) : (
                        <TouchableOpacity
                            accessibilityRole="button"
                            activeOpacity={0.85}
                            onPress={() => fetchExplanation(explainKey)}
                        >
                            <Text style={[styles.explainErrorText, { color: palette.emptyText }]}>
                                {data.error || t('lookup.explainFailed')}
                            </Text>
                        </TouchableOpacity>
                    )}
                </View>
            </View>
        );
    };

    // The middle button in the action row that toggles smart-definition mode.
    const renderExplainActionButton = () => {
        if (!canExplain) {
            return null;
        }

        return (
            <TouchableOpacity
                style={[styles.actionButton, explainMode ? styles.actionButtonRightActive : null]}
                onPress={() => handleSmartDefinitionPress(explainKey)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityState={{ expanded: explainMode }}
                accessibilityLabel={t('lookup.explainInContext')}
            >
                <MaterialIcons
                    name="auto-awesome"
                    size={15}
                    color={palette.action}
                    style={styles.actionButtonIcon}
                />
                <Text style={[styles.actionLabel, { color: palette.text }]} numberOfLines={1} adjustsFontSizeToFit>
                    {t('lookup.smartDefinition')}
                </Text>
            </TouchableOpacity>
        );
    };

    const renderPrimaryEntry = ({
        key,
        word,
        hanja,
        definition,
        gloss,
        pos,
        romanization,
        ipa,
        pinyin,
        audioUs,
        audioUk,
        etymology,
        wordParts,
        showMore,
        showLess,
        onMore,
        onLess,
        extraEntries,
        separated,
    }) => {
        const posLabel = formatPos(pos, t);

        // In smart-definition mode the title shows the AI-stemmed base form of the
        // tapped word (surface fallback until the fetch resolves), matching what
        // "Save this" keeps.
        const headingWord = explainMode ? explainHeadword : word;

        return (
            <View key={key} style={[styles.primaryEntry, separated && { borderTopColor: palette.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
                {renderEntryHeading({ word: headingWord, hanja, definition, pos, romanization, ipa, pinyin, audioUs, audioUk })}
                {explainMode ? renderExplainBodySection() : (
                    <>
                        {isPanelExpanded && isEnglishBook && gloss ? (
                            <Text selectable style={[styles.glossText, { color: palette.text }]}>
                                {gloss}
                            </Text>
                        ) : null}
                        <View style={[styles.definitionRow, !posLabel && styles.definitionRowSolo]}>
                            {posLabel ? (
                                <View style={[styles.posBadge, { borderColor: palette.border }]}>
                                    <Text style={[styles.posBadgeText, { color: palette.mutedText }]}>
                                        {posLabel}
                                    </Text>
                                </View>
                            ) : null}
                            {definition ? (
                                // In the compact panel the definition is capped at two
                                // rows and scrolls past that, so the sheet hugs the
                                // definition height instead of leaving a gap above the
                                // action buttons. Expanded, it renders in full.
                                isPanelExpanded ? (
                                    <Text selectable style={[styles.definitionText, { color: palette.secondaryText }]}>
                                        {definition}
                                    </Text>
                                ) : (
                                    <ScrollView
                                        style={styles.definitionScroll}
                                        nestedScrollEnabled
                                        showsVerticalScrollIndicator={false}
                                        bounces={false}
                                        keyboardShouldPersistTaps="handled"
                                    >
                                        <Text selectable style={[styles.definitionText, { color: palette.secondaryText }]}>
                                            {definition}
                                        </Text>
                                    </ScrollView>
                                )
                            ) : (
                                <Text selectable style={[styles.emptyDefinition, { color: palette.emptyText }]}>
                                    {t('lookup.noDictionaryEntry')}
                                </Text>
                            )}
                        </View>
                        {isPanelExpanded && isEnglishBook ? renderWordParts(wordParts, word) : null}
                        {isPanelExpanded && isEnglishBook && !hasRenderableWordParts(wordParts, word) ? renderOrigin(etymology, word) : null}
                        {isPanelExpanded && showLess ? renderExtraDefinitions(extraEntries) : null}
                    </>
                )}
            </View>
        );
    };

    const renderDefinitionLoadingPanel = () => {
        const loadingWord = cleanValue(lookupWord) || tappedSurface;

        return (
            <View style={[styles.panelContent, styles.dictionaryPanelContent, { backgroundColor: palette.surface }]}>
                <View style={styles.definitionLoadingContent}>
                    {loadingWord ? (
                        <View style={styles.definitionLoadingHeadword}>
                            <Text
                                selectable
                                style={[styles.entryWord, styles.definitionLoadingWord, { color: palette.text }]}
                            >
                                {loadingWord}
                            </Text>
                        </View>
                    ) : null}
                    <View style={styles.definitionLoadingArea}>
                        <LookupLoadingSkeleton
                            firstLineOffset={0}
                            secondLineOffset={10}
                            shortLineWidth="66%"
                        />
                    </View>
                </View>
            </View>
        );
    };

    // Not-found panel. Mirrors renderDictionaryPanel's structure so the header +
    // (in smart-definition mode) the explanation live inside a ScrollView while the
    // action row stays pinned below. Without this the content overflowed the fixed
    // sheet height, clipping the word header at the top with no way to scroll.
    const renderNotFoundPanel = () => (
        <View style={[styles.panelContent, styles.dictionaryPanelContent, { backgroundColor: palette.surface }]}>
            <ScrollView
                ref={dictionaryScrollRef}
                style={styles.dictionaryScroll}
                contentContainerStyle={[
                    styles.notFoundScrollContent,
                    explainMode ? styles.notFoundScrollContentExplain : styles.notFoundScrollContentCentered,
                ]}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled={isDictionaryScrollable}
                scrollEnabled={isDictionaryScrollable}
                showsVerticalScrollIndicator={isDictionaryScrollable}
                bounces={isDictionaryScrollable}
                onLayout={(event) => {
                    setDictionaryViewportHeight(event.nativeEvent.layout.height);
                }}
                onContentSizeChange={(_, height) => {
                    setDictionaryContentHeight(height);
                    onContentHeightChange?.(height);
                }}
            >
                <Text style={[styles.entryWord, styles.notFoundWord, { color: palette.text }]}>{explainMode ? explainHeadword : lookupWord}</Text>
                {explainMode ? renderExplainBodySection() : (
                    <Text style={[styles.notFoundSubtext, { color: colors.textSubtle }]}>{t('lookup.noDefinition')}</Text>
                )}
            </ScrollView>
            {renderNotFoundActionRow(lookupWord)}
        </View>
    );

    if (cachedResults === null) {
        return renderDefinitionLoadingPanel();
    }

    if (cachedResults.length === 0 && !needsLiveFetch && lookupItemCount === 0) {
        return renderNotFoundPanel();
    }

    if (needsLiveFetch && !liveError && (isLiveLoading || (dictionaryData.length === 0 && lookupItemCount === 0))) {
        return renderDefinitionLoadingPanel();
    }

    if (!activeLookupItem) {
        return renderNotFoundPanel();
    }

    const cachedEntry = activeLookupItem.cachedEntry;
    const liveEntries = activeLookupItem.liveEntries || [];
    const firstLiveEntry = liveEntries[0];

    if (cachedEntry) {
        const stem = getEntryWord(cachedEntry, activeLookupItem.stem || lookupWord);
        const liveMeta = liveEntryMeta[cachedEntry.stem] || firstLiveEntry || {};
        const extra = extraDefs[cachedEntry.stem];
        const isExpanded = !!expandedCached[cachedEntry.stem];
        const showMore = Array.isArray(extra) && extra.length > 0 && !isExpanded;
        const showLess = isExpanded && Array.isArray(extra) && extra.length > 0;
        const cachedHanja = getEntryHanja(cachedEntry);
        const cachedDefinition = getEntryDefinition(cachedEntry);

        if (translationMode) {
            return renderTranslationPanel({
                word: stem,
                hanja: cachedHanja,
                definition: cachedDefinition,
                pos: getEntryPos(cachedEntry) || getEntryPos(liveMeta),
                romanization: romanizations[stem] || getEntryRomanization(liveMeta),
                ipa: getEntryIpa(cachedEntry) || getEntryIpa(liveMeta),
                pinyin: getEntryPinyin(cachedEntry) || getEntryPinyin(liveMeta),
                audioUs: getEntryAudioUs(cachedEntry) || getEntryAudioUs(liveMeta),
                audioUk: getEntryAudioUk(cachedEntry) || getEntryAudioUk(liveMeta),
            });
        }

        return (
            renderDictionaryPanel(
                <>
                {renderPrimaryEntry({
                    key: `${stem}-${cachedEntry.hanja ?? ''}`,
                    word: stem,
                    hanja: cachedHanja,
                    definition: cachedDefinition,
                    gloss: getEntryGloss(cachedEntry) || getEntryGloss(liveMeta),
                    pos: getEntryPos(cachedEntry) || getEntryPos(liveMeta),
                    romanization: romanizations[stem] || getEntryRomanization(liveMeta),
                    ipa: getEntryIpa(cachedEntry) || getEntryIpa(liveMeta),
                    pinyin: getEntryPinyin(cachedEntry) || getEntryPinyin(liveMeta),
                    audioUs: getEntryAudioUs(cachedEntry) || getEntryAudioUs(liveMeta),
                    audioUk: getEntryAudioUk(cachedEntry) || getEntryAudioUk(liveMeta),
                    etymology: getEntryEtymology(cachedEntry) || getEntryEtymology(liveMeta),
                    wordParts: getMergedEntryWordParts(cachedEntry, liveMeta),
                    showMore,
                    showLess,
                    onMore: () => setExpandedCached(prev => ({ ...prev, [cachedEntry.stem]: true })),
                    onLess: () => setExpandedCached(prev => ({ ...prev, [cachedEntry.stem]: false })),
                    extraEntries: extra,
                    separated: false,
                })}

                {isKoreanBook && isPanelExpanded && !explainMode ? (
                <HanjaDetails
                    hanja={currentHanja?.character ?? getHanjaCharacters(cachedHanja)[0] ?? null}
                    hanjaCharacters={currentHanja?.characters?.length ? currentHanja.characters : getHanjaCharacters(cachedHanja)}
                    sourceWord={currentHanja?.sourceWord ?? stem}
                    sourceWordDetails={currentHanja?.sourceWordDetails ?? {}}
                    onKnownWordMarked={handleRelatedKnownWordMarked}
                    onKnownWordRemoved={handleRelatedKnownWordRemoved}
                    onSourceWordAutoSaved={handleSourceWordAutoSaved}
                    onCarouselIndexChange={scrollDictionaryToTop}
                    isDarkMode={isDarkMode}
                />
                ) : null}
                </>
                ,
                { word: stem, hanja: cachedHanja, definition: cachedDefinition }
            )
        );
    }

    const word = activeLookupItem.stem || lookupWord;
    const first = firstLiveEntry;
    const isExpanded = expandedWords.includes(word);
    const extraEntries = first ? uniqueEntriesByWord(liveEntries.slice(1), first?.word || word) : [];
    const liveHanja = getEntryHanja(first);
    const liveDefinition = getEntryDefinition(first);
    const liveWord = first ? (cleanValue(first.word) || word) : word;

    if (translationMode) {
        return renderTranslationPanel({
            word: liveWord,
            hanja: liveHanja,
            definition: liveDefinition,
            pos: getEntryPos(first),
            romanization: romanizations[word] || getEntryRomanization(first),
            ipa: getEntryIpa(first),
            pinyin: getEntryPinyin(first),
            audioUs: getEntryAudioUs(first),
            audioUk: getEntryAudioUk(first),
        });
    }

    return renderDictionaryPanel(
        <>
            {first ? renderPrimaryEntry({
                key: `${word}-${first.origin ?? ''}`,
                word: cleanValue(first.word) || word,
                hanja: getEntryHanja(first),
                definition: getEntryDefinition(first),
                gloss: getEntryGloss(first),
                pos: getEntryPos(first),
                romanization: romanizations[word] || getEntryRomanization(first),
                ipa: getEntryIpa(first),
                pinyin: getEntryPinyin(first),
                audioUs: getEntryAudioUs(first),
                audioUk: getEntryAudioUk(first),
                etymology: getEntryEtymology(first),
                wordParts: getEntryWordParts(first),
                showMore: extraEntries.length > 0 && !isExpanded,
                showLess: extraEntries.length > 0 && isExpanded,
                onMore: () => setExpandedWords(prev => [...prev, word]),
                onLess: () => setExpandedWords(prev => prev.filter(item => item !== word)),
                extraEntries,
                separated: false,
            }) : renderPrimaryEntry({
                key: `${word}-empty`,
                word,
                hanja: '',
                definition: '',
                gloss: '',
                pos: '',
                romanization: romanizations[word],
                ipa: '',
                pinyin: '',
                audioUs: '',
                audioUk: '',
                etymology: '',
                wordParts: null,
                showMore: false,
                showLess: false,
                separated: false,
            })}

            {isKoreanBook && isPanelExpanded && !explainMode ? (
            <HanjaDetails
                hanja={currentHanja?.character ?? getHanjaCharacters(liveHanja)[0] ?? null}
                hanjaCharacters={currentHanja?.characters?.length ? currentHanja.characters : getHanjaCharacters(liveHanja)}
                sourceWord={currentHanja?.sourceWord ?? word}
                sourceWordDetails={currentHanja?.sourceWordDetails ?? {}}
                onKnownWordMarked={handleRelatedKnownWordMarked}
                onKnownWordRemoved={handleRelatedKnownWordRemoved}
                onSourceWordAutoSaved={handleSourceWordAutoSaved}
                onCarouselIndexChange={scrollDictionaryToTop}
                isDarkMode={isDarkMode}
            />
            ) : null}
        </>
        ,
        { word: liveWord, hanja: liveHanja, definition: liveDefinition }
    );
};

const createStyles = (colors) => StyleSheet.create({
    panelContent: {
        flex: 1,
        paddingHorizontal: 0,
        paddingTop: 0,
        paddingBottom: 0,
    },
    dictionaryPanelContent: {
        paddingHorizontal: 0,
        paddingTop: 0,
        paddingBottom: 0,
        position: 'relative',
    },
    dictionaryScroll: {
        flex: 1,
        minHeight: 0,
    },
    dictionaryScrollContent: {
        paddingHorizontal: 0,
        paddingTop: 0,
        paddingBottom: 0,
    },
    dictionaryScrollContentWithNav: {
        paddingHorizontal: 0,
    },
    primaryEntry: {
        gap: 10,
        paddingHorizontal: 24,
        paddingBottom: 0,
    },
    entryHeading: {
        gap: 4,
    },
    headwordRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    headwordChevronButton: {
        width: 24,
        height: 34,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    entryHeadingTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
    },
    entryTitleColumn: {
        flex: 1,
        minWidth: 0,
        alignItems: 'center',
    },
    wordLine: {
        flex: 1,
        minWidth: 0,
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'center',
        flexWrap: 'wrap',
        gap: 12,
        paddingTop: 0,
    },
    entryWord: {
        fontFamily: fontFamilies.krSerifSemiBold,
        fontSize: 28,
        lineHeight: 36,
        letterSpacing: 0,
        paddingTop: 0,
        includeFontPadding: true,
    },
    entryHanja: {
        fontFamily: fontFamilies.krSerifMedium,
        fontSize: 17,
        lineHeight: 24,
    },
    entryMeta: {
        fontFamily: fontFamilies.displayItalic,
        fontSize: 14,
        lineHeight: 20,
        marginTop: 0,
        textAlign: 'left',
    },
    entryMetaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        marginTop: 0,
        flexWrap: 'wrap',
    },
    pronunciationControls: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
    },
    pronunciationAccentButton: {
        minWidth: 42,
        height: 22,
        borderRadius: 6,
        borderWidth: StyleSheet.hairlineWidth,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 3,
        paddingHorizontal: 6,
    },
    pronunciationAccentText: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 9,
        lineHeight: 11,
        letterSpacing: 0,
    },
    headerActions: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        flexShrink: 0,
        gap: 2,
        paddingTop: 0,
        marginRight: -4,
    },
    actionRow: {
        paddingHorizontal: 24,
        paddingTop: 8,
        paddingBottom: 0,
    },
    actionButtonGroup: {
        flexDirection: 'row',
        gap: 8,
    },
    actionButton: {
        flex: 1,
        height: 44,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 8,
        backgroundColor: colors.readerSurface,
        borderWidth: 1,
        borderColor: colors.readerBorder,
        borderRadius: radii.xs,
    },
    actionButtonSaved: {
        backgroundColor: colors.readerTappedWordBg,
        borderColor: colors.readerTappedWordBg,
    },
    actionButtonRight: {
        borderColor: colors.readerBorder,
    },
    actionButtonRightActive: {
        backgroundColor: colors.readerSavedChipBg,
    },
    actionButtonDisabled: {
        opacity: 0.5,
    },
    actionButtonIcon: {
        marginRight: 6,
    },
    actionLabel: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 10,
        lineHeight: 13,
        // Longer labels ("translate", "smart definition") ran edge to edge in the
        // button at 1.8; tightened so the tracking still reads but leaves gutters.
        letterSpacing: 1.2,
        textTransform: 'uppercase',
        flexShrink: 1,
    },
    translationPanelBody: {
        paddingHorizontal: 24,
        paddingTop: 0,
    },
    translationSectionTitle: {
        ...textStyles.eyebrow,
        fontSize: 9,
        lineHeight: 13,
        letterSpacing: 1.8,
        marginTop: 14,
        marginBottom: 9,
        color: colors.textSubtle,
    },
    translationContentWrap: {
        flexGrow: 0,
        flexShrink: 1,
    },
    definitionLoadingContent: {
        paddingHorizontal: 24,
        paddingTop: 0,
        gap: 14,
    },
    definitionLoadingHeadword: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    definitionLoadingWord: {
        textAlign: 'center',
    },
    definitionLoadingArea: {
        minHeight: 56,
    },
    posBadge: {
        borderRadius: 3,
        paddingHorizontal: 14,
        paddingVertical: 6,
        borderWidth: 1,
        borderColor: colors.readerBorder,
        backgroundColor: colors.transparent,
    },
    posBadgeText: {
        ...textStyles.caption,
        fontFamily: fontFamilies.sansBold,
        fontSize: 12,
        lineHeight: 15,
        letterSpacing: 2.2,
        textTransform: 'uppercase',
    },
    definitionText: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 15,
        lineHeight: 23,
        letterSpacing: 0,
        textAlign: 'center',
        flexShrink: 1,
    },
    // Caps the compact definition at ~two rows (2 × 23 lineHeight plus a little
    // padding headroom); anything longer scrolls within this box.
    definitionScroll: {
        flexShrink: 1,
        maxHeight: 56,
    },
    definitionRow: {
        // Stacked (not side-by-side) so the POS badge centers on its own line
        // above the centered definition; a row left the badge hanging to the
        // left of the centered group.
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingHorizontal: 0,
        paddingVertical: 8,
        // Sized to hug a single-line definition. A fixed 44 here padded the row
        // enough that word + pronunciation + a one-line definition overflowed the
        // compact sheet and turned it into a scroll view.
        minHeight: 26,
    },
    definitionRowSolo: {
        justifyContent: 'center',
    },
    glossText: {
        fontFamily: fontFamilies.sans,
        fontSize: 18,
        lineHeight: 23,
        fontWeight: '600',
        marginBottom: spacing.xs,
        letterSpacing: 0,
    },
    explainSection: {
        width: '100%',
        marginTop: spacing.sm,
    },
    explainGlossRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
    },
    explainGloss: {
        flex: 1,
        fontFamily: fontFamilies.sansBold,
        fontSize: 17,
        lineHeight: 24,
    },
    explainBody: {
        marginTop: spacing.md,
        paddingTop: spacing.md,
        borderTopWidth: StyleSheet.hairlineWidth,
        gap: 8,
    },
    explainBodyTitle: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 12,
        lineHeight: 15,
        letterSpacing: 2,
        textTransform: 'uppercase',
    },
    explainBodyText: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 15,
        lineHeight: 23,
        letterSpacing: 0,
    },
    explainLoadingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    explainLoadingText: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 20,
    },
    explainErrorText: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 20,
    },
    aiSaveButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 9,
        paddingHorizontal: 14,
        backgroundColor: colors.readerSurface,
        borderWidth: 1,
        borderColor: colors.readerBorder,
        borderRadius: radii.xs,
    },
    originSection: {
        gap: 6,
        paddingTop: spacing.sm,
        marginTop: spacing.xs,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    originTitle: {
        ...textStyles.caption,
        fontFamily: fontFamilies.sansBold,
        fontSize: 10,
        lineHeight: 13,
        letterSpacing: 0,
        textAlign: 'center',
        textTransform: 'uppercase',
    },
    originText: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 12,
        lineHeight: 17,
        letterSpacing: 0,
        textAlign: 'center',
    },
    wordPartsSection: {
        gap: 8,
        paddingTop: spacing.sm,
        marginTop: spacing.xs,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    wordPartsHeader: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
    },
    wordPartsTitle: {
        ...textStyles.caption,
        fontFamily: fontFamilies.sansBold,
        fontSize: 10,
        lineHeight: 13,
        letterSpacing: 0,
        textAlign: 'center',
        textTransform: 'uppercase',
    },
    wordPartsConfidence: {
        ...textStyles.caption,
        fontFamily: fontFamilies.sansBold,
        fontSize: 9,
        lineHeight: 12,
        letterSpacing: 0,
        textAlign: 'center',
        textTransform: 'uppercase',
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 5,
        paddingHorizontal: 5,
        paddingVertical: 2,
        overflow: 'hidden',
    },
    wordPartsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
    },
    relatedRootsSection: {
        gap: 8,
        paddingTop: spacing.sm,
        marginTop: spacing.xs,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    relatedRootsTitle: {
        ...textStyles.caption,
        fontFamily: fontFamilies.sansBold,
        fontSize: 10,
        lineHeight: 13,
        letterSpacing: 0,
        textAlign: 'center',
        textTransform: 'uppercase',
    },
    relatedRootGroup: {
        gap: 6,
    },
    relatedRootHeader: {
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
    },
    relatedRootName: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 13,
        lineHeight: 17,
        letterSpacing: 0,
    },
    relatedRootMeaning: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 11,
        lineHeight: 14,
        letterSpacing: 0,
        textAlign: 'center',
        maxWidth: 220,
    },
    relatedWordRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: 6,
    },
    relatedWordChip: {
        minWidth: 82,
        maxWidth: 146,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 6,
        paddingHorizontal: 8,
        paddingVertical: 6,
        gap: 2,
        alignItems: 'center',
    },
    relatedWordText: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 12,
        lineHeight: 16,
        letterSpacing: 0,
        textAlign: 'center',
    },
    relatedWordDefinition: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 10,
        lineHeight: 13,
        letterSpacing: 0,
        textAlign: 'center',
    },
    drilldownBackRow: {
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        paddingHorizontal: 8,
        paddingVertical: 5,
        marginBottom: spacing.xs,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    drilldownBackText: {
        ...textStyles.caption,
        fontFamily: fontFamilies.sansBold,
        fontSize: 11,
        lineHeight: 14,
        letterSpacing: 0,
    },
    wordPartJoiner: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 13,
        lineHeight: 18,
    },
    wordPartItem: {
        minWidth: 68,
        maxWidth: 145,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 6,
        paddingHorizontal: 8,
        paddingVertical: 6,
        alignItems: 'center',
        gap: 2,
    },
    wordPartItemInteractive: {
        paddingRight: 5,
    },
    wordPartTextRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
    },
    wordPartText: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 14,
        lineHeight: 18,
        letterSpacing: 0,
        textAlign: 'center',
    },
    wordPartType: {
        ...textStyles.caption,
        fontFamily: fontFamilies.sans,
        fontSize: 10,
        lineHeight: 12,
        letterSpacing: 0,
        textAlign: 'center',
        textTransform: 'uppercase',
    },
    wordPartMeaning: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 11,
        lineHeight: 14,
        letterSpacing: 0,
        textAlign: 'center',
    },
    emptyDefinition: {
        ...textStyles.body,
        fontStyle: 'italic',
    },
    bookmarkButton: {
        width: 34,
        height: 34,
        borderRadius: 17,
        borderWidth: 0,
        alignItems: 'center',
        justifyContent: 'center',
    },
    translateButton: {
        width: 34,
        height: 34,
        borderRadius: 17,
        borderWidth: 0,
        alignItems: 'center',
        justifyContent: 'center',
    },
    extraList: {
        flexGrow: 0,
        maxHeight: 160,
        marginTop: 4,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    extraListContent: {
        paddingTop: 2,
        paddingBottom: 0,
    },
    extraDefinitionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        paddingVertical: spacing.xs,
    },
    extraDefinitionBody: {
        flex: 1,
        minWidth: 0,
        gap: 2,
    },
    extraWordLine: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.xs,
        flexWrap: 'wrap',
    },
    extraWord: {
        ...textStyles.body,
        fontFamily: fontFamilies.sansBold,
        fontSize: 14,
        lineHeight: 19,
    },
    extraHanja: {
        fontFamily: fontFamilies.krSerifMedium,
        fontSize: 12,
        lineHeight: 18,
    },
    extraMeta: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 11,
        lineHeight: 15,
    },
    extraDefinition: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 11,
        lineHeight: 16,
    },
    extraSaveButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    hanjaGroup: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        flexWrap: 'wrap',
    },
    entryHanjaGroup: {
        marginTop: 2,
    },
    extraHanjaGroup: {
        marginTop: 1,
    },
    hanjaToken: {
        alignItems: 'center',
        paddingHorizontal: 1,
        marginHorizontal: 1,
    },
    stateRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
    },
    stateText: {
        ...textStyles.body,
    },
    emptyState: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    emptyStateText: {
        ...textStyles.body,
        fontStyle: 'italic',
        textAlign: 'center',
    },
    notFoundScrollContent: {
        flexGrow: 1,
        paddingHorizontal: 24,
        gap: 6,
    },
    notFoundScrollContentCentered: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    notFoundScrollContentExplain: {
        justifyContent: 'flex-start',
        paddingTop: spacing.sm,
        paddingBottom: spacing.sm,
    },
    notFoundWord: {
        textAlign: 'center',
        alignSelf: 'stretch',
    },
    notFoundSubtext: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 20,
        textAlign: 'center',
    },
});

export default React.memo(DictionaryContent);
