import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Animated, BackHandler, Easing, PanResponder, ScrollView, View, StyleSheet, Text, TouchableOpacity, ActivityIndicator, Pressable, findNodeHandle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather, MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Slider } from 'react-native-elements';

import TopSection from '../components/Read/TopSection/TopSection';
import TocDrawer from '../components/Read/TocDrawer';
import FocusControls from '../components/Read/FocusControls';
import { useAppContext } from '../contexts/AppContext';
import { useLocalOwner } from '../contexts/LocalOwnerContext';
import { useTranslation } from '../hooks/useTranslation';
import NativeEpubReaderView, {
    sendFocusNavCommand,
    sendSeekToPosition,
    supportsImperativeFocusNav,
    supportsSeekToPosition,
} from '../modules/native-epub-reader/src/NativeEpubReaderView';
import {
    PREPROCESS_VERSION,
    deleteBookBookmark,
    deleteBookNote,
    getBookBookmarks,
    getBookNotes,
    getBookPreprocessChapter,
    getBookSavedWords,
    getBookWordCandidates,
    getCachedPKnown,
    applyExposureBatch,
    getProfileAbility,
    getSavedWords,
    insertBookBookmark,
    insertBookNote,
    insertCacheEntries,
    insertBookIndexEntries,
    insertData,
    logInteractionEvent,
    lookupBookHighlightSurfaces,
    lookupBookLevelSurfaces,
    lookupCacheByStems,
    markBookPreprocessChapter,
    markBookPreprocessMeta,
    recordVocabContext,
    recordVocabContextForSurface,
    scoreWordsForProfile,
    vocabEntryExists,
} from '../services/Database';
import { deriveCandidateReason, pickExampleSentence } from '../services/wordCandidates';
import { findActiveBookmark } from '../services/bookmarks';
import BeforeYouGoSheet from '../components/Read/BeforeYouGoSheet';
import SavedWordsPanel from '../components/Read/SavedWordsPanel';
import NotesLogSheet from '../components/Read/NotesLogSheet';
import { createTabBarBaseStyle } from '../components/shared/TabBar';
import preprocessChapter from '../services/api/preprocessChapter';
import { updateUserBookProgress } from '../services/bookCloudSync';
import { addReadingMillis } from '../services/dailyProgress';
import { countReadableTextWords, readEpubPackageXml } from '../services/epubMetadata';
import { readPdfPackageXml } from '../services/pdfMetadata';
import {
    isPublicDomainBookUri,
    readPublicDomainTextPackage,
} from '../services/publicDomainBooks';
import {
    fetchUserPreferences,
    getTimestampMs,
    updateUserPreferenceFields,
} from '../services/preferencesCloudSync';
import { isCurrentSyncGeneration } from '../services/localOwnerCoordinator';
import { requestUserDataSync } from '../services/userDataSyncQueue';
import {
    SUPPORTED_BOOK_LANGUAGES,
    normalizeBookLanguage,
    normalizeInterfaceLanguageCode,
} from '../constants/languages';
import {
    difficultyFromLevelRank,
    exposureDwellIsPlausible,
    levelUnderlineWeight,
    lowestUnderlinedRank,
    pKnown,
} from '../services/abilityModel';
import { createNativeReaderThemeTokens, radii, spacing, textStyles, useTheme } from '../theme';

const LOOKUP_HINT_DISMISSED_KEY = 'lookupHintDismissed';
const READER_SETTINGS_KEY = 'readerSettings';
const READER_SETTINGS_UPDATED_AT_KEY = 'readerSettingsUpdatedAt';
const DEFAULT_READER_SETTINGS = {
    fontSize: 18,
    isDarkMode: false,
    lineSpacing: 2.05,
    brightness: 0.62,
    focusSpan: 1,
    focusSwipe: false,
    readingMode: 'paged',
    levelMarkStyle: 'underline',
};
const READING_MODES = ['paged', 'scroll'];
// Whether graded words get a solid gradient underline. 'off' hides the marks but
// the model keeps learning from reading.
const LEVEL_MARK_STYLES = ['off', 'underline'];
const LEVEL_MARK_OPTIONS = [
    { value: 'off', icon: 'visibility-off', labelKey: 'read.markOff' },
    { value: 'underline', icon: 'format-underlined', labelKey: 'read.markUnderline' },
];
// Stable empty reference so toggling underlines off doesn't hand native a fresh
// array each render (which would churn the level matcher).
const EMPTY_LEVEL_TERMS = [];

// Number of segments in the legend gradient bar. Enough to read as continuous.
const LEGEND_GRADIENT_STEPS = 12;

// Parse "#rrggbb" → [r, g, b]; tolerant of a missing/short value (→ null so the
// caller can skip a broken stop rather than render black).
const parseHexColor = (hex) => {
    const match = /^#?([0-9a-f]{6})$/i.exec(typeof hex === 'string' ? hex.trim() : '');
    if (!match) {
        return null;
    }
    const int = parseInt(match[1], 16);
    return [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff];
};

const rgbToHex = ([r, g, b]) => `#${[r, g, b]
    .map((v) => Math.round(v).toString(16).padStart(2, '0'))
    .join('')}`;

const lerpRgb = (from, to, t) => from.map((c, i) => c + (to[i] - c) * t);

// Interpolate easy → mid → hard into LEGEND_GRADIENT_STEPS colors (mid at the
// centre), mirroring EpubPageView.applyLevelUnderlineShade so the legend and the
// page agree. Falls back to the raw stops if any hex fails to parse.
const buildLegendGradient = (easyHex, midHex, hardHex) => {
    const easy = parseHexColor(easyHex);
    const mid = parseHexColor(midHex);
    const hard = parseHexColor(hardHex);
    if (!easy || !mid || !hard) {
        return [easyHex, midHex, hardHex].filter(Boolean);
    }
    return Array.from({ length: LEGEND_GRADIENT_STEPS }, (_, i) => {
        const t = i / (LEGEND_GRADIENT_STEPS - 1);
        const rgb = t <= 0.5 ? lerpRgb(easy, mid, t / 0.5) : lerpRgb(mid, hard, (t - 0.5) / 0.5);
        return rgbToHex(rgb);
    });
};
const FONT_SIZE_MIN = 12;
const FONT_SIZE_MAX = 30;
const FOCUS_SPAN_MIN = 1;
const FOCUS_SPAN_MAX = 5;
// Focus mode emits a page event on every sentence step; persisting each one
// (screen state + library patch + AsyncStorage write) is what made beam
// navigation feel sluggish, so steps coalesce to the trailing event.
const FOCUS_PAGE_CHANGE_DEBOUNCE_MS = 400;

// ─── Exposure crediting ───────────────────────────────────────────────────────
// A graded word the reader was SHOWN and moved past without tapping is weak
// positive evidence that they knew it — the only read-mode signal that can push
// ability UP (lookups only ever push it down). Native decides what a "unit" is
// (a page, a focus span, or a scrolled-past block) and times the dwell; this
// screen applies the intent filters and the plausibility gate below, then batches.
//
// The dwell-plausibility gate (exposureDwellIsPlausible) lives in abilityModel.js
// so it's unit-tested alongside the exposure rate it feeds. Cap per unit so dense
// typesetting can't move ability further than sparse — a property of the layout,
// not of the reader.
const EXPOSURE_MAX_PER_UNIT = 5;
const LINE_SPACING_STEPS = [
    { value: 1.4, label: 'Compact' },
    { value: 1.65, label: 'Regular' },
    { value: 1.85, label: 'Open' },
    { value: 2.05, label: 'Relaxed' },
    { value: 2.3, label: 'Airy' },
    { value: 2.6, label: 'Wide' },
];
const BRIGHTNESS_MIN = 0.2;
const BRIGHTNESS_MAX = 1;
const BOOK_LEVEL_LABELS = {
    en: {
        1: 'A1',
        2: 'A2',
        3: 'B1',
        4: 'B2',
        5: 'C1',
        6: 'C2',
    },
    zh: {
        1: 'HSK 1',
        2: 'HSK 2',
        3: 'HSK 3',
        4: 'HSK 4',
        5: 'HSK 5',
        6: 'HSK 6',
        7: 'HSK 7',
    },
    ko: {
        1: '초급',
        2: '중급',
        3: '고급',
    },
};
const BOOK_LEVEL_SYSTEMS = {
    en: 'CEFR',
    zh: 'HSK',
    ko: 'NIKL',
};
const BOOK_LEVEL_PERCENTILE = 0.8;

const uniqTerms = (values) => [...new Set(
    (values || [])
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean)
)];

/**
 * buildLevelUnderlineTerms — turn the book's graded surfaces into the weighted
 * term list the native reader shades its underlines with.
 *
 * The weight is a position on the green→amber→red gradient derived from
 * P(known | theta, word difficulty), NOT from the user's self-reported band. A
 * word the model thinks you know is dropped entirely; the rest ramp from "nearly
 * known" to "well above you". Native owns the actual colors so the gradient can
 * follow the reader theme without a recompute here.
 *
 * Ambiguous surfaces (one surface, several stems) keep their HARDEST rank — the
 * conservative read, matching what the old rank-bucketed version did.
 */
const buildLevelUnderlineTerms = (rows, language, theta) => {
    if (!Number.isFinite(Number(theta))) {
        return [];
    }

    const surfaceRanks = new Map();
    (rows || []).forEach((row) => {
        const surface = typeof row?.surface === 'string' ? row.surface.trim() : '';
        const rank = Number(row?.level_rank ?? row?.proficiency_rank);
        if (!surface || !Number.isFinite(rank)) {
            return;
        }

        const previousRank = surfaceRanks.get(surface);
        if (!Number.isFinite(previousRank) || rank > previousRank) {
            surfaceRanks.set(surface, rank);
        }
    });

    // Difficulty depends only on the rank, and there are at most 7 ranks, so
    // memoize the per-rank weight instead of recomputing a sigmoid per surface.
    const weightByRank = new Map();
    const weightForRank = (rank) => {
        if (!weightByRank.has(rank)) {
            const difficulty = difficultyFromLevelRank(language, rank);
            weightByRank.set(rank, levelUnderlineWeight(pKnown(theta, difficulty)));
        }
        return weightByRank.get(rank);
    };

    const terms = [];
    surfaceRanks.forEach((rank, surface) => {
        const weight = weightForRank(rank);
        if (weight != null) {
            terms.push({ text: surface, weight });
        }
    });

    return terms;
};

const getBookLevelLabelForRank = (language, rank) => {
    const normalizedLanguage = normalizeBookLanguage(language);
    const numericRank = Number(rank);
    if (!Number.isFinite(numericRank)) {
        return null;
    }
    return BOOK_LEVEL_LABELS[normalizedLanguage]?.[numericRank] ?? String(numericRank);
};

const createBookLevelAccumulator = (language) => ({
    language: normalizeBookLanguage(language),
    sampleSize: 0,
    matchedCount: 0,
    unknownCount: 0,
    distribution: {},
});

const parseBookLevelStats = (stats) => {
    if (!stats) {
        return null;
    }
    if (typeof stats === 'object') {
        return stats;
    }
    if (typeof stats !== 'string') {
        return null;
    }
    try {
        return JSON.parse(stats);
    } catch (_error) {
        return null;
    }
};

const addBookLevelScoreToAccumulator = (accumulator, score) => {
    const parsedScore = parseBookLevelStats(score);
    if (!accumulator || !parsedScore) {
        return accumulator;
    }

    accumulator.sampleSize += Number(parsedScore.sample_size) || 0;
    accumulator.matchedCount += Number(parsedScore.matched_count) || 0;
    accumulator.unknownCount += Number(parsedScore.unknown_count) || 0;

    (parsedScore.distribution || []).forEach((entry) => {
        const rank = Number(entry?.rank);
        const count = Number(entry?.count);
        if (!Number.isFinite(rank) || !Number.isFinite(count) || count <= 0) {
            return;
        }
        accumulator.distribution[rank] = (accumulator.distribution[rank] || 0) + count;
    });

    return accumulator;
};

const addStoredBookLevelToAccumulator = (accumulator, row) => (
    addBookLevelScoreToAccumulator(accumulator, row?.book_level_stats)
);

const finalizeBookLevelAccumulator = (accumulator) => {
    if (!accumulator) {
        return null;
    }

    const sortedRanks = Object.keys(accumulator.distribution)
        .map((rank) => Number(rank))
        .filter((rank) => Number.isFinite(rank))
        .sort((a, b) => a - b);
    const matchedCount = accumulator.matchedCount;
    let estimatedRank = null;

    if (matchedCount > 0) {
        const threshold = Math.max(1, Math.ceil(matchedCount * BOOK_LEVEL_PERCENTILE));
        let running = 0;
        for (const rank of sortedRanks) {
            running += accumulator.distribution[rank] || 0;
            if (running >= threshold) {
                estimatedRank = rank;
                break;
            }
        }
    }

    const level = getBookLevelLabelForRank(accumulator.language, estimatedRank);
    return {
        language: accumulator.language,
        basis: 'vocabulary',
        method: '80th_percentile_known_vocab',
        note: 'Estimated from vocabulary only.',
        sample_size: accumulator.sampleSize,
        matched_count: matchedCount,
        unknown_count: accumulator.unknownCount,
        coverage: accumulator.sampleSize > 0
            ? Number((matchedCount / accumulator.sampleSize).toFixed(4))
            : 0,
        level_rank: estimatedRank,
        level,
        proficiency_system: BOOK_LEVEL_SYSTEMS[accumulator.language],
        proficiency_level: level,
        proficiency_rank: estimatedRank,
        distribution: sortedRanks.map((rank) => ({
            rank,
            level: getBookLevelLabelForRank(accumulator.language, rank),
            count: accumulator.distribution[rank],
        })),
    };
};

const clampProgress = (value) => {
    const progress = Number(value);
    if (!Number.isFinite(progress)) {
        return 0;
    }

    return Math.min(Math.max(progress, 0), 1);
};

const clampNumber = (value, min, max, fallback = min) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return fallback;
    }

    return Math.min(Math.max(numeric, min), max);
};

const nearestLineSpacingIndex = (value) => {
    const spacing = Number(value);
    if (!Number.isFinite(spacing)) {
        return LINE_SPACING_STEPS.findIndex((step) => step.value === DEFAULT_READER_SETTINGS.lineSpacing);
    }

    return LINE_SPACING_STEPS.reduce((closestIndex, step, index) => {
        const closestDelta = Math.abs(LINE_SPACING_STEPS[closestIndex].value - spacing);
        const currentDelta = Math.abs(step.value - spacing);
        return currentDelta < closestDelta ? index : closestIndex;
    }, 0);
};

const lineSpacingLabel = (value) => (
    LINE_SPACING_STEPS[nearestLineSpacingIndex(value)]?.label
    ?? LINE_SPACING_STEPS[nearestLineSpacingIndex(DEFAULT_READER_SETTINGS.lineSpacing)].label
);

const progressForBookPosition = (spineIndex, totalSpineItems, pageIndex = null, pagesInChapter = null) => {
    if (!Number.isInteger(spineIndex) || totalSpineItems <= 0) {
        return null;
    }

    const chapterProgress = (
        Number.isInteger(pageIndex)
        && Number.isInteger(pagesInChapter)
        && pagesInChapter > 0
    )
        ? Math.min(Math.max((pageIndex + 1) / pagesInChapter, 0), 1)
        : 0;

    return clampProgress((spineIndex + chapterProgress) / totalSpineItems);
};

const progressForChapterPosition = ({
    pageInChapter = null,
    pagesInChapter = null,
    activeSpineIndex = null,
    nativePosition = null,
    bookProgress = null,
    totalSpineItems = null,
}) => {
    if (
        Number.isInteger(pageInChapter)
        && Number.isInteger(pagesInChapter)
        && pagesInChapter > 0
    ) {
        return clampProgress(pageInChapter / pagesInChapter);
    }

    if (
        Number.isInteger(nativePosition?.pageIndex)
        && Number.isInteger(nativePosition?.pagesInChapter)
        && nativePosition.pagesInChapter > 0
        && (
            !Number.isInteger(nativePosition?.spineIndex)
            || !Number.isInteger(activeSpineIndex)
            || nativePosition.spineIndex === activeSpineIndex
        )
    ) {
        return clampProgress((nativePosition.pageIndex + 1) / nativePosition.pagesInChapter);
    }

    if (
        Number.isInteger(activeSpineIndex)
        && totalSpineItems > 0
        && typeof bookProgress === 'number'
    ) {
        const inferredChapterProgress = (bookProgress * totalSpineItems) - activeSpineIndex;
        if (inferredChapterProgress >= 0 && inferredChapterProgress <= 1) {
            return clampProgress(inferredChapterProgress);
        }
    }

    return 0;
};

const flattenTocItems = (items, depth = 0) => {
    if (!Array.isArray(items)) {
        return [];
    }

    return items.flatMap((item) => {
        const itemDepth = Number.isFinite(Number(item?.depth))
            ? Math.max(0, Number(item.depth))
            : depth;

        return [
            { ...item, depth: itemDepth },
            ...flattenTocItems(item?.subitems, itemDepth + 1),
        ];
    });
};

const titleForTocItem = (item) => (
    String(item?.title || item?.label || '').trim()
);

const titleForSpineItem = (item) => (
    String(item?.title || item?.label || '').trim()
);

const spineIndexForReaderPackage = (readerPackage) => {
    const spineIndex = readerPackage?.loadedSpineItem?.index
        ?? readerPackage?.bookManifest?.currentSpineIndex;

    return Number.isInteger(spineIndex) ? spineIndex : null;
};

const chapterBlocksForReaderPackage = (readerPackage) => (
    readerPackage?.loadedChapterBlocks
    || readerPackage?.firstChapterBlocks
    || []
);

const chapterResourcesForReaderPackage = (readerPackage) => (
    readerPackage?.loadedChapterResources
    || readerPackage?.firstChapterResources
    || []
);

const chapterTextForReaderPackage = (readerPackage) => (
    chapterBlocksForReaderPackage(readerPackage)
        .filter((block) => !block?.excludeFromText)
        .map((block) => (typeof block?.text === 'string' ? block.text : ''))
        .filter(Boolean)
        .join('\n')
);

const isPdfBook = (book, uri = '') => (
    String(book?.format || '').toLowerCase() === 'pdf'
    || String(uri || '').toLowerCase().split('?')[0].endsWith('.pdf')
);

const CHAPTER_PREPROCESS_RADIUS = 1;

const buildChapterPreprocessOrder = (centerSpineIndex, totalSpineItems) => {
    if (!Number.isInteger(centerSpineIndex) || totalSpineItems <= 0) {
        return [];
    }

    const order = [centerSpineIndex];
    for (let offset = 1; offset <= CHAPTER_PREPROCESS_RADIUS; offset += 1) {
        const nextSpineIndex = centerSpineIndex + offset;
        const previousSpineIndex = centerSpineIndex - offset;
        if (nextSpineIndex < totalSpineItems) {
            order.push(nextSpineIndex);
        }
        if (previousSpineIndex >= 0) {
            order.push(previousSpineIndex);
        }
    }

    return order;
};

const chapterWindowEntryForPackage = (readerPackage, role) => {
    const spineIndex = spineIndexForReaderPackage(readerPackage);
    const blocks = chapterBlocksForReaderPackage(readerPackage);

    if (!Number.isInteger(spineIndex) || !Array.isArray(blocks) || blocks.length === 0) {
        return null;
    }

    const loadedSpineItem = readerPackage?.loadedSpineItem || {};

    return {
        role,
        spineIndex,
        href: loadedSpineItem.href || readerPackage?.bookManifest?.currentSpineHref || '',
        path: loadedSpineItem.path || readerPackage?.bookManifest?.currentSpinePath || '',
        title: titleForSpineItem(loadedSpineItem),
        blocks,
        resources: chapterResourcesForReaderPackage(readerPackage),
    };
};

const Read = ({
    books,
    setBooks,
    currentBook: selectedCurrentBook,
    onPreprocessComplete,
    user,
    navigation,
    route,
}) => {
    const { t, language: interfaceLanguage } = useTranslation();
    const { targetLanguage, isDarkMode, setIsDarkMode } = useAppContext();
    const { colors: themeColors } = useTheme();
    const styles = useMemo(() => createStyles(themeColors), [themeColors]);
    const nativeReaderThemeTokens = useMemo(
        () => createNativeReaderThemeTokens(themeColors),
        [themeColors]
    );
    const { activeOwnerId, syncPaused, syncGeneration } = useLocalOwner();
    const [highlightedWord, setHighlightedWord] = useState('');
    const [highlightedWordContext, setHighlightedWordContext] = useState(null);
    const [isNativeSelection, setIsNativeSelection] = useState(false);
    const [lookupPlacement, setLookupPlacement] = useState('bottom');
    const [clearSelectionToken, setClearSelectionToken] = useState(0);
    // Temporary handoff QA toggles for the long-press translation banner.
    const [translationBannerLoadingPreview] = useState(false);
    const [translationBannerErrorPreview] = useState(false);
    const [translationBannerCopiedPreview] = useState(false);
    const [translationBannerTextPreview] = useState('');
    const [showLookupHint, setShowLookupHint] = useState(true);
    const [showMenu, setShowMenu] = useState(false);
    const [showBeforeYouGo, setShowBeforeYouGo] = useState(false);
    const [showSavedPanel, setShowSavedPanel] = useState(false);
    const [savedPanelTab, setSavedPanelTab] = useState('saved');
    const [bookSavedWords, setBookSavedWords] = useState([]);
    const [panelCandidates, setPanelCandidates] = useState([]);
    const [panelCandidatesLoading, setPanelCandidatesLoading] = useState(false);
    const [panelSavedStems, setPanelSavedStems] = useState(() => new Set());
    // (before-you-go is now note-only; candidates live in the saved-words panel)
    const [showNotesLog, setShowNotesLog] = useState(false);
    const [bookNotes, setBookNotes] = useState([]);
    const [bookBookmarks, setBookBookmarks] = useState([]);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [savedWords, setSavedWords] = useState(null); // null = not yet loaded
    const [highlightTerms, setHighlightTerms] = useState(null);
    const [optimisticHighlightTerms, setOptimisticHighlightTerms] = useState([]);
    const [levelUnderlineTerms, setLevelUnderlineTerms] = useState([]);
    const [highlightTermsReady, setHighlightTermsReady] = useState(false);
    const [readerLocationInfo, setReaderLocationInfo] = useState(null);
    const [toc, setToc] = useState([]);
    const [showToc, setShowToc] = useState(false);
    const [bookLoadState, setBookLoadState] = useState('idle');
    const [bookLoadError, setBookLoadError] = useState('');
    const [readerRetryKey, setReaderRetryKey] = useState(0);
    const [nativeReaderPackage, setNativeReaderPackage] = useState(null);
    const [nativeChapterWindow, setNativeChapterWindow] = useState([]);
    const [nativeRestorePosition, setNativeRestorePosition] = useState(null);
    const [currentSpineIndex, setCurrentSpineIndex] = useState(null);
    const [chapterTransitionDirection, setChapterTransitionDirection] = useState('none:0');

    // ── Focus (sentence beam) mode ───────────────────────────────────────────
    const [focusMode, setFocusMode] = useState(false);
    const [focusNavToken, setFocusNavToken] = useState('none:0');
    const [lookupPanelHeight, setLookupPanelHeight] = useState(0);
    // Focus info (sentence index/total) updates on every beam step. It is kept
    // in a ref and pushed to a single subscriber (FocusControls) instead of
    // screen state so beam navigation doesn't re-render the whole reader.
    const focusInfoRef = useRef({ index: 0, count: 1, total: 0 });
    const focusInfoListenerRef = useRef(null);
    const publishFocusInfo = useCallback((next) => {
        focusInfoRef.current = next;
        focusInfoListenerRef.current?.(next);
    }, []);
    const subscribeFocusInfo = useCallback((listener) => {
        focusInfoListenerRef.current = listener;
        listener(focusInfoRef.current);
        return () => {
            if (focusInfoListenerRef.current === listener) {
                focusInfoListenerRef.current = null;
            }
        };
    }, []);
    const focusNavCounterRef = useRef(0);
    const nativeReaderViewRef = useRef(null);
    // In focus mode, page events arrive on every sentence step; they are
    // coalesced so only the trailing event is persisted (see
    // handleNativePageChange). The processor is captured alongside the event
    // so a flush that happens after a book or mode switch still patches the
    // book the event came from.
    const pendingFocusPageChangeRef = useRef(null);
    const focusPageChangeTimeoutRef = useRef(null);
    const flushPendingFocusPageChange = useCallback(() => {
        if (focusPageChangeTimeoutRef.current) {
            clearTimeout(focusPageChangeTimeoutRef.current);
            focusPageChangeTimeoutRef.current = null;
        }
        const pending = pendingFocusPageChangeRef.current;
        pendingFocusPageChangeRef.current = null;
        if (pending) {
            pending.process(pending.event);
        }
    }, []);
    // Flush (don't drop) any pending step when the reader unmounts so the last
    // position still lands in the library.
    useEffect(() => flushPendingFocusPageChange, [flushPendingFocusPageChange]);
    const focusControlsTranslate = useRef(new Animated.Value(0)).current;
    const focusSwipeKnobAnim = useRef(new Animated.Value(0)).current;

    // ── Preprocessing state ──────────────────────────────────────────────────
    // 'idle'         — no preprocessing requested
    // 'checking'     — querying local DB to see if this book is already cached
    // 'preprocessing'— backend call in progress
    // 'retrying'     — network error, waiting to retry
    // 'done'         — book is fully preprocessed and cached locally
    // 'error'        — failed after all retries (non-fatal, live API still works)
    const [preprocessStatus, setPreprocessStatus] = useState('idle');

    // Stores full extracted text for legacy reader paths; chapter preprocessing
    // uses the current native reader package instead.
    const extractedTextRef = useRef(null);
    const preprocessingInFlightRef = useRef(false);
    const chapterPreprocessTokenRef = useRef(0);
    const activeChapterPreprocessRef = useRef({ bookUri: null, centerSpineIndex: null });
    const readingSessionStartedAtRef = useRef(Date.now());
    const readingSessionOwnerIdRef = useRef(activeOwnerId);
    const chapterLoadTokenRef = useRef(0);
    const nativeReaderPackageRef = useRef(null);
    const nativeRestorePositionRef = useRef(null);
    const currentSpineIndexRef = useRef(null);
    // Surfaces looked up recently, to exclude from exposure crediting: a lookup is
    // its own (stronger, negative) evidence, so the same word must not also be
    // credited as a skip. Cleared each time native closes an exposure unit.
    const recentLookupsRef = useRef(new Set());
    // Gradient weights of the current underline snapshot, keyed by surface. Used
    // to rank exposure candidates by how uncertain the model is about them.
    const levelUnderlineWeightsRef = useRef(new Map());
    // Saved words are excluded from exposure: they're already in the SRS loop and
    // earn graded evidence in Learn, so crediting them again through a far noisier
    // channel would double-count them.
    const savedSurfacesRef = useRef(new Set());
    const bookCompletionInProgressRef = useRef(false);
    const parsedChapterCacheRef = useRef(new Map());
    const parsedChapterInflightRef = useRef(new Map());
    const chapterPrefetchTokenRef = useRef(0);
    const cloudProgressSyncTimeoutRef = useRef(null);
    const cloudReaderSettingsSyncTimeoutRef = useRef(null);
    const readerSettingsCloudUserRef = useRef(null);
    const readerSettingsUpdatedAtRef = useRef(null);
    const readerSettingsRef = useRef(DEFAULT_READER_SETTINGS);
    const loadNativeReaderPackageRef = useRef(null);
    // Monotonic counter stamped onto a restorePosition that represents a
    // deliberate jump; see handleSelectBookmark.
    const seekTokenRef = useRef(0);
    const updateNativeRestorePosition = useCallback((position) => {
        nativeRestorePositionRef.current = position;
        setNativeRestorePosition(position);
    }, []);
    const selectedBook = books.find(book => book.uri === selectedCurrentBook) ?? null;
    const selectedBookLanguage = normalizeBookLanguage(selectedBook?.language ?? 'ko');
    // Book-driven: any book in a language we can look up opens with *its own*
    // dictionary, regardless of the learner's current target language. The
    // dictionary/segmentation/level pipeline is keyed on activeBookLanguage below.
    const activeBook = selectedBook && SUPPORTED_BOOK_LANGUAGES.includes(selectedBookLanguage)
        ? selectedBook
        : null;
    const currentBook = activeBook?.uri ?? null;
    const activeBookLanguage = activeBook ? selectedBookLanguage : targetLanguage;
    const shouldUseHeuristicHighlights = !activeBook?.preprocessed;
    const translationBannerVisualState = useMemo(() => ({
        loading: translationBannerLoadingPreview,
        error: translationBannerErrorPreview,
        copied: translationBannerCopiedPreview,
        translatedText: translationBannerTextPreview,
        errorMessage: t('lookup.noTranslation'),
    }), [
        t,
        translationBannerCopiedPreview,
        translationBannerErrorPreview,
        translationBannerLoadingPreview,
        translationBannerTextPreview,
    ]);

    // Load saved words for highlighting on mount
    useEffect(() => {
        getSavedWords({ ownerId: activeOwnerId, language: activeBookLanguage })
            .then(words => {
                setSavedWords(words);
            })
            .catch(err => {
                console.error('[Read] Failed to load saved words:', err);
                setSavedWords([]);
            });
    }, [activeBookLanguage, activeOwnerId]);

    // Words saved from *this* book — drives the top-bar count pill and the saved
    // panel's "Saved" tab. Refreshed on mount and after every save.
    const refreshBookSavedWords = useCallback(async () => {
        if (!currentBook) {
            setBookSavedWords([]);
            return;
        }
        try {
            const rows = await getBookSavedWords({
                ownerId: activeOwnerId,
                language: activeBookLanguage,
                bookUri: currentBook,
            });
            setBookSavedWords(rows);
        } catch (error) {
            console.warn('[Read] Failed to load book saved words:', error?.message ?? error);
        }
    }, [activeOwnerId, activeBookLanguage, currentBook]);

    useEffect(() => {
        refreshBookSavedWords();
    }, [refreshBookSavedWords]);

    useEffect(() => {
        if (savedWords === null) {
            setHighlightTermsReady(false);
            return;
        }

        if (!currentBook) {
            setHighlightTerms(savedWords);
            setHighlightTermsReady(true);
            return;
        }

        // Even when the book isn't fully preprocessed yet, expand saved words
        // into whatever in-book surface forms have already been indexed. A saved
        // lemma otherwise only highlights where its bare form literally appears,
        // so inflected occurrences ("먹었다" for saved "먹다") silently go
        // unhighlighted — the "sometimes not highlighted" case. We still don't
        // block the reader on this in heuristic mode (see
        // isReaderWaitingForHighlights); it upgrades in place once surfaces load.

        let isActive = true;

        const loadHighlightTerms = async () => {
            try {
                const surfaceRows = await lookupBookHighlightSurfaces(activeOwnerId, currentBook, savedWords, {
                    language: activeBookLanguage,
                    interfaceLanguage,
                });
                if (!isActive) {
                    return;
                }

                const mergedTerms = [...new Set([
                    ...savedWords,
                    ...surfaceRows.map((row) => row.surface).filter(Boolean),
                ])];

                setHighlightTerms(mergedTerms);
                setHighlightTermsReady(true);
            } catch (error) {
                console.error('[Read] Failed to load book highlight surfaces:', error);
                if (isActive) {
                    setHighlightTerms(savedWords);
                    setHighlightTermsReady(true);
                }
            }
        };

        loadHighlightTerms();

        return () => {
            isActive = false;
        };
    }, [
        activeBookLanguage,
        activeOwnerId,
        currentBook,
        interfaceLanguage,
        preprocessStatus,
        savedWords,
        shouldUseHeuristicHighlights,
    ]);

    // Level underlines are a per-chapter SNAPSHOT of the ability model, not a live
    // readout. `theta` moves on every lookup, and re-shading mid-page would mean a
    // word three lines down silently changing color while you read — unsettling,
    // and it undermines trust in the marks. So this deliberately keys off the book
    // and the committed spine index (reader open + chapter boundary) and reads
    // theta fresh INSIDE the effect rather than depending on it.
    useEffect(() => {
        if (!currentBook) {
            setLevelUnderlineTerms([]);
            return;
        }

        let isActive = true;

        const loadLevelUnderlineTerms = async () => {
            const ability = await getProfileAbility({
                ownerId: activeOwnerId,
                language: activeBookLanguage,
            });

            // No behavioral history yet → start from a neutral ability estimate
            // and let reading move it. (Level is no longer self-reported.)
            let theta = Number(ability?.theta);
            if (!Number.isFinite(theta)) {
                theta = 0;
            }

            // Prune SQL-side to the bands that can actually earn an underline at
            // this ability, so an easy book doesn't ship its whole vocabulary
            // across the bridge just to be dropped here.
            const floorRank = lowestUnderlinedRank(activeBookLanguage, theta);
            if (floorRank == null) {
                return [];
            }

            const rows = await lookupBookLevelSurfaces(activeOwnerId, currentBook, floorRank, {
                language: activeBookLanguage,
            });
            return buildLevelUnderlineTerms(rows, activeBookLanguage, theta);
        };

        loadLevelUnderlineTerms().then((terms) => {
            if (isActive) {
                setLevelUnderlineTerms(terms);
            }
        }).catch((error) => {
            console.error('[Read] Failed to load book level underline surfaces:', error);
            if (isActive) {
                setLevelUnderlineTerms([]);
            }
        });

        return () => {
            isActive = false;
        };
    }, [
        activeBookLanguage,
        activeBook?.preprocessed,
        activeOwnerId,
        currentBook,
        currentSpineIndex,
        preprocessStatus,
    ]);

    // Reset status and clear stored text whenever the open book changes
    useEffect(() => {
        const elapsed = Date.now() - readingSessionStartedAtRef.current;
        const sessionOwnerId = readingSessionOwnerIdRef.current || activeOwnerId;
        if (elapsed >= 5000) {
            addReadingMillis(sessionOwnerId, elapsed);
        }

        // A coalesced focus-mode step captured its own processor (closing over
        // the previous book), so flushing here still records the position the
        // reader left off at before the switch resets everything below.
        flushPendingFocusPageChange();

        setPreprocessStatus('idle');
        extractedTextRef.current = null;
        preprocessingInFlightRef.current = false;
        activeChapterPreprocessRef.current = { bookUri: null, centerSpineIndex: null };
        chapterPreprocessTokenRef.current += 1;
        readingSessionStartedAtRef.current = Date.now();
        setHighlightedWord('');
        setHighlightedWordContext(null);
        setIsNativeSelection(false);
        setLookupPlacement('bottom');
        setClearSelectionToken((value) => value + 1);
        setHighlightTerms(null);
        setOptimisticHighlightTerms([]);
        setHighlightTermsReady(savedWords !== null && !currentBook);
        setBookLoadState(currentBook ? 'loading' : 'idle');
        setBookLoadError('');
        setShowMenu(false);
        setIsFullscreen(false);
        setReaderRetryKey(0);
        setNativeReaderPackage(null);
        setNativeChapterWindow([]);
        updateNativeRestorePosition(null);
        nativeReaderPackageRef.current = null;
        bookCompletionInProgressRef.current = false;
        setCurrentSpineIndex(null);
        currentSpineIndexRef.current = null;
        setChapterTransitionDirection('none:0');
        chapterLoadTokenRef.current += 1;
        chapterPrefetchTokenRef.current += 1;
        readingSessionOwnerIdRef.current = activeOwnerId;
        parsedChapterCacheRef.current = new Map();
        parsedChapterInflightRef.current = new Map();
        setToc([]);
        setShowToc(false);
        publishFocusInfo({ index: 0, count: 1, total: 0 });
        setFocusNavToken('none:0');
        focusNavCounterRef.current = 0;
    }, [activeOwnerId, currentBook, updateNativeRestorePosition, publishFocusInfo, flushPendingFocusPageChange]);

    useEffect(() => {
        return () => {
            const elapsed = Date.now() - readingSessionStartedAtRef.current;
            const sessionOwnerId = readingSessionOwnerIdRef.current || activeOwnerId;
            if (elapsed >= 5000) {
                addReadingMillis(sessionOwnerId, elapsed);
            }
            if (cloudProgressSyncTimeoutRef.current) {
                clearTimeout(cloudProgressSyncTimeoutRef.current);
            }
            if (cloudReaderSettingsSyncTimeoutRef.current) {
                clearTimeout(cloudReaderSettingsSyncTimeoutRef.current);
            }
        };
    }, []);

    const scheduleCloudProgressSync = useCallback((book) => {
        if (
            !user?.id
            || !book?.cloudId
            || syncPaused
            || activeOwnerId !== user.id
            || !isCurrentSyncGeneration(syncGeneration)
        ) {
            return;
        }

        const ownerId = activeOwnerId;
        const generation = syncGeneration;
        if (cloudProgressSyncTimeoutRef.current) {
            clearTimeout(cloudProgressSyncTimeoutRef.current);
        }

        cloudProgressSyncTimeoutRef.current = setTimeout(() => {
            if (!isCurrentSyncGeneration(generation)) {
                return;
            }

            updateUserBookProgress({
                user,
                ownerId,
                generation,
                book,
            }).catch((error) => {
                console.warn('[Read] Cloud progress sync failed:', error);
            });
        }, 3000);
    }, [activeOwnerId, syncGeneration, syncPaused, user]);

    const handleWordSave = useCallback((word, options = {}) => {
        const { includeSurface = true } = options;
        const surface = includeSurface ? highlightedWord?.trim() : '';
        setSavedWords(prev => uniqTerms([...(prev ?? []), word]));
        setOptimisticHighlightTerms((prev) => {
            return uniqTerms([
                ...prev,
                word,
                ...(surface ? [surface] : []),
            ]);
        });
        setClearSelectionToken((value) => value + 1);
    }, [highlightedWord]);

    const handleWordUnsave = useCallback((word, options = {}) => {
        const { includeSurface = true } = options;
        const surface = includeSurface ? highlightedWord?.trim() : '';
        setSavedWords(prev => (prev ?? []).filter(w => w !== word));
        setOptimisticHighlightTerms(prev => prev.filter(term => term !== word && term !== surface));
    }, [highlightedWord]);

    // Refs let the native selection callbacks read the latest panel/focus state
    // without being re-created (which would churn the native view's props).
    const lookupOpenRef = useRef(false);
    const focusModeRef = useRef(false);
    useEffect(() => {
        lookupOpenRef.current = !!highlightedWord;
    }, [highlightedWord]);
    useEffect(() => {
        focusModeRef.current = focusMode;
    }, [focusMode]);

    const handleNativeWordSelected = useCallback((event = {}) => {
        const text = typeof event.text === 'string' ? event.text.trim() : '';
        if (!text) {
            return;
        }

        // A word tap while a lookup panel is already open should only dismiss the
        // panel — not register the tapped word as a new selection. Tapping empty
        // space already routes through onSelectionCleared, and native text
        // selections clear themselves, so this closes the last remaining gap.
        // Focus mode normally suppresses this natively (the tap never reaches
        // JS); this also catches a tap that lands before the native view has
        // learned the panel opened.
        if (lookupOpenRef.current) {
            dismissPanelRef.current?.();
            return;
        }

        const sentence = typeof event.sentence === 'string' ? event.sentence.trim() : '';

        // Looking a word up is its own (much stronger) evidence, so this word must
        // not also be credited as a skip when the current exposure unit closes.
        recentLookupsRef.current.add(text);

        setIsNativeSelection(false);
        setHighlightedWord(text);
        setHighlightedWordContext({
            sentence,
        });
        setLookupPlacement(event.placement === 'top' ? 'top' : 'bottom');

        recordVocabContextForSurface({
            ownerId: activeOwnerId,
            surface: text,
            sentence,
            sourceBookUri: currentBook,
            sourceBookTitle: activeBook?.title ?? null,
            language: activeBookLanguage,
        }).then((context) => {
            if (context) {
                requestUserDataSync('reader-selected-vocab-context');
            }
        }).catch((error) => {
            console.warn('[Read] Failed to record vocab context:', error?.message ?? error);
        });
    }, [activeBook?.title, activeBookLanguage, activeOwnerId, currentBook]);

    const handleNativeSelectionCleared = useCallback(() => {
        setHighlightedWord('');
        setHighlightedWordContext(null);
        setIsNativeSelection(false);
    }, []);

    const dismissPanelRef = useRef(null);
    dismissPanelRef.current = () => {
        setHighlightedWord('');
        setHighlightedWordContext(null);
        setIsNativeSelection(false);
        setClearSelectionToken((v) => v + 1);
    };

    const handleNativeTextSelected = useCallback((event = {}) => {
        const text = typeof event.text === 'string' ? event.text.trim() : '';
        if (!text) {
            return;
        }

        setIsNativeSelection(true);
        setHighlightedWord(text);
        setHighlightedWordContext(null);
        setLookupPlacement(event.placement === 'top' ? 'top' : 'bottom');
    }, []);

    // ── Book text extraction callback ────────────────────────────────────────
    // Always stores the text so it's available for older reader paths. The
    // native reader chapter queue drives preprocessing for the current flow.
    const handleBookTextExtracted = useCallback((text) => {
        if (!text) {
            console.warn('[Read] Received empty book text — extraction may have failed');
            return;
        }
        extractedTextRef.current = text;
    }, []);

    useEffect(() => {
        if (preprocessStatus !== 'done') {
            return undefined;
        }

        const timeout = setTimeout(() => {
            setPreprocessStatus('idle');
        }, 4000);

        return () => clearTimeout(timeout);
    }, [preprocessStatus]);

    // ── Settings ─────────────────────────────────────────────────────────────
    const [settings, setSettings] = useState(DEFAULT_READER_SETTINGS);
    const [readerSettingsLoaded, setReaderSettingsLoaded] = useState(false);
    const insets = useSafeAreaInsets();

    useEffect(() => {
        loadSettings();
    }, []);

    useEffect(() => {
        readerSettingsRef.current = settings;
    }, [settings]);

    useEffect(() => {
        const loadLookupHintDismissed = async () => {
            try {
                const dismissed = await AsyncStorage.getItem(LOOKUP_HINT_DISMISSED_KEY);
                setShowLookupHint(dismissed !== 'true');
            } catch (error) {
                console.error('[Read] Error loading lookup hint state:', error);
            }
        };

        loadLookupHintDismissed();
    }, []);

    const scheduleCloudReaderSettingsSync = useCallback((nextSettings, updatedAt = new Date().toISOString()) => {
        if (
            !user?.id
            || syncPaused
            || activeOwnerId !== user.id
            || !isCurrentSyncGeneration(syncGeneration)
        ) {
            return;
        }

        const ownerId = activeOwnerId;
        const generation = syncGeneration;
        if (cloudReaderSettingsSyncTimeoutRef.current) {
            clearTimeout(cloudReaderSettingsSyncTimeoutRef.current);
        }

        cloudReaderSettingsSyncTimeoutRef.current = setTimeout(() => {
            if (!isCurrentSyncGeneration(generation)) {
                return;
            }

            updateUserPreferenceFields({
                user,
                ownerId,
                generation,
                patch: {
                    reader_settings: {
                        ...nextSettings,
                        updatedAt,
                    },
                    updated_at: updatedAt,
                },
            }).catch((error) => {
                console.warn('[Read] Failed to sync reader settings:', error?.message ?? error);
            });
        }, 2500);
    }, [activeOwnerId, syncGeneration, syncPaused, user]);

    const loadSettings = async () => {
        try {
            const [savedSettings, savedUpdatedAt] = await Promise.all([
                AsyncStorage.getItem(READER_SETTINGS_KEY),
                AsyncStorage.getItem(READER_SETTINGS_UPDATED_AT_KEY),
            ]);
            if (savedSettings) {
                const parsedSettings = JSON.parse(savedSettings);
                if (typeof parsedSettings?.isDarkMode === 'boolean') {
                    setIsDarkMode(parsedSettings.isDarkMode);
                }
                const nextSettings = {
                    ...DEFAULT_READER_SETTINGS,
                    ...parsedSettings,
                    isDarkMode: typeof parsedSettings?.isDarkMode === 'boolean'
                        ? parsedSettings.isDarkMode
                        : isDarkMode,
                };
                readerSettingsRef.current = nextSettings;
                setSettings(nextSettings);
            }
            readerSettingsUpdatedAtRef.current = savedUpdatedAt ?? null;
        } catch (error) {
            console.error('[Read] Error loading settings:', error);
        } finally {
            setReaderSettingsLoaded(true);
        }
    };

    const saveSettings = async (newSettings, updatedAt = new Date().toISOString(), options = {}) => {
        const { syncCloud = true } = options;
        try {
            readerSettingsUpdatedAtRef.current = updatedAt;
            await Promise.all([
                AsyncStorage.setItem(READER_SETTINGS_KEY, JSON.stringify(newSettings)),
                AsyncStorage.setItem(READER_SETTINGS_UPDATED_AT_KEY, updatedAt),
            ]);
            if (syncCloud) {
                scheduleCloudReaderSettingsSync(newSettings, updatedAt);
            }
        } catch (error) {
            console.error('[Read] Error saving settings:', error);
        }
    };

    useEffect(() => {
        if (!readerSettingsLoaded) {
            return;
        }

        if (!user?.id) {
            readerSettingsCloudUserRef.current = null;
            return;
        }

        if (
            syncPaused
            || activeOwnerId !== user.id
            || !isCurrentSyncGeneration(syncGeneration)
        ) {
            readerSettingsCloudUserRef.current = null;
            return;
        }

        if (readerSettingsCloudUserRef.current === user.id) {
            return;
        }

        let isMounted = true;
        readerSettingsCloudUserRef.current = user.id;
        const ownerId = activeOwnerId;
        const generation = syncGeneration;

        const mergeCloudReaderSettings = async () => {
            try {
                const cloudPreferences = await fetchUserPreferences(user.id);
                if (!isMounted || !isCurrentSyncGeneration(generation)) {
                    return;
                }
                const cloudReaderSettings = cloudPreferences?.reader_settings;
                const hasCloudSettings = cloudReaderSettings
                    && typeof cloudReaderSettings === 'object'
                    && !Array.isArray(cloudReaderSettings)
                    && Object.keys(cloudReaderSettings).length > 0;

                const cloudUpdatedAt = cloudReaderSettings?.updatedAt
                    ?? cloudReaderSettings?.updated_at
                    ?? cloudPreferences?.updated_at
                    ?? null;
                const localUpdatedAt = readerSettingsUpdatedAtRef.current;

                if (hasCloudSettings && getTimestampMs(cloudUpdatedAt) > getTimestampMs(localUpdatedAt)) {
                    const nextSettings = {
                        ...DEFAULT_READER_SETTINGS,
                        ...cloudReaderSettings,
                    };
                    delete nextSettings.updatedAt;
                    delete nextSettings.updated_at;
                    if (typeof nextSettings.isDarkMode === 'boolean') {
                        setIsDarkMode(nextSettings.isDarkMode);
                    } else {
                        nextSettings.isDarkMode = isDarkMode;
                    }

                    if (!isMounted) {
                        return;
                    }

                    readerSettingsRef.current = nextSettings;
                    setSettings(nextSettings);
                    await saveSettings(nextSettings, cloudUpdatedAt, { syncCloud: false });
                    return;
                }

                const updatedAt = localUpdatedAt ?? new Date().toISOString();
                await updateUserPreferenceFields({
                    user,
                    ownerId,
                    generation,
                    patch: {
                        reader_settings: {
                            ...readerSettingsRef.current,
                            updatedAt,
                        },
                        updated_at: updatedAt,
                    },
                });
            } catch (error) {
                readerSettingsCloudUserRef.current = null;
                console.warn('[Read] Failed to merge cloud reader settings:', error?.message ?? error);
            }
        };

        mergeCloudReaderSettings();

        return () => {
            isMounted = false;
        };
    }, [activeOwnerId, isDarkMode, readerSettingsLoaded, saveSettings, setIsDarkMode, syncGeneration, syncPaused, user]);

    const updateSettings = (patch) => {
        if ('isDarkMode' in patch) {
            setIsDarkMode(patch.isDarkMode);
        }
        const newSettings = {
            ...settings,
            isDarkMode,
            ...patch,
        };
        setHighlightedWord('');
        setHighlightedWordContext(null);
        setIsNativeSelection(false);
        setClearSelectionToken((current) => current + 1);
        setSettings(newSettings);
        readerSettingsRef.current = newSettings;
        saveSettings(newSettings);
    };

    const handleSettingChange = (key, value) => {
        updateSettings({ [key]: value });
    };

    const resetBookSettings = () => {
        updateSettings({
            fontSize: DEFAULT_READER_SETTINGS.fontSize,
            lineSpacing: DEFAULT_READER_SETTINGS.lineSpacing,
            brightness: DEFAULT_READER_SETTINGS.brightness,
            readingMode: DEFAULT_READER_SETTINGS.readingMode,
            levelMarkStyle: DEFAULT_READER_SETTINGS.levelMarkStyle,
        });
    };

    const resetFocusSettings = () => {
        updateSettings({
            focusSwipe: DEFAULT_READER_SETTINGS.focusSwipe,
            focusSpan: DEFAULT_READER_SETTINGS.focusSpan,
        });
    };

    // Hide the bottom tab bar whenever the reader is fullscreen; restore the
    // themed base style otherwise.
    useEffect(() => {
        navigation?.setOptions?.({
            tabBarStyle: isFullscreen
                ? { display: 'none' }
                : createTabBarBaseStyle(themeColors),
        });
    }, [isFullscreen, navigation, themeColors]);

    // Leaving the reader should never strand the tab bar in a hidden state.
    useEffect(() => {
        const unsubscribeBlur = navigation?.addListener?.('blur', () => {
            setIsFullscreen(false);
        });
        return () => {
            unsubscribeBlur?.();
        };
    }, [navigation]);

    const dismissLookup = useCallback(() => {
        setHighlightedWord('');
        setHighlightedWordContext(null);
        setIsNativeSelection(false);
        setClearSelectionToken((value) => value + 1);
    }, []);

    // Hardware back steps out of transient reader chrome one layer at a time:
    // the options dropdown, then the open lookup panel, then fullscreen. Focus
    // mode is deliberately NOT unwound here — from focus mode back leaves the
    // reader like any other read view, and when focus mode is also fullscreen
    // back only drops fullscreen (leaving focus mode intact). Only registers
    // when one of those layers is active so normal back behaviour is untouched
    // otherwise.
    useEffect(() => {
        if (!showMenu && !highlightedWord && !isFullscreen) {
            return undefined;
        }
        const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
            if (showMenu) {
                setShowMenu(false);
                return true;
            }
            if (highlightedWord) {
                dismissLookup();
                return true;
            }
            if (isFullscreen) {
                setIsFullscreen(false);
                return true;
            }
            return false;
        });
        return () => subscription.remove();
    }, [showMenu, isFullscreen, highlightedWord, dismissLookup]);

    // Swipe-down anywhere on the lookup panel dismisses it (mirrors the hardware
    // back / close-button paths). Only claims clearly downward drags so it doesn't
    // fight scrolling inside the panel.
    const lookupPanResponder = useMemo(() => PanResponder.create({
        onMoveShouldSetPanResponder: (_evt, gesture) => (
            gesture.dy > 14 && gesture.dy > Math.abs(gesture.dx)
        ),
        onPanResponderRelease: (_evt, gesture) => {
            if (gesture.dy > 40) {
                dismissLookup();
            }
        },
        onPanResponderTerminationRequest: () => true,
    }), [dismissLookup]);

    useEffect(() => {
        setSettings((current) => {
            if (current.isDarkMode === isDarkMode) {
                return current;
            }
            const nextSettings = {
                ...current,
                isDarkMode,
            };
            readerSettingsRef.current = nextSettings;
            return nextSettings;
        });
    }, [isDarkMode]);

    const dismissLookupHint = useCallback(async () => {
        setShowLookupHint(false);
        try {
            await AsyncStorage.setItem(LOOKUP_HINT_DISMISSED_KEY, 'true');
        } catch (error) {
            console.error('[Read] Error saving lookup hint state:', error);
        }
    }, []);

    const activeBookSizeMb = typeof activeBook?.size === 'number'
        ? activeBook.size / (1024 * 1024)
        : null;
    const savedWordsList = useMemo(() => savedWords ?? [], [savedWords]);
    const readerHighlightTerms = useMemo(() => {
        const dbReaderHighlightTerms = highlightTerms ?? savedWordsList;
        return uniqTerms([
            ...dbReaderHighlightTerms,
            ...optimisticHighlightTerms,
        ]);
    }, [savedWordsList, highlightTerms, optimisticHighlightTerms]);
    savedSurfacesRef.current = useMemo(
        () => new Set(readerHighlightTerms),
        [readerHighlightTerms]
    );
    levelUnderlineWeightsRef.current = useMemo(
        () => new Map(levelUnderlineTerms.map(({ text, weight }) => [text, weight])),
        [levelUnderlineTerms]
    );
    const isReaderWaitingForHighlights = !!currentBook && !shouldUseHeuristicHighlights && !highlightTermsReady;
    const nativeChapterBlocks = chapterBlocksForReaderPackage(nativeReaderPackage);
    const nativeChapterResources = chapterResourcesForReaderPackage(nativeReaderPackage);
    const nativeChapterTotal = nativeReaderPackage?.spine?.length ?? 0;
    const flattenedToc = useMemo(() => flattenTocItems(toc), [toc]);
    const activeSpineIndex = Number.isInteger(currentSpineIndex)
        ? currentSpineIndex
        : spineIndexForReaderPackage(nativeReaderPackage);
    const activeChapterTitle = useMemo(() => {
        const fallbackTitle = Number.isInteger(activeSpineIndex)
            ? `${t('read.chapter')} ${activeSpineIndex + 1}`
            : t('read.defaultTitle');

        if (Number.isInteger(activeSpineIndex) && flattenedToc.length > 0) {
            const tocItem = flattenedToc.reduce((activeItem, item) => {
                if (
                    item?.disabled
                    || !Number.isInteger(item?.spineIndex)
                    || item.spineIndex > activeSpineIndex
                ) {
                    return activeItem;
                }

                return item;
            }, null);
            const tocTitle = titleForTocItem(tocItem);
            if (tocTitle) {
                return tocTitle;
            }
        }

        return titleForSpineItem(nativeReaderPackage?.loadedSpineItem) || fallbackTitle;
    }, [activeSpineIndex, flattenedToc, nativeReaderPackage?.loadedSpineItem, t]);
    const headerBookTitle = (
        activeBook?.title
        || nativeReaderPackage?.metadata?.title
        || nativeReaderPackage?.bookManifest?.title
        || t('read.defaultTitle')
    );
    // Memoized so a new object reference isn't serialized across the native
    // bridge on every render (e.g. every focus-mode sentence step).
    const nativeBookManifest = useMemo(() => ({
        ...(nativeReaderPackage?.bookManifest ?? {}),
        chapterTransitionDirection,
        currentChapterTitle: activeChapterTitle,
        currentSpineTitle: activeChapterTitle,
        currentBookTitle: headerBookTitle,
    }), [nativeReaderPackage?.bookManifest, chapterTransitionDirection, activeChapterTitle, headerBookTitle]);
    const bookProgress = clampProgress(
        typeof readerLocationInfo?.percentage === 'number'
            ? readerLocationInfo.percentage
            : activeBook?.progress
    );
    const chapterProgress = progressForChapterPosition({
        pageInChapter: readerLocationInfo?.pageInChapter,
        pagesInChapter: readerLocationInfo?.pagesInChapter,
        activeSpineIndex,
        nativePosition: nativeRestorePosition || activeBook?.nativePosition,
        bookProgress,
        totalSpineItems: nativeChapterTotal,
    });
    const progressPercent = Math.round(chapterProgress * 100);
    const progressLabel = `${progressPercent}%`;
    const progressFillWidth = `${progressPercent}%`;
    const chapterIndexLabel = Number.isInteger(activeSpineIndex)
        ? `${t('read.chapter')} ${activeSpineIndex + 1}`
        : t('read.defaultTitle');
    // ─── Note-to-self panel ──────────────────────────────────────────────────
    // Reached by long-pressing the header bookmark icon. Saving keeps the book
    // open; the note lands in the checkpoints sheet alongside bookmarks.
    const openBeforeYouGo = useCallback(() => {
        setShowMenu(false);
        setShowBeforeYouGo(true);
    }, []);

    // Open the saved-words tracker panel. Refreshes the saved list and loads the
    // full ranked candidate set (not the daily-rotated slice) for the Suggested
    // tab, since this is an on-demand browse surface.
    const openSavedPanel = useCallback(async (tab = 'saved') => {
        setSavedPanelTab(tab);
        setShowSavedPanel(true);
        setPanelSavedStems(new Set());
        refreshBookSavedWords();
        setPanelCandidates([]);
        setPanelCandidatesLoading(true);
        try {
            const raw = await getBookWordCandidates({
                ownerId: activeOwnerId,
                language: activeBookLanguage,
                interfaceLanguage,
                bookUri: currentBook,
                limit: 20,
            });
            const chapterText = chapterTextForReaderPackage(nativeReaderPackage);
            const withReason = raw.map((candidate) => ({
                ...candidate,
                reason: deriveCandidateReason(candidate),
                exampleSentence: pickExampleSentence(chapterText, candidate.headword),
                exampleSurface: candidate.headword,
            }));
            setPanelCandidates(withReason);
        } catch (error) {
            console.warn('[Read] Failed to load word candidates:', error?.message ?? error);
            setPanelCandidates([]);
        } finally {
            setPanelCandidatesLoading(false);
        }
    }, [activeOwnerId, activeBookLanguage, interfaceLanguage, currentBook, nativeReaderPackage, refreshBookSavedWords]);

    const handleSaveCandidate = useCallback(async (candidate) => {
        if (!candidate?.stem) return;
        const word = candidate.stem;
        const hanja = candidate.hanja || '';
        const definition = candidate.gloss || '';
        // Optimistically highlight it in the reader like an in-line save.
        handleWordSave(word, { includeSurface: false });
        try {
            const createdAt = new Date().toISOString();
            const alreadySaved = await vocabEntryExists(word, hanja, definition, activeBookLanguage, {
                ownerId: activeOwnerId,
            });
            if (!alreadySaved) {
                const pKnown = await getCachedPKnown({
                    ownerId: activeOwnerId,
                    language: activeBookLanguage,
                    word,
                });
                await insertData(word, hanja, definition, {
                    ownerId: activeOwnerId,
                    level: 'unorganized',
                    sourceBookUri: currentBook ?? null,
                    sourceBookTitle: activeBook?.title ?? null,
                    contextSentence: candidate.exampleSentence || null,
                    createdAt,
                    updatedAt: createdAt,
                    language: activeBookLanguage,
                    pKnown,
                });
            }
            if (candidate.exampleSentence) {
                await recordVocabContext({
                    ownerId: activeOwnerId,
                    word,
                    hanja,
                    definition,
                    sentence: candidate.exampleSentence,
                    sourceBookUri: currentBook ?? null,
                    sourceBookTitle: activeBook?.title ?? null,
                    language: activeBookLanguage,
                });
            }
            requestUserDataSync('candidate-save');
            logInteractionEvent({
                ownerId: activeOwnerId,
                language: activeBookLanguage,
                word,
                hanja,
                def: definition,
                eventType: 'save',
                sourceBookUri: currentBook ?? null,
                sentence: candidate.exampleSentence || null,
            }).catch(() => {});
            setPanelSavedStems((prev) => new Set(prev).add(word));
            refreshBookSavedWords();
        } catch (error) {
            console.warn('[Read] Failed to save candidate word:', error?.message ?? error);
        }
    }, [activeOwnerId, activeBookLanguage, currentBook, activeBook, refreshBookSavedWords]);

    const handleSaveNote = useCallback(async (text) => {
        try {
            return await insertBookNote({
                ownerId: activeOwnerId,
                language: activeBookLanguage,
                bookUri: currentBook,
                note: text,
                chapterLabel: activeChapterTitle || chapterIndexLabel || null,
                progress: typeof bookProgress === 'number' ? bookProgress : null,
            });
        } catch (error) {
            console.warn('[Read] Failed to save note:', error?.message ?? error);
            return null;
        }
    }, [activeOwnerId, activeBookLanguage, currentBook, activeChapterTitle, chapterIndexLabel, bookProgress]);

    // ─── Checkpoints (bookmarks + notes) ─────────────────────────────────────
    // Both live in the same sheet, so open it with a fresh read of both lists —
    // a note saved seconds ago must show up without a reopen of the book.
    const openNotesLog = useCallback(async () => {
        setShowMenu(false);
        setShowNotesLog(true);
        try {
            const [notes, bookmarks] = await Promise.all([
                getBookNotes(currentBook, {
                    ownerId: activeOwnerId,
                    language: activeBookLanguage,
                }),
                getBookBookmarks(currentBook, {
                    ownerId: activeOwnerId,
                    language: activeBookLanguage,
                }),
            ]);
            setBookNotes(notes);
            setBookBookmarks(bookmarks);
        } catch (error) {
            console.warn('[Read] Failed to load checkpoints:', error?.message ?? error);
        }
    }, [activeOwnerId, activeBookLanguage, currentBook]);

    const handleDeleteNote = useCallback(async (id) => {
        try {
            await deleteBookNote(id, { ownerId: activeOwnerId });
            setBookNotes((prev) => prev.filter((note) => note.id !== id));
        } catch (error) {
            console.warn('[Read] Failed to delete note:', error?.message ?? error);
        }
    }, [activeOwnerId]);

    // Load the book's bookmarks as soon as it opens so the header icon can show
    // filled/outline for the current page without waiting for the sheet.
    useEffect(() => {
        let isActive = true;
        if (!currentBook) {
            setBookBookmarks([]);
            return undefined;
        }
        getBookBookmarks(currentBook, {
            ownerId: activeOwnerId,
            language: activeBookLanguage,
        })
            .then((rows) => {
                if (isActive) setBookBookmarks(rows);
            })
            .catch((error) => {
                console.warn('[Read] Failed to load bookmarks:', error?.message ?? error);
            });
        return () => {
            isActive = false;
        };
    }, [activeOwnerId, activeBookLanguage, currentBook]);

    // Which saved bookmark, if any, the reader is sitting on — drives the header
    // icon's filled/hollow state. See services/bookmarks for why this matches on
    // block id rather than page number.
    const currentReaderPosition = nativeRestorePosition || activeBook?.nativePosition || null;
    const activeBookmark = useMemo(
        () => findActiveBookmark(bookBookmarks, currentReaderPosition),
        [bookBookmarks, currentReaderPosition]
    );

    const toggleBookmark = useCallback(async () => {
        // In focus mode page events are debounced, so the tracked position can
        // trail the reader by up to FOCUS_PAGE_CHANGE_DEBOUNCE_MS. Flush first
        // or a bookmark taken right after a sentence step records the page the
        // reader just left.
        flushPendingFocusPageChange();
        const position = nativeRestorePositionRef.current || activeBook?.nativePosition || null;
        if (!currentBook || !Number.isInteger(position?.spineIndex)) {
            return;
        }
        try {
            if (activeBookmark) {
                setBookBookmarks((prev) => prev.filter((bookmark) => bookmark.id !== activeBookmark.id));
                await deleteBookBookmark(activeBookmark.id, { ownerId: activeOwnerId });
                return;
            }
            // pagesInChapter can be absent on a position that came from a
            // chapter load rather than a page event; the live location info
            // still knows the count, and it's what makes "Page 4 of 12" read
            // as a real page number instead of a bare index.
            const pagesInChapter = Number.isInteger(position.pagesInChapter)
                ? position.pagesInChapter
                : (Number.isInteger(readerLocationInfo?.pagesInChapter)
                    ? readerLocationInfo.pagesInChapter
                    : null);
            const created = await insertBookBookmark({
                ownerId: activeOwnerId,
                language: activeBookLanguage,
                bookUri: currentBook,
                spineIndex: position.spineIndex,
                pageIndex: Number.isInteger(position.pageIndex) ? position.pageIndex : 0,
                pagesInChapter,
                href: position.href || null,
                firstBlockId: position.firstBlockId || null,
                chapterLabel: activeChapterTitle || chapterIndexLabel || null,
                progress: typeof bookProgress === 'number' ? bookProgress : null,
            });
            if (created) {
                setBookBookmarks((prev) => [created, ...prev]);
            }
        } catch (error) {
            console.warn('[Read] Failed to toggle bookmark:', error?.message ?? error);
        }
    }, [
        activeBook,
        activeBookmark,
        activeBookLanguage,
        activeChapterTitle,
        activeOwnerId,
        bookProgress,
        chapterIndexLabel,
        currentBook,
        flushPendingFocusPageChange,
        readerLocationInfo,
    ]);

    const handleDeleteBookmark = useCallback(async (id) => {
        try {
            await deleteBookBookmark(id, { ownerId: activeOwnerId });
            setBookBookmarks((prev) => prev.filter((bookmark) => bookmark.id !== id));
        } catch (error) {
            console.warn('[Read] Failed to remove bookmark:', error?.message ?? error);
        }
    }, [activeOwnerId]);

    // Jump the reader to a saved checkpoint, mirroring how the TOC navigates:
    // reload the target chapter when it differs, otherwise seek in place.
    const handleSelectBookmark = useCallback((bookmark) => {
        if (!Number.isInteger(bookmark?.spineIndex)) {
            return;
        }
        setShowNotesLog(false);
        // A pending focus-mode page event would land after the jump and push the
        // old position straight back, so retire it before moving.
        flushPendingFocusPageChange();
        // The seek token is what tells the native view this is a deliberate jump
        // rather than the position echo pushed on every page event. Without it
        // an in-chapter jump is dropped as a no-op in continuous mode, where a
        // "page" is the whole chapter and the target always resolves to the
        // chapter already on screen.
        seekTokenRef.current += 1;
        const position = {
            spineIndex: bookmark.spineIndex,
            pageIndex: Number.isInteger(bookmark.pageIndex) ? bookmark.pageIndex : 0,
            pagesInChapter: Number.isInteger(bookmark.pagesInChapter) ? bookmark.pagesInChapter : null,
            href: bookmark.href || '',
            firstBlockId: bookmark.firstBlockId || null,
            seekToken: `seek:${seekTokenRef.current}`,
        };

        if (bookmark.spineIndex !== activeSpineIndex) {
            // Different chapter: the loader hands the position to the native
            // view, which seeks to it while repaginating the new chapter.
            loadNativeReaderPackageRef.current?.(bookmark.spineIndex, {
                restorePosition: position,
                animateChapterTransition: false,
            });
            return;
        }

        // Same chapter. Keep JS position state in step, then move the reader
        // with an explicit command — the prop alone has repeatedly proven
        // unreliable for this, since it doubles as the passive position echo.
        updateNativeRestorePosition(position);
        if (supportsSeekToPosition) {
            const viewTag = findNodeHandle(nativeReaderViewRef.current);
            if (viewTag != null) {
                sendSeekToPosition(viewTag, position).catch((error) => {
                    console.warn('[Read] Checkpoint seek failed:', error?.message ?? error);
                });
            }
        }
    }, [activeSpineIndex, flushPendingFocusPageChange, updateNativeRestorePosition]);

    useEffect(() => {
        const unsubscribeFocus = navigation?.addListener?.('focus', () => {
            bookCompletionInProgressRef.current = false;
        });

        if (navigation?.isFocused?.()) {
            bookCompletionInProgressRef.current = false;
        }

        return () => {
            unsubscribeFocus?.();
        };
    }, [navigation]);

    const handleBookLoadError = useCallback((reason) => {
        const lowerReason = String(reason || '').toLowerCase();
        const likelyTooLarge = lowerReason.includes('readasdataurl')
            || lowerReason.includes('outofmemory')
            || (typeof activeBookSizeMb === 'number' && activeBookSizeMb >= 25);

        setBookLoadState('error');
        setBookLoadError(
            likelyTooLarge
                ? t('read.bookTooLarge')
                : t('read.bookOpenFailed')
        );
    }, [activeBookSizeMb, t]);

    const retryBookLoad = useCallback(() => {
        setBookLoadError('');
        setBookLoadState('loading');
        setHighlightedWord('');
        setHighlightedWordContext(null);
        setIsNativeSelection(false);
        setClearSelectionToken((value) => value + 1);
        setReaderRetryKey((prev) => prev + 1);
    }, []);

    const cacheParsedChapterPackage = useCallback((parsedPackage) => {
        const spineIndex = spineIndexForReaderPackage(parsedPackage);
        if (!Number.isInteger(spineIndex)) {
            return null;
        }

        parsedChapterCacheRef.current.set(spineIndex, parsedPackage);
        return spineIndex;
    }, []);

    const pruneParsedChapterCache = useCallback((centerSpineIndex) => {
        if (!Number.isInteger(centerSpineIndex)) {
            return;
        }

        const keepSpineIndexes = new Set([
            centerSpineIndex - 1,
            centerSpineIndex,
            centerSpineIndex + 1,
        ]);

        parsedChapterCacheRef.current.forEach((_, spineIndex) => {
            if (!keepSpineIndexes.has(spineIndex)) {
                parsedChapterCacheRef.current.delete(spineIndex);
            }
        });
    }, []);

    const updateNativeChapterWindowForSpine = useCallback((centerSpineIndex, currentPackage = null) => {
        if (!Number.isInteger(centerSpineIndex)) {
            setNativeChapterWindow([]);
            return [];
        }

        if (currentPackage) {
            cacheParsedChapterPackage(currentPackage);
        }

        pruneParsedChapterCache(centerSpineIndex);

        const totalSpineItems = (
            currentPackage?.spine?.length
            ?? nativeReaderPackageRef.current?.spine?.length
            ?? 0
        );
        const chapterSpecs = [
            { role: 'previous', spineIndex: centerSpineIndex - 1 },
            { role: 'current', spineIndex: centerSpineIndex },
            { role: 'next', spineIndex: centerSpineIndex + 1 },
        ].filter(({ spineIndex }) => (
            spineIndex >= 0 && (!totalSpineItems || spineIndex < totalSpineItems)
        ));

        const entries = chapterSpecs
            .map(({ role, spineIndex }) => (
                chapterWindowEntryForPackage(parsedChapterCacheRef.current.get(spineIndex), role)
            ))
            .filter(Boolean);

        setNativeChapterWindow(entries);

        return entries;
    }, [cacheParsedChapterPackage, pruneParsedChapterCache]);

    const loadParsedChapterPackage = useCallback(async (requestedSpineIndex = null, reason = 'load') => {
        if (!currentBook) {
            return null;
        }

        const cacheKey = Number.isInteger(requestedSpineIndex) ? requestedSpineIndex : 'auto';
        if (Number.isInteger(requestedSpineIndex) && parsedChapterCacheRef.current.has(requestedSpineIndex)) {
            return parsedChapterCacheRef.current.get(requestedSpineIndex);
        }

        if (parsedChapterInflightRef.current.has(cacheKey)) {
            return parsedChapterInflightRef.current.get(cacheKey);
        }

        const loadOptions = Number.isInteger(requestedSpineIndex)
            ? { spineIndex: requestedSpineIndex }
            : {};
        const fallbackName = activeBook?.originalFilename
            || activeBook?.title
            || currentBook.split('/').pop()
            || t('common.untitled');
        const packageLoader = isPublicDomainBookUri(currentBook)
            ? readPublicDomainTextPackage(currentBook, loadOptions)
            : isPdfBook(activeBook, currentBook)
                ? readPdfPackageXml(currentBook, fallbackName, loadOptions)
                : readEpubPackageXml(
                    currentBook,
                    fallbackName,
                    loadOptions
                );

        const loadPromise = packageLoader.then((parsedPackage) => {
            cacheParsedChapterPackage(parsedPackage);
            return parsedPackage;
        }).finally(() => {
            parsedChapterInflightRef.current.delete(cacheKey);
        });

        parsedChapterInflightRef.current.set(cacheKey, loadPromise);
        return loadPromise;
    }, [
        activeBook?.format,
        activeBook?.originalFilename,
        activeBook?.title,
        cacheParsedChapterPackage,
        currentBook,
    ]);

    const prefetchAdjacentChapters = useCallback((centerSpineIndex, totalSpineItems) => {
        if (!currentBook || !Number.isInteger(centerSpineIndex) || totalSpineItems <= 0) {
            return;
        }

        const prefetchToken = chapterPrefetchTokenRef.current + 1;
        chapterPrefetchTokenRef.current = prefetchToken;

        [
            { role: 'previous', spineIndex: centerSpineIndex - 1 },
            { role: 'next', spineIndex: centerSpineIndex + 1 },
        ]
            .filter(({ spineIndex }) => spineIndex >= 0 && spineIndex < totalSpineItems)
            .forEach(({ role, spineIndex }) => {
                if (parsedChapterCacheRef.current.has(spineIndex)) {
                    updateNativeChapterWindowForSpine(centerSpineIndex);
                    return;
                }

                loadParsedChapterPackage(spineIndex, `prefetch:${role}`)
                    .then(() => {
                        if (chapterPrefetchTokenRef.current !== prefetchToken) {
                            return;
                        }
                        updateNativeChapterWindowForSpine(centerSpineIndex);
                    })
                    .catch((error) => {
                        if (chapterPrefetchTokenRef.current !== prefetchToken) {
                            return;
                        }
                        console.warn(`[Read] Adjacent chapter prefetch failed (${role} ${spineIndex}):`, error);
                    });
            });
    }, [currentBook, loadParsedChapterPackage, updateNativeChapterWindowForSpine]);

    const persistChapterPreprocessResults = useCallback(async ({
        bookUri,
        results = [],
        surfaceIndex = [],
        language = 'ko',
    }) => {
        const normalizedLanguage = normalizeBookLanguage(language);
        const cacheScope = { language: normalizedLanguage, interfaceLanguage };
        const normalizedInterfaceLanguage = normalizeInterfaceLanguageCode(interfaceLanguage);
        const cacheEntries = (results || [])
            .filter((entry) => entry?.stem)
            .map((entry) => {
                const entryInterfaceLanguage = normalizeInterfaceLanguageCode(
                    entry.interfaceLanguage ?? entry.interface_language ?? normalizedInterfaceLanguage
                );

                if (
                    ['en', 'zh'].includes(normalizedLanguage)
                    && normalizedInterfaceLanguage !== 'en'
                    && entryInterfaceLanguage !== normalizedInterfaceLanguage
                ) {
                    return { ...entry, definition: null };
                }

                return entry;
            });
        await insertCacheEntries(cacheEntries, cacheScope);

        const stems = [...new Set(cacheEntries.map((entry) => entry.stem).filter(Boolean))];
        if (stems.length === 0) {
            return 0;
        }

        const cachedRows = await lookupCacheByStems(stems, cacheScope);
        const stemToId = {};
        cachedRows.forEach(row => { stemToId[row.stem] = row.id; });

        const seenSurfaceStem = new Set();
        const bookIndexEntries = (surfaceIndex || [])
            .filter((entry) => entry?.surface && stemToId[entry.stem] != null)
            .map((entry) => ({
                surface: entry.surface,
                stem_id: stemToId[entry.stem],
            }))
            .filter((entry) => {
                const key = `${entry.surface}|${entry.stem_id}`;
                if (seenSurfaceStem.has(key)) {
                    return false;
                }
                seenSurfaceStem.add(key);
                return true;
            });

        await insertBookIndexEntries(bookUri, bookIndexEntries, { ownerId: activeOwnerId });

        // Phase 2.4: batch-score this chapter's vocabulary on write, so the reader
        // never has to compute P(known) per word at scroll time. Compute-on-write,
        // read-fast (design doc §4 serving). Non-fatal: a scoring failure must not
        // break preprocessing — the score cache can be rebuilt later on next open.
        try {
            await scoreWordsForProfile({
                ownerId: activeOwnerId,
                language: normalizedLanguage,
                stems,
                sourceBookUri: bookUri,
            });
        } catch (scoreError) {
            console.warn('[Read] Chapter baseline scoring failed (non-fatal):', scoreError);
        }

        return bookIndexEntries.length;
    }, [activeOwnerId, interfaceLanguage]);

    const startChapterPreprocessing = useCallback(async (
        centerSpineIndex,
        totalSpineItems,
        currentPackage = null
    ) => {
        if (!currentBook || !Number.isInteger(centerSpineIndex) || totalSpineItems <= 0) {
            return;
        }

        const queue = buildChapterPreprocessOrder(centerSpineIndex, totalSpineItems);
        if (queue.length === 0) {
            return;
        }

        const activePreprocess = activeChapterPreprocessRef.current;
        if (
            preprocessingInFlightRef.current
            && activePreprocess.bookUri === currentBook
            && activePreprocess.centerSpineIndex === centerSpineIndex
        ) {
            return;
        }

        const preprocessToken = chapterPreprocessTokenRef.current + 1;
        chapterPreprocessTokenRef.current = preprocessToken;
        preprocessingInFlightRef.current = true;
        activeChapterPreprocessRef.current = { bookUri: currentBook, centerSpineIndex };

        setBooks((prevBooks) => prevBooks.map((book) => (
            book.uri === currentBook ? { ...book, preprocessed: false, preprocessing: true } : book
        )));
        setPreprocessStatus('preprocessing');

        let completedChapters = 0;
        let failedChapters = 0;
        let totalSurfaceCount = 0;
        let totalWordCount = 0;
        let countedWordChapters = 0;
        const bookLevelAccumulator = createBookLevelAccumulator(activeBookLanguage);

        try {
            await markBookPreprocessMeta({
                ownerId: activeOwnerId,
                bookUri: currentBook,
                status: 'partial',
                surfaceCount: 0,
                preprocessVersion: PREPROCESS_VERSION,
            });

            for (const spineIndex of queue) {
                if (chapterPreprocessTokenRef.current !== preprocessToken) {
                    return;
                }

                const isCurrentChapter = spineIndex === centerSpineIndex;
                const existingChapter = await getBookPreprocessChapter(
                    activeOwnerId,
                    currentBook,
                    spineIndex,
                    PREPROCESS_VERSION
                );
                if (chapterPreprocessTokenRef.current !== preprocessToken) {
                    return;
                }

                if (existingChapter?.status === 'complete') {
                    addStoredBookLevelToAccumulator(bookLevelAccumulator, existingChapter);
                    completedChapters += 1;
                    totalSurfaceCount += Number(existingChapter.surface_count) || 0;
                    if (isCurrentChapter) {
                        setPreprocessStatus('done');
                    }
                    continue;
                }

                await markBookPreprocessChapter({
                    ownerId: activeOwnerId,
                    bookUri: currentBook,
                    spineIndex,
                    status: 'processing',
                    surfaceCount: 0,
                    preprocessVersion: PREPROCESS_VERSION,
                });
                if (chapterPreprocessTokenRef.current !== preprocessToken) {
                    return;
                }

                setPreprocessStatus('preprocessing');

                try {
                    const chapterPackage = (
                        isCurrentChapter
                        && currentPackage
                        && spineIndexForReaderPackage(currentPackage) === spineIndex
                    )
                        ? currentPackage
                        : await loadParsedChapterPackage(spineIndex, `preprocess:${spineIndex}`);

                    if (chapterPreprocessTokenRef.current !== preprocessToken) {
                        return;
                    }

                    const chapterText = chapterTextForReaderPackage(chapterPackage);
                    totalWordCount += countReadableTextWords(chapterText);
                    countedWordChapters += 1;
                    const {
                        results = [],
                        surface_index: surfaceIndex = [],
                        stats = {},
                    } = await preprocessChapter({
                        bookUri: currentBook,
                        spineIndex,
                        text: chapterText,
                        language: activeBookLanguage,
                        interfaceLanguage,
                    });

                    if (chapterPreprocessTokenRef.current !== preprocessToken) {
                        return;
                    }

                    const surfaceCount = await persistChapterPreprocessResults({
                        bookUri: currentBook,
                        results,
                        surfaceIndex,
                        language: activeBookLanguage,
                    });
                    const chapterBookLevel = stats?.book_level ?? null;
                    addBookLevelScoreToAccumulator(bookLevelAccumulator, chapterBookLevel);

                    await markBookPreprocessChapter({
                        ownerId: activeOwnerId,
                        bookUri: currentBook,
                        spineIndex,
                        status: 'complete',
                        surfaceCount,
                        preprocessVersion: PREPROCESS_VERSION,
                        bookLevel: chapterBookLevel,
                        completedAt: new Date().toISOString(),
                    });

                    if (chapterPreprocessTokenRef.current !== preprocessToken) {
                        return;
                    }

                    completedChapters += 1;
                    totalSurfaceCount += surfaceCount;
                    await markBookPreprocessMeta({
                        ownerId: activeOwnerId,
                        bookUri: currentBook,
                        status: 'partial',
                        surfaceCount: totalSurfaceCount,
                        preprocessVersion: PREPROCESS_VERSION,
                        bookLevel: finalizeBookLevelAccumulator(bookLevelAccumulator),
                    });
                    if (chapterPreprocessTokenRef.current !== preprocessToken) {
                        return;
                    }

                    if (isCurrentChapter) {
                        setPreprocessStatus('done');
                    }

                    const visibleSpineIndex = currentSpineIndexRef.current;
                    if (
                        Number.isInteger(visibleSpineIndex)
                        && Math.abs(spineIndex - visibleSpineIndex) > 1
                    ) {
                        parsedChapterCacheRef.current.delete(spineIndex);
                    }
                } catch (error) {
                    failedChapters += 1;
                    console.warn(`[Read] Chapter preprocess failed for spine ${spineIndex}:`, error);
                    await markBookPreprocessChapter({
                        ownerId: activeOwnerId,
                        bookUri: currentBook,
                        spineIndex,
                        status: 'failed',
                        surfaceCount: 0,
                        preprocessVersion: PREPROCESS_VERSION,
                        completedAt: new Date().toISOString(),
                    });

                    if (chapterPreprocessTokenRef.current !== preprocessToken) {
                        return;
                    }

                    if (isCurrentChapter) {
                        setPreprocessStatus('error');
                    }
                }
            }

            if (chapterPreprocessTokenRef.current !== preprocessToken) {
                return;
            }

            const fullBookWindow = queue.length >= totalSpineItems;
            const windowSucceeded = failedChapters === 0 && completedChapters > 0;
            const finalStatus = !windowSucceeded
                ? (completedChapters > 0 ? 'partial' : 'failed')
                : (fullBookWindow ? 'complete' : 'partial');
            const completedWordCount = (
                finalStatus === 'complete'
                && countedWordChapters === queue.length
                && totalWordCount > 0
                    ? totalWordCount
                    : null
            );
            const completedBookLevel = finalizeBookLevelAccumulator(bookLevelAccumulator);
            await markBookPreprocessMeta({
                ownerId: activeOwnerId,
                bookUri: currentBook,
                status: finalStatus,
                surfaceCount: totalSurfaceCount,
                preprocessVersion: PREPROCESS_VERSION,
                bookLevel: completedBookLevel,
                completedAt: finalStatus === 'complete' ? new Date().toISOString() : null,
            });

            setBooks((prevBooks) => prevBooks.map((book) => (
                book.uri === currentBook
                    ? {
                        ...book,
                        preprocessed: fullBookWindow && finalStatus === 'complete',
                        preprocessing: false,
                        ...(completedWordCount != null
                            ? { wordCount: completedWordCount }
                            : {}),
                        ...(completedBookLevel?.level
                            ? { difficulty: completedBookLevel.level, bookLevel: completedBookLevel }
                            : {}),
                    }
                    : book
            )));

            if (completedWordCount != null && activeBook?.cloudId) {
                scheduleCloudProgressSync({
                    ...activeBook,
                    wordCount: completedWordCount,
                    ...(completedBookLevel?.level
                        ? { difficulty: completedBookLevel.level, bookLevel: completedBookLevel }
                        : {}),
                    preprocessed: fullBookWindow && finalStatus === 'complete',
                    preprocessing: false,
                });
            }

            if (windowSucceeded) {
                setPreprocessStatus('done');
                if (fullBookWindow) {
                    onPreprocessComplete?.(currentBook);
                }
            } else {
                setPreprocessStatus('error');
            }
        } finally {
            if (chapterPreprocessTokenRef.current === preprocessToken) {
                preprocessingInFlightRef.current = false;
                activeChapterPreprocessRef.current = { bookUri: null, centerSpineIndex: null };
            }
        }
    }, [
        currentBook,
        activeOwnerId,
        activeBook,
        activeBookLanguage,
        interfaceLanguage,
        loadParsedChapterPackage,
        onPreprocessComplete,
        persistChapterPreprocessResults,
        scheduleCloudProgressSync,
        setBooks,
    ]);

    const loadNativeReaderPackage = useCallback(async (
        requestedSpineIndex = null,
        { animateChapterTransition = false, restorePosition = null } = {}
    ) => {
        if (!currentBook) {
            setNativeReaderPackage(null);
            setNativeChapterWindow([]);
        updateNativeRestorePosition(null);
            nativeReaderPackageRef.current = null;
            setBookLoadState('idle');
            setBookLoadError('');
            setReaderLocationInfo(null);
            setCurrentSpineIndex(null);
            currentSpineIndexRef.current = null;
            setChapterTransitionDirection('none:0');
            return;
        }

        const requestedRestorePosition = (
            restorePosition && Number.isInteger(restorePosition.spineIndex)
                ? restorePosition
                : null
        );
        const isChapterNavigation = Number.isInteger(requestedSpineIndex);
        const previousSpineIndex = currentSpineIndexRef.current;
        if (isChapterNavigation && requestedSpineIndex !== previousSpineIndex) {
            setHighlightedWord('');
            setHighlightedWordContext(null);
            setIsNativeSelection(false);
            setClearSelectionToken((value) => value + 1);
        }
        const nextTransitionDirection = (
            animateChapterTransition && isChapterNavigation && Number.isInteger(previousSpineIndex)
                ? (
                    requestedSpineIndex > previousSpineIndex
                        ? 'next'
                        : (requestedSpineIndex < previousSpineIndex ? 'previous' : 'none')
                )
                : 'none'
        );
        const canKeepCurrentReader = (
            isChapterNavigation
            && nativeReaderPackageRef.current?.bookManifest?.sourceUri === currentBook
        );
        const loadToken = chapterLoadTokenRef.current + 1;
        chapterLoadTokenRef.current = loadToken;

        setBookLoadError('');
        if (!requestedRestorePosition) {
            updateNativeRestorePosition(null);
        }
        if (!canKeepCurrentReader) {
            setBookLoadState('loading');
            setNativeReaderPackage(null);
            setNativeChapterWindow([]);
            nativeReaderPackageRef.current = null;
            setToc([]);
            setChapterTransitionDirection('none:0');
        }

        try {
            const parsedPackage = await loadParsedChapterPackage(
                requestedSpineIndex,
                isChapterNavigation ? 'navigate' : 'initial'
            );

            if (chapterLoadTokenRef.current !== loadToken) {
                return;
            }

            if (!parsedPackage) {
                return;
            }

            const loadedSpineIndex = spineIndexForReaderPackage(parsedPackage) ?? 0;
            const totalSpineItems = parsedPackage.spine?.length ?? 0;
            const nextRestorePosition = (
                requestedRestorePosition?.spineIndex === loadedSpineIndex
                    ? requestedRestorePosition
                    : null
            );

            setCurrentSpineIndex(loadedSpineIndex);
            currentSpineIndexRef.current = loadedSpineIndex;
            nativeReaderPackageRef.current = parsedPackage;
            updateNativeRestorePosition(nextRestorePosition);
            setToc(Array.isArray(parsedPackage.toc) ? parsedPackage.toc : []);
            setChapterTransitionDirection((prev) => {
                const previousToken = Number(String(prev).split(':')[1]) || 0;
                const direction = canKeepCurrentReader && animateChapterTransition ? nextTransitionDirection : 'none';
                return `${direction}:${previousToken + 1}`;
            });
            setNativeReaderPackage(parsedPackage);
            updateNativeChapterWindowForSpine(loadedSpineIndex, parsedPackage);
            prefetchAdjacentChapters(loadedSpineIndex, totalSpineItems);
            const restorePageIndex = Number.isInteger(nextRestorePosition?.pageIndex)
                ? nextRestorePosition.pageIndex
                : null;
            const restorePagesInChapter = Number.isInteger(nextRestorePosition?.pagesInChapter)
                ? nextRestorePosition.pagesInChapter
                : null;

            setReaderLocationInfo({
                page: totalSpineItems > 0 ? loadedSpineIndex + 1 : null,
                total: totalSpineItems || null,
                percentage: progressForBookPosition(
                    loadedSpineIndex,
                    totalSpineItems,
                    restorePageIndex,
                    restorePagesInChapter
                ),
                href: parsedPackage.loadedSpineItem?.path || '',
                pageInChapter: Number.isInteger(restorePageIndex) ? restorePageIndex + 1 : null,
                pagesInChapter: restorePagesInChapter,
            });
            startChapterPreprocessing(loadedSpineIndex, totalSpineItems, parsedPackage);
            setBookLoadState('ready');
            setBookLoadError('');
        } catch (error) {
            if (chapterLoadTokenRef.current !== loadToken) {
                return;
            }

            console.error('[Read] Native reader load failed:', error);
            if (canKeepCurrentReader && nativeReaderPackageRef.current) {
                setBookLoadState('ready');
                setBookLoadError(error?.message || t('read.nativeChapterUnsupported'));
                setChapterTransitionDirection('none:0');
                return;
            }

            setBookLoadState('error');
            setBookLoadError(error?.message || t('read.nativeUnsupported'));
            setChapterTransitionDirection('none:0');
        }
    }, [
        currentBook,
        loadParsedChapterPackage,
        prefetchAdjacentChapters,
        startChapterPreprocessing,
        t,
        updateNativeChapterWindowForSpine,
    ]);

    loadNativeReaderPackageRef.current = loadNativeReaderPackage;

    // Keep this tied to the actual book identity. The loader callback is
    // recreated when Read updates parent book state, and depending on it here
    // reloads the same spine repeatedly.
    useEffect(() => {
        const savedNativePosition = activeBook?.nativePosition || null;
        const savedSpineIndex = Number.isInteger(savedNativePosition?.spineIndex)
            ? savedNativePosition.spineIndex
            : null;

        loadNativeReaderPackageRef.current?.(savedSpineIndex, { restorePosition: savedNativePosition });

        return () => {
            chapterLoadTokenRef.current += 1;
            chapterPrefetchTokenRef.current += 1;
            chapterPreprocessTokenRef.current += 1;
        };
    }, [activeBook?.uri, currentBook, readerRetryKey]);

    /**
     * Consume one exposure unit native just closed — a page, a focus span, or a
     * scrolled-past block. Native owns "what was shown and for how long"; this owns
     * the intent filters and the plausibility gate.
     *
     * Three subtractions before anything counts as "skipped because known":
     *   1. units left too fast for their length — never really read (dwell gate)
     *   2. words looked up recently — a lookup already logged its own (much
     *      stronger, negative) evidence; crediting a positive too would partly
     *      cancel it
     *   3. saved words — already earning graded evidence through the SRS loop
     *
     * Survivors are ranked by how UNCERTAIN the model is about them (gradient
     * weight nearest the midpoint) and the top few are credited. That ordering is
     * deliberate: skipping a word we already predict you know teaches us nothing,
     * and skipping a word far above you is at least as likely to mean "gave up and
     * read on" as "knew it" — the informative skips are the ones in the middle.
     */
    const handleNativeExposure = useCallback(({ terms, chars, dwellMs } = {}) => {
        // Each closed unit ends the window in which a tap could have belonged to
        // it; taps after this point belong to the next unit.
        const lookedUp = recentLookupsRef.current;
        recentLookupsRef.current = new Set();

        if (!currentBook || !Array.isArray(terms) || terms.length === 0) {
            return;
        }
        if (!exposureDwellIsPlausible(chars, dwellMs)) {
            return;
        }

        const weights = levelUnderlineWeightsRef.current;
        const saved = savedSurfacesRef.current;
        const skipped = terms
            .filter((term) => typeof term === 'string' && term && !lookedUp.has(term) && !saved.has(term))
            .sort((a, b) => (
                Math.abs((weights.get(a) ?? 1) - 0.5) - Math.abs((weights.get(b) ?? 1) - 0.5)
            ))
            .slice(0, EXPOSURE_MAX_PER_UNIT);

        if (skipped.length === 0) {
            return;
        }

        applyExposureBatch({
            ownerId: activeOwnerId,
            language: activeBookLanguage,
            stems: skipped,
            sourceBookUri: currentBook,
            dwellSeconds: Number(dwellMs) / 1000,
        }).catch((error) => {
            console.warn('[Read] Failed to apply exposure batch:', error);
        });
    }, [activeOwnerId, activeBookLanguage, currentBook]);

    const processNativePageChange = useCallback(({ page, total, spineIndex, href, firstBlockId, savedHighlights } = {}) => {
        if (bookCompletionInProgressRef.current) {
            return;
        }

        const pageIndex = Number.isInteger(page) ? page : null;
        const eventSpineIndex = Number.isInteger(spineIndex) ? spineIndex : null;
        const currentLoadedSpineIndex = currentSpineIndexRef.current;
        const resolvedSpineIndex = Number.isInteger(eventSpineIndex)
            ? eventSpineIndex
            : currentLoadedSpineIndex;
        const totalSpineItems = nativeReaderPackageRef.current?.spine?.length ?? nativeChapterTotal;
        const nextProgress = progressForBookPosition(resolvedSpineIndex, totalSpineItems, pageIndex, total);

        setReaderLocationInfo((prev) => ({
            ...(prev || {}),
            page: (
                Number.isInteger(resolvedSpineIndex) && totalSpineItems > 0
                    ? resolvedSpineIndex + 1
                    : (prev?.page ?? null)
            ),
            total: totalSpineItems || prev?.total || null,
            percentage: nextProgress ?? prev?.percentage ?? null,
            href: typeof href === 'string' && href.length > 0 ? href : (prev?.href || ''),
            pageInChapter: Number.isInteger(page) ? page + 1 : null,
            pagesInChapter: Number.isInteger(total) ? total : null,
        }));

        if (!currentBook || !Number.isInteger(pageIndex) || !Number.isInteger(resolvedSpineIndex)) {
            return;
        }

        if (Array.isArray(savedHighlights) && savedHighlights.length > 0) {
            Promise.all(savedHighlights.map((highlight) => (
                recordVocabContextForSurface({
                    ownerId: activeOwnerId,
                    surface: typeof highlight?.text === 'string' ? highlight.text : '',
                    sentence: typeof highlight?.sentence === 'string' ? highlight.sentence : '',
                    sourceBookUri: currentBook,
                    sourceBookTitle: activeBook?.title ?? null,
                    language: activeBookLanguage,
                }).catch((error) => {
                    console.warn('[Read] Failed to record visible vocab context:', error?.message ?? error);
                    return false;
                })
            )))
                .then((contexts) => {
                    if (contexts.some(Boolean)) {
                        requestUserDataSync('reader-visible-vocab-context');
                    }
                });
        }

        const loadedSpineItem = nativeReaderPackageRef.current?.spine
            ?.find((item) => item?.index === resolvedSpineIndex)
            || nativeReaderPackageRef.current?.loadedSpineItem;
        const nextPosition = {
            spineIndex: resolvedSpineIndex,
            pageIndex,
            pagesInChapter: Number.isInteger(total) ? total : null,
            href: (
                typeof href === 'string' && href.length > 0
                    ? href
                    : (loadedSpineItem?.path || loadedSpineItem?.href || '')
            ),
            firstBlockId: (
                typeof firstBlockId === 'string' && firstBlockId.length > 0
                    ? firstBlockId
                    : null
            ),
        };
        const nextBookPatch = {
            nativePosition: nextPosition,
            location: nextPosition.href || null,
            progress: nextProgress ?? clampProgress(activeBook?.progress ?? 0),
        };

        if (activeBook?.cloudId) {
            scheduleCloudProgressSync({
                ...activeBook,
                ...nextBookPatch,
            });
        }

        updateNativeRestorePosition(nextPosition);
        setBooks((prevBooks) => prevBooks.map((book) => {
            if (book.uri !== currentBook) {
                return book;
            }

            const previousPosition = book.nativePosition || {};
            const isUnchanged = (
                previousPosition.spineIndex === nextPosition.spineIndex
                && previousPosition.pageIndex === nextPosition.pageIndex
                && previousPosition.pagesInChapter === nextPosition.pagesInChapter
                && previousPosition.href === nextPosition.href
                && previousPosition.firstBlockId === nextPosition.firstBlockId
            );

            return isUnchanged
                ? book
                : { ...book, ...nextBookPatch };
        }));
    }, [
        activeBook,
        activeBookLanguage,
        activeOwnerId,
        currentBook,
        nativeChapterTotal,
        scheduleCloudProgressSync,
        setBooks,
        updateNativeRestorePosition,
    ]);

    const handleNativePageChange = useCallback((event = {}) => {
        if (!focusModeRef.current) {
            flushPendingFocusPageChange();
            processNativePageChange(event);
            return;
        }

        pendingFocusPageChangeRef.current = { event, process: processNativePageChange };
        if (focusPageChangeTimeoutRef.current) {
            clearTimeout(focusPageChangeTimeoutRef.current);
        }
        focusPageChangeTimeoutRef.current = setTimeout(() => {
            focusPageChangeTimeoutRef.current = null;
            flushPendingFocusPageChange();
        }, FOCUS_PAGE_CHANGE_DEBOUNCE_MS);
    }, [flushPendingFocusPageChange, processNativePageChange]);

    const handleNativeChapterCommit = useCallback(({
        spineIndex,
        href,
        path,
        pageIndex,
        pagesInChapter,
        firstBlockId,
    } = {}) => {
        if (bookCompletionInProgressRef.current) {
            return;
        }

        const committedSpineIndex = Number.isInteger(spineIndex) ? spineIndex : null;
        if (!Number.isInteger(committedSpineIndex)) {
            return;
        }

        setHighlightedWord('');
        setHighlightedWordContext(null);
        setIsNativeSelection(false);
        setClearSelectionToken((value) => value + 1);

        const committedPackage = parsedChapterCacheRef.current.get(committedSpineIndex);

        if (!committedPackage) {
            loadNativeReaderPackage(committedSpineIndex, {
                restorePosition: {
                    spineIndex: committedSpineIndex,
                    pageIndex: Number.isInteger(pageIndex) ? pageIndex : 0,
                    pagesInChapter: Number.isInteger(pagesInChapter) ? pagesInChapter : null,
                    href: path || href || '',
                    firstBlockId: firstBlockId || null,
                },
            });
            return;
        }

        const totalSpineItems = committedPackage.spine?.length ?? 0;
        const nextPosition = {
            spineIndex: committedSpineIndex,
            pageIndex: Number.isInteger(pageIndex) ? pageIndex : 0,
            pagesInChapter: Number.isInteger(pagesInChapter) ? pagesInChapter : null,
            href: path || href || committedPackage.loadedSpineItem?.path || committedPackage.loadedSpineItem?.href || '',
            firstBlockId: firstBlockId || null,
        };
        const committedPageIndex = Number.isInteger(pageIndex) ? pageIndex : 0;
        const committedPageCount = Number.isInteger(pagesInChapter) ? pagesInChapter : null;
        const nextProgress = progressForBookPosition(
            committedSpineIndex,
            totalSpineItems,
            committedPageIndex,
            committedPageCount
        ) ?? clampProgress(activeBook?.progress ?? 0);
        const nextBookPatch = {
            nativePosition: nextPosition,
            location: nextPosition.href || null,
            progress: nextProgress,
        };

        chapterLoadTokenRef.current += 1;
        setCurrentSpineIndex(committedSpineIndex);
        currentSpineIndexRef.current = committedSpineIndex;
        nativeReaderPackageRef.current = committedPackage;
        setNativeReaderPackage(committedPackage);
        updateNativeRestorePosition(nextPosition);
        if (currentBook) {
            setBooks((prevBooks) => prevBooks.map((book) => (
                book.uri === currentBook
                    ? { ...book, ...nextBookPatch }
                    : book
            )));
        }
        if (activeBook?.cloudId) {
            scheduleCloudProgressSync({
                ...activeBook,
                ...nextBookPatch,
            });
        }
        setToc(Array.isArray(committedPackage.toc) ? committedPackage.toc : []);
        setChapterTransitionDirection((prev) => {
            const previousToken = Number(String(prev).split(':')[1]) || 0;
            return `none:${previousToken + 1}`;
        });
        setReaderLocationInfo({
            page: totalSpineItems > 0 ? committedSpineIndex + 1 : null,
            total: totalSpineItems || null,
            percentage: nextProgress,
            href: nextPosition.href,
            pageInChapter: Number.isInteger(pageIndex) ? pageIndex + 1 : null,
            pagesInChapter: Number.isInteger(pagesInChapter) ? pagesInChapter : null,
        });
        setBookLoadState('ready');
        setBookLoadError('');
        updateNativeChapterWindowForSpine(committedSpineIndex, committedPackage);
        prefetchAdjacentChapters(committedSpineIndex, totalSpineItems);
        startChapterPreprocessing(committedSpineIndex, totalSpineItems, committedPackage);
    }, [
        activeBook,
        currentBook,
        loadNativeReaderPackage,
        prefetchAdjacentChapters,
        scheduleCloudProgressSync,
        setBooks,
        startChapterPreprocessing,
        updateNativeRestorePosition,
        updateNativeChapterWindowForSpine,
    ]);

    const handleNativeChapterEnd = useCallback(() => {
        if (bookCompletionInProgressRef.current) {
            return;
        }

        const loadedSpineIndex = currentSpineIndexRef.current;
        if (!Number.isInteger(loadedSpineIndex) || nativeChapterTotal <= 0) {
            return;
        }

        const nextSpineIndex = loadedSpineIndex + 1;
        if (nextSpineIndex < nativeChapterTotal) {
            loadNativeReaderPackage(nextSpineIndex, { animateChapterTransition: true });
            return;
        }

        bookCompletionInProgressRef.current = true;

        if (currentBook) {
            const previousPosition = nativeRestorePositionRef.current || activeBook?.nativePosition || {};
            const loadedSpineItem = nativeReaderPackageRef.current?.spine
                ?.find((item) => item?.index === loadedSpineIndex)
                || nativeReaderPackageRef.current?.loadedSpineItem;
            const finalPageCount = Number.isInteger(previousPosition?.pagesInChapter)
                ? previousPosition.pagesInChapter
                : null;
            const finalPageIndex = Number.isInteger(previousPosition?.pageIndex)
                ? previousPosition.pageIndex
                : (Number.isInteger(finalPageCount) ? Math.max(0, finalPageCount - 1) : 0);
            const finalPosition = {
                spineIndex: loadedSpineIndex,
                pageIndex: finalPageIndex,
                pagesInChapter: finalPageCount,
                href: previousPosition?.href || loadedSpineItem?.path || loadedSpineItem?.href || '',
                firstBlockId: previousPosition?.firstBlockId || null,
            };
            const nextBookPatch = {
                nativePosition: finalPosition,
                location: finalPosition.href || null,
                progress: 1,
            };

            updateNativeRestorePosition(null);
            setBooks((prevBooks) => prevBooks.map((book) => (
                book.uri === currentBook
                    ? { ...book, ...nextBookPatch }
                    : book
            )));

            if (activeBook?.cloudId) {
                scheduleCloudProgressSync({
                    ...activeBook,
                    ...nextBookPatch,
                });
            }
        }

        setShowMenu(false);
        setShowToc(false);
        navigation?.navigate?.('Home');
    }, [
        activeBook,
        currentBook,
        loadNativeReaderPackage,
        nativeChapterTotal,
        navigation,
        scheduleCloudProgressSync,
        setBooks,
        updateNativeRestorePosition,
    ]);

    const handleNativeChapterStart = useCallback(() => {
        if (bookCompletionInProgressRef.current) {
            return;
        }

        const loadedSpineIndex = currentSpineIndexRef.current;
        if (!Number.isInteger(loadedSpineIndex) || loadedSpineIndex <= 0) {
            return;
        }

        loadNativeReaderPackage(loadedSpineIndex - 1, { animateChapterTransition: true });
    }, [loadNativeReaderPackage]);

    // Focus mode always presents the lookup panel from the bottom so the
    // anchored sentence can lift above it.
    const shouldPlaceLookupAtTop = lookupPlacement === 'top' && !focusMode;
    const readerFontSize = Math.round(clampNumber(
        settings.fontSize,
        FONT_SIZE_MIN,
        FONT_SIZE_MAX,
        DEFAULT_READER_SETTINGS.fontSize
    ));
    const readerLineSpacing = clampNumber(
        settings.lineSpacing,
        LINE_SPACING_STEPS[0].value,
        LINE_SPACING_STEPS[LINE_SPACING_STEPS.length - 1].value,
        DEFAULT_READER_SETTINGS.lineSpacing
    );
    const readerBrightness = clampNumber(
        settings.brightness,
        BRIGHTNESS_MIN,
        BRIGHTNESS_MAX,
        DEFAULT_READER_SETTINGS.brightness
    );
    const readerBrightnessDelta = readerBrightness - DEFAULT_READER_SETTINGS.brightness;
    const readerBrightnessOverlayColor = readerBrightnessDelta < 0 ? '#000000' : '#ffffff';
    const readerBrightnessOverlayOpacity = readerBrightnessDelta < 0
        ? Math.min(0.28, (Math.abs(readerBrightnessDelta) / (DEFAULT_READER_SETTINGS.brightness - BRIGHTNESS_MIN)) * 0.28)
        : Math.min(0.08, (readerBrightnessDelta / (BRIGHTNESS_MAX - DEFAULT_READER_SETTINGS.brightness)) * 0.08);
    const activeLineSpacingIndex = nearestLineSpacingIndex(readerLineSpacing);
    const activeLineSpacingLabel = lineSpacingLabel(readerLineSpacing);
    const handleFontSizeStep = (direction) => {
        handleSettingChange(
            'fontSize',
            Math.round(clampNumber(readerFontSize + direction, FONT_SIZE_MIN, FONT_SIZE_MAX, DEFAULT_READER_SETTINGS.fontSize))
        );
    };
    const handleLineSpacingStep = (direction) => {
        const nextIndex = clampNumber(
            activeLineSpacingIndex + direction,
            0,
            LINE_SPACING_STEPS.length - 1,
            activeLineSpacingIndex
        );
        handleSettingChange('lineSpacing', LINE_SPACING_STEPS[nextIndex].value);
    };
    const handleBrightnessChange = (value) => {
        const nextBrightness = clampNumber(value, BRIGHTNESS_MIN, BRIGHTNESS_MAX, DEFAULT_READER_SETTINGS.brightness);
        handleSettingChange('brightness', Number(nextBrightness.toFixed(2)));
    };

    // ── Focus (sentence beam) mode wiring ────────────────────────────────────
    const focusSpan = Math.round(clampNumber(
        settings.focusSpan,
        FOCUS_SPAN_MIN,
        FOCUS_SPAN_MAX,
        DEFAULT_READER_SETTINGS.focusSpan
    ));
    const focusSwipe = !!settings.focusSwipe;
    const readingMode = READING_MODES.includes(settings.readingMode)
        ? settings.readingMode
        : DEFAULT_READER_SETTINGS.readingMode;
    const isScrollMode = readingMode === 'scroll';
    const nativeRenderMode = focusMode ? 'focus' : (isScrollMode ? 'continuous' : 'paged');
    // 'off' hides the marks only; exposure/lookup evidence keeps flowing, since
    // the model should keep learning even when the marks are turned off.
    const levelMarkStyle = LEVEL_MARK_STYLES.includes(settings.levelMarkStyle)
        ? settings.levelMarkStyle
        : DEFAULT_READER_SETTINGS.levelMarkStyle;
    const levelMarksEnabled = levelMarkStyle !== 'off';
    const readerLevelTerms = useMemo(
        () => (levelMarksEnabled ? levelUnderlineTerms : EMPTY_LEVEL_TERMS),
        [levelMarksEnabled, levelUnderlineTerms]
    );
    // Legend gradient: interpolate the same three underline stops native draws
    // (easy → mid → hard) into a smooth bar, so the swatch matches the page.
    const underlineLegendColors = useMemo(
        () => buildLegendGradient(
            themeColors.readerLevelUnderlineEasy,
            themeColors.readerLevelUnderlineMid,
            themeColors.readerLevelUnderlineHard,
        ),
        [
            themeColors.readerLevelUnderlineEasy,
            themeColors.readerLevelUnderlineMid,
            themeColors.readerLevelUnderlineHard,
        ]
    );
    const focusPanelOpen = focusMode && !!highlightedWord;
    // Total height the lookup panel occupies from the bottom of the screen;
    // the native reading surface lifts by exactly this much.
    const focusPanelTotalHeight = focusPanelOpen
        ? Math.max(0, Math.round(lookupPanelHeight))
        : 0;
    const focusControlsBaseBottom = insets.bottom + 28;
    // The position pill rides at the top of the reading surface rather than the
    // bottom: the lit sentence rests low in the viewport, so anything anchored
    // to the bottom sits on top of it. FOCUS_SPAN_TOP_MARGIN_DP in the native
    // module reserves the matching strip of reading surface, so a sentence too
    // tall to fit still stops short of the pill instead of running under it.
    const focusPillTop = (isFullscreen ? insets.top : insets.top + spacing.xs + 52) + 12;
    // Arrow controls ride 12dp above the open panel, mirroring the 28 → panel+12
    // bottom shift in the design.
    const focusControlsLiftTarget = focusPanelOpen
        ? Math.max(0, focusPanelTotalHeight + 12 - focusControlsBaseBottom)
        : 0;
    const focusSwipeTrackColor = focusSwipeKnobAnim.interpolate({
        inputRange: [0, 1],
        outputRange: ['#d2d0d0', themeColors.inkSlate],
    });
    const focusSwipeKnobLeft = focusSwipeKnobAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [3, 21],
    });

    useEffect(() => {
        Animated.timing(focusControlsTranslate, {
            toValue: -focusControlsLiftTarget,
            duration: 450,
            easing: Easing.bezier(0.22, 0.61, 0.36, 1),
            useNativeDriver: true,
        }).start();
    }, [focusControlsLiftTarget, focusControlsTranslate]);

    useEffect(() => {
        Animated.timing(focusSwipeKnobAnim, {
            toValue: focusSwipe ? 1 : 0,
            duration: 250,
            useNativeDriver: false,
        }).start();
    }, [focusSwipe, focusSwipeKnobAnim]);

    const handleFocusSentenceChange = useCallback((event = {}) => {
        publishFocusInfo({
            index: Number.isInteger(event.index) ? event.index : 0,
            count: Number.isInteger(event.count) && event.count > 0 ? event.count : 1,
            total: Number.isInteger(event.total) ? event.total : 0,
        });
    }, [publishFocusInfo]);

    const sendFocusNav = useCallback((direction) => {
        // Preferred path: call straight into the native view. Routing through
        // the focusNavToken prop re-renders the entire reader screen before
        // the beam can move, which made arrow navigation feel sluggish.
        if (supportsImperativeFocusNav) {
            const viewTag = findNodeHandle(nativeReaderViewRef.current);
            if (viewTag != null) {
                sendFocusNavCommand(viewTag, direction).catch((error) => {
                    console.warn('[Read] Focus nav failed:', error?.message ?? error);
                });
                return;
            }
        }

        focusNavCounterRef.current += 1;
        setFocusNavToken(`${direction}:${focusNavCounterRef.current}`);
    }, []);

    const toggleFocusMode = useCallback(() => {
        // Persist any coalesced sentence-step position now, before the mode
        // switch emits page events in the other mode's geometry.
        flushPendingFocusPageChange();
        setShowMenu(false);
        setHighlightedWord('');
        setHighlightedWordContext(null);
        setIsNativeSelection(false);
        setClearSelectionToken((value) => value + 1);
        setFocusMode((current) => !current);
    }, [flushPendingFocusPageChange]);

    const handleFocusSpanStep = (direction) => {
        handleSettingChange(
            'focusSpan',
            Math.round(clampNumber(focusSpan + direction, FOCUS_SPAN_MIN, FOCUS_SPAN_MAX, DEFAULT_READER_SETTINGS.focusSpan))
        );
    };

    // Drives the options dropdown's open animation — it drops in from the
    // three-line menu icon (top-right) rather than sliding up as a bottom sheet.
    const menuAnim = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        if (showMenu && !isFullscreen) {
            menuAnim.setValue(0);
            Animated.timing(menuAnim, {
                toValue: 1,
                duration: 150,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }).start();
        }
    }, [showMenu, isFullscreen, menuAnim]);

    return (
        <View style={styles.container}>
            {!isFullscreen ? (
                <View style={[styles.headerBar, { paddingTop: insets.top + spacing.xs }]}>
                    <View style={styles.headerLeft}>
                        <TouchableOpacity
                            style={styles.headerIconButton}
                            onPress={toggleBookmark}
                            onLongPress={openBeforeYouGo}
                            accessibilityRole="button"
                            accessibilityState={{ selected: !!activeBookmark }}
                            accessibilityLabel={activeBookmark ? t('read.removeBookmark') : t('read.addBookmark')}
                        >
                            <MaterialIcons
                                name={activeBookmark ? 'bookmark' : 'bookmark-border'}
                                size={20}
                                color={activeBookmark ? themeColors.inkSlate : themeColors.textSecondary}
                            />
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={styles.savedButton}
                            onPress={() => openSavedPanel('saved')}
                            accessibilityRole="button"
                            accessibilityLabel={t('read.savedTab', { count: bookSavedWords.length })}
                        >
                            <MaterialCommunityIcons name="cards-outline" size={22} color={themeColors.textSecondary} />
                            {bookSavedWords.length > 0 ? (
                                <View style={styles.savedBadge}>
                                    <Text style={styles.savedBadgeText}>
                                        {bookSavedWords.length > 99 ? '99+' : bookSavedWords.length}
                                    </Text>
                                </View>
                            ) : null}
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={styles.headerIconButton}
                            onPress={toggleFocusMode}
                            accessibilityRole="button"
                            accessibilityState={{ selected: focusMode }}
                            accessibilityLabel={t('read.focusMode')}
                        >
                            <MaterialIcons
                                name="visibility"
                                size={21}
                                color={focusMode ? themeColors.inkSlate : themeColors.textSecondary}
                            />
                        </TouchableOpacity>
                    </View>

                    <View style={styles.headerSpacer} />

                    <View style={styles.headerControls}>
                        <Pressable
                            disabled={toc.length === 0}
                            onPress={() => setShowToc(true)}
                            accessibilityRole="button"
                            style={({ pressed }) => ([
                                styles.progressCluster,
                                toc.length === 0 && styles.progressClusterDisabled,
                                pressed && toc.length > 0 && styles.progressClusterPressed,
                            ])}
                        >
                            <View style={styles.progressTrack}>
                                <View style={[styles.progressFill, { width: progressFillWidth }]} />
                            </View>
                            <Text numberOfLines={1} style={styles.controlLabel}>{progressLabel}</Text>
                        </Pressable>
                        <TouchableOpacity
                            style={styles.headerIconButton}
                            onPress={() => setIsFullscreen(true)}
                            accessibilityRole="button"
                            accessibilityLabel={t('read.enterFullscreen')}
                        >
                            <Feather name="maximize" size={19} color={themeColors.textSecondary} />
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={styles.settingsButton}
                            onPress={() => setShowMenu((prev) => !prev)}
                            accessibilityRole="button"
                        >
                            <MaterialIcons name="menu" size={22} color={showMenu ? themeColors.inkSlate : themeColors.textSecondary} />
                        </TouchableOpacity>
                    </View>
                </View>
            ) : null}

            <View style={styles.reader}>
                {bookLoadState === 'error' ? (
                    <View style={styles.readerErrorState}>
                        <Text style={styles.readerErrorTitle}>{t('read.openErrorTitle')}</Text>
                        <Text style={styles.readerErrorBody}>{bookLoadError}</Text>
                        {typeof activeBookSizeMb === 'number' ? (
                            <Text style={styles.readerErrorMeta}>
                                {t('common.fileSize', { size: activeBookSizeMb.toFixed(1) })}
                            </Text>
                        ) : null}
                        <TouchableOpacity style={styles.retryButton} onPress={retryBookLoad}>
                            <Text style={styles.retryButtonText}>{t('common.tryAgain')}</Text>
                        </TouchableOpacity>
                    </View>
                ) : !currentBook ? (
                    <View style={styles.readerLoadingState}>
                        <Text style={styles.readerLoadingTitle}>{t('read.noBook')}</Text>
                    </View>
                ) : isReaderWaitingForHighlights ? (
                    <View style={styles.readerLoadingState}>
                        <ActivityIndicator size="small" color={themeColors.accentStrong} />
                        <Text style={styles.readerLoadingTitle}>{t('read.preparingHighlights')}</Text>
                        <Text style={styles.readerLoadingBody}>
                            {t('read.preparingHighlightsBody')}
                        </Text>
                    </View>
                ) : bookLoadState === 'loading' || !nativeReaderPackage ? (
                    <View style={styles.readerLoadingState}>
                        <ActivityIndicator size="small" color={themeColors.accentStrong} />
                        <Text style={styles.readerLoadingTitle}>{t('read.openingReader')}</Text>
                        <Text style={styles.readerLoadingBody}>
                            {t('read.openingReaderBody')}
                        </Text>
                    </View>
                ) : (
                    <NativeEpubReaderView
                        ref={nativeReaderViewRef}
                        key={`${currentBook}-${readerRetryKey}`}
                        style={styles.nativeReaderView}
                        bookManifest={nativeBookManifest}
                        chapterBlocks={nativeChapterBlocks}
                        chapterResources={nativeChapterResources}
                        chapterWindow={nativeChapterWindow}
                        restorePosition={nativeRestorePosition}
                        chapterTransitionDirection={chapterTransitionDirection}
                        fontSize={readerFontSize}
                        lineHeight={readerLineSpacing}
                        theme={isDarkMode ? 'dark' : 'light'}
                        themeTokens={nativeReaderThemeTokens}
                        renderMode={nativeRenderMode}
                        readerEdgeStateEnabled={false}
                        highlightTerms={readerHighlightTerms}
                        levelTerms={readerLevelTerms}
                        clearSelectionToken={clearSelectionToken}
                        focusSentenceCount={focusSpan}
                        focusSwipeEnabled={focusSwipe}
                        focusNavToken={focusNavToken}
                        focusPanelHeight={focusMode ? focusPanelTotalHeight : 0}
                        onPageChange={handleNativePageChange}
                        onChapterEnd={handleNativeChapterEnd}
                        onChapterStart={handleNativeChapterStart}
                        onChapterCommit={handleNativeChapterCommit}
                        onWordSelected={handleNativeWordSelected}
                        onTextSelected={handleNativeTextSelected}
                        onSelectionCleared={handleNativeSelectionCleared}
                        onFocusSentenceChange={handleFocusSentenceChange}
                        onExposure={handleNativeExposure}
                    />
                )}
                {readerBrightnessOverlayOpacity > 0 ? (
                    <View
                        pointerEvents="none"
                        style={[
                            styles.readerBrightnessOverlay,
                            {
                                backgroundColor: readerBrightnessOverlayColor,
                                opacity: readerBrightnessOverlayOpacity,
                            },
                        ]}
                    />
                ) : null}
            </View>

            <TocDrawer
                visible={showToc}
                toc={toc}
                currentSpineIndex={activeSpineIndex}
                totalSpineItems={nativeChapterTotal}
                bookProgress={bookProgress}
                isDarkMode={isDarkMode}
                onClose={() => setShowToc(false)}
                onSelect={(item) => {
                    if (!Number.isInteger(item?.spineIndex)) {
                        return;
                    }

                    setShowToc(false);
                    const firstPagePosition = {
                        spineIndex: item.spineIndex,
                        pageIndex: 0,
                        pagesInChapter: null,
                        href: item.path || item.href || '',
                        firstBlockId: null,
                    };

                    if (item.spineIndex !== activeSpineIndex) {
                        loadNativeReaderPackage(item.spineIndex, {
                            restorePosition: firstPagePosition,
                            animateChapterTransition: false,
                        });
                    } else {
                        updateNativeRestorePosition(firstPagePosition);
                    }
                }}
            />

            {focusMode && bookLoadState === 'ready' && nativeReaderPackage ? (
                <FocusControls
                    subscribe={subscribeFocusInfo}
                    focusSpan={focusSpan}
                    focusSwipe={focusSwipe}
                    sendFocusNav={sendFocusNav}
                    focusControlsTranslate={focusControlsTranslate}
                    focusControlsBaseBottom={focusControlsBaseBottom}
                    focusPillTop={focusPillTop}
                    styles={styles}
                    themeColors={themeColors}
                />
            ) : null}

            <View
                style={[
                    styles.lookupLayer,
                    shouldPlaceLookupAtTop ? styles.lookupLayerTop : styles.lookupLayerBottom,
                    shouldPlaceLookupAtTop
                        ? { paddingTop: isFullscreen ? 0 : insets.top + spacing.xs + 52 }
                        // Focus mode anchors the panel flush to the bottom edge; in
                        // regular reading the reader content already ends at the tab
                        // bar's top edge, so the panel sits flush against that. The
                        // safe-area gap is only needed in fullscreen, where neither
                        // the tab bar nor the focus panel is anchoring the bottom.
                        : { paddingBottom: isFullscreen && !focusMode ? insets.bottom + 6 : 0 },
                ]}
                pointerEvents="box-none"
            >
                <View
                    onLayout={(event) => {
                        setLookupPanelHeight(event?.nativeEvent?.layout?.height ?? 0);
                    }}
                    {...(shouldPlaceLookupAtTop ? {} : lookupPanResponder.panHandlers)}
                >
                    <TopSection
                        highlightedWord={highlightedWord}
                        sourceSentence={highlightedWordContext?.sentence ?? ''}
                        isNativeSelection={isNativeSelection}
                        placement={shouldPlaceLookupAtTop ? 'top' : 'bottom'}
                        isDarkMode={isDarkMode}
                        onClose={dismissLookup}
                        onWordSave={handleWordSave}
                        onWordUnsave={handleWordUnsave}
                        onSavedWordsChanged={refreshBookSavedWords}
                        currentBook={currentBook}
                        sourceBook={activeBook}
                        savedWords={savedWordsList}
                        translationVisualState={translationBannerVisualState}
                    />
                </View>
            </View>

            {!highlightedWord && showLookupHint ? (
                <View
                    pointerEvents="box-none"
                    style={[
                        styles.hintLayer,
                        {
                            paddingTop: isFullscreen
                                ? insets.top + 8
                                : insets.top + spacing.xs + 60,
                        },
                    ]}
                >
                    <View style={styles.hintCard}>
                        <View style={styles.hintCopy}>
                            <Feather name="corner-down-left" size={16} color={themeColors.textSubtle} />
                            <View style={styles.hintTextStack}>
                                <Text style={styles.hintText}>
                                    {t('read.tapHint')}
                                </Text>
                                <Text style={styles.hintSubtext}>
                                    {t('read.longPressHint')}
                                </Text>
                            </View>
                        </View>
                        <TouchableOpacity onPress={dismissLookupHint} style={styles.hintCloseButton}>
                            <Feather name="x" size={14} color={themeColors.textSubtle} />
                        </TouchableOpacity>
                    </View>
                </View>
            ) : null}

            {showMenu && !isFullscreen ? (
                <View pointerEvents="box-none" style={styles.settingsOverlay}>
                    <Pressable style={styles.settingsBackdrop} onPress={() => setShowMenu(false)} />
                    <Animated.View
                        pointerEvents="box-none"
                        style={[
                            styles.menuDropdownFrame,
                            {
                                top: insets.top + 48,
                                bottom: insets.bottom + 8,
                                opacity: menuAnim,
                                transform: [
                                    {
                                        translateY: menuAnim.interpolate({
                                            inputRange: [0, 1],
                                            outputRange: [-10, 0],
                                        }),
                                    },
                                    {
                                        scale: menuAnim.interpolate({
                                            inputRange: [0, 1],
                                            outputRange: [0.96, 1],
                                        }),
                                    },
                                ],
                            },
                        ]}
                    >
                        <View style={styles.optionsSheet}>
                            <ScrollView
                                showsVerticalScrollIndicator={false}
                                bounces={false}
                                contentContainerStyle={styles.optionsScrollContent}
                            >
                            <TouchableOpacity
                                style={styles.checkpointsRow}
                                onPress={openNotesLog}
                                activeOpacity={0.7}
                                accessibilityRole="button"
                            >
                                <View style={styles.checkpointsRowLeft}>
                                    <MaterialIcons name="bookmark-border" size={21} color={themeColors.readerBodyInk} />
                                    <Text style={styles.checkpointsLabel}>{t('read.checkpoints')}</Text>
                                </View>
                                <Feather name="chevron-right" size={20} color={themeColors.readerSubtleInk} />
                            </TouchableOpacity>

                            <View style={styles.optionsSectionHeader}>
                                <Text style={styles.optionsSectionTitle}>{t('read.bookSettings')}</Text>
                                <TouchableOpacity
                                    onPress={resetBookSettings}
                                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                                    accessibilityRole="button"
                                    accessibilityLabel={t('read.resetSection')}
                                >
                                    <Feather name="rotate-ccw" size={15} color={themeColors.readerSubtleInk} />
                                </TouchableOpacity>
                            </View>

                            <View style={styles.fontSettingsRows}>
                                <View style={styles.fontSettingsRow}>
                                    <Text style={styles.fontSettingsLabel}>{t('read.fontSize')}</Text>
                                    <View style={styles.fontSettingsStepperGroup}>
                                        <TouchableOpacity
                                            style={styles.fontSettingsStepperButton}
                                            onPress={() => handleFontSizeStep(-1)}
                                            activeOpacity={0.7}
                                            accessibilityRole="button"
                                            accessibilityLabel={t('read.decreaseFontSize')}
                                        >
                                            <Feather name="minus" size={18} color={themeColors.textSecondary} />
                                        </TouchableOpacity>
                                        <Text style={styles.fontSettingsValue}>{readerFontSize}</Text>
                                        <TouchableOpacity
                                            style={styles.fontSettingsStepperButton}
                                            onPress={() => handleFontSizeStep(1)}
                                            activeOpacity={0.7}
                                            accessibilityRole="button"
                                            accessibilityLabel={t('read.increaseFontSize')}
                                        >
                                            <Feather name="plus" size={18} color={themeColors.textSecondary} />
                                        </TouchableOpacity>
                                    </View>
                                </View>

                                <View style={styles.fontSettingsRow}>
                                    <Text style={styles.fontSettingsLabel}>{t('read.lineSpacing')}</Text>
                                    <View style={styles.fontSettingsStepperGroup}>
                                        <TouchableOpacity
                                            style={styles.fontSettingsStepperButton}
                                            onPress={() => handleLineSpacingStep(-1)}
                                            activeOpacity={0.7}
                                            accessibilityRole="button"
                                            accessibilityLabel={t('read.decreaseLineSpacing')}
                                        >
                                            <Feather name="minus" size={18} color={themeColors.textSecondary} />
                                        </TouchableOpacity>
                                        <Text style={[styles.fontSettingsValue, styles.fontSettingsLineSpacingValue]}>
                                            {activeLineSpacingLabel}
                                        </Text>
                                        <TouchableOpacity
                                            style={styles.fontSettingsStepperButton}
                                            onPress={() => handleLineSpacingStep(1)}
                                            activeOpacity={0.7}
                                            accessibilityRole="button"
                                            accessibilityLabel={t('read.increaseLineSpacing')}
                                        >
                                            <Feather name="plus" size={18} color={themeColors.textSecondary} />
                                        </TouchableOpacity>
                                    </View>
                                </View>

                                <View style={styles.fontSettingsRow}>
                                    <Text style={styles.fontSettingsLabel}>{t('read.brightness')}</Text>
                                    <View style={styles.fontSettingsBrightnessGroup}>
                                        <MaterialIcons name="light-mode" size={18} color={themeColors.readerSubtleInk} />
                                        <Slider
                                            style={styles.fontSettingsBrightnessSlider}
                                            value={readerBrightness}
                                            onValueChange={handleBrightnessChange}
                                            minimumValue={BRIGHTNESS_MIN}
                                            maximumValue={BRIGHTNESS_MAX}
                                            step={0.01}
                                            allowTouchTrack
                                            thumbTintColor={themeColors.readerProgressFill}
                                            minimumTrackTintColor={themeColors.readerProgressFill}
                                            maximumTrackTintColor={themeColors.readerHairline}
                                            trackStyle={styles.fontSettingsSliderTrack}
                                            thumbStyle={styles.fontSettingsSliderThumb}
                                            accessibilityLabel={t('read.readerBrightness')}
                                        />
                                    </View>
                                </View>

                                <View style={styles.fontSettingsRow}>
                                    <Text style={styles.fontSettingsLabel}>{t('read.readingDirection')}</Text>
                                    <View style={styles.segmentGroup}>
                                        <TouchableOpacity
                                            style={[styles.segmentButton, !isScrollMode && styles.segmentButtonActive]}
                                            onPress={() => handleSettingChange('readingMode', 'paged')}
                                            activeOpacity={0.7}
                                            accessibilityRole="button"
                                            accessibilityState={{ selected: !isScrollMode }}
                                        >
                                            <MaterialIcons
                                                name="swap-horiz"
                                                size={16}
                                                color={!isScrollMode ? themeColors.readerPaper : themeColors.textSecondary}
                                            />
                                            <Text style={[styles.segmentButtonText, !isScrollMode && styles.segmentButtonTextActive]} numberOfLines={1}>
                                                {t('read.readingHorizontal')}
                                            </Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={[styles.segmentButton, isScrollMode && styles.segmentButtonActive]}
                                            onPress={() => handleSettingChange('readingMode', 'scroll')}
                                            activeOpacity={0.7}
                                            accessibilityRole="button"
                                            accessibilityState={{ selected: isScrollMode }}
                                        >
                                            <MaterialIcons
                                                name="swap-vert"
                                                size={16}
                                                color={isScrollMode ? themeColors.readerPaper : themeColors.textSecondary}
                                            />
                                            <Text style={[styles.segmentButtonText, isScrollMode && styles.segmentButtonTextActive]} numberOfLines={1}>
                                                {t('read.readingVertical')}
                                            </Text>
                                        </TouchableOpacity>
                                    </View>
                                </View>

                                <View style={[styles.markStyleBlock, styles.fontSettingsLastRow]}>
                                    <Text style={styles.fontSettingsLabel}>{t('read.wordHighlighting')}</Text>
                                    <View style={styles.segmentGroup}>
                                        {LEVEL_MARK_OPTIONS.map(({ value, icon, labelKey }) => {
                                            const selected = levelMarkStyle === value;
                                            return (
                                                <TouchableOpacity
                                                    key={value}
                                                    style={[styles.segmentButton, selected && styles.segmentButtonActive]}
                                                    onPress={() => handleSettingChange('levelMarkStyle', value)}
                                                    activeOpacity={0.7}
                                                    accessibilityRole="button"
                                                    accessibilityState={{ selected }}
                                                >
                                                    <MaterialIcons
                                                        name={icon}
                                                        size={16}
                                                        color={selected ? themeColors.readerPaper : themeColors.textSecondary}
                                                    />
                                                    <Text
                                                        style={[styles.segmentButtonText, selected && styles.segmentButtonTextActive]}
                                                        numberOfLines={1}
                                                    >
                                                        {t(labelKey)}
                                                    </Text>
                                                </TouchableOpacity>
                                            );
                                        })}
                                    </View>

                                    {levelMarksEnabled ? (
                                        <View style={styles.underlineLegend}>
                                            <View style={styles.underlineLegendSwatches}>
                                                {underlineLegendColors.map((color, index) => (
                                                    <View
                                                        key={index}
                                                        style={[styles.underlineLegendSwatch, { backgroundColor: color }]}
                                                    />
                                                ))}
                                            </View>
                                            <View style={styles.underlineLegendLabels}>
                                                <Text style={styles.underlineLegendLabel}>{t('read.underlineNearly')}</Text>
                                                <Text style={[styles.underlineLegendLabel, styles.underlineLegendLabelEnd]}>
                                                    {t('read.underlineHard')}
                                                </Text>
                                            </View>
                                            <Text style={styles.underlineLegendHint}>{t('read.wordHighlightingHint')}</Text>
                                        </View>
                                    ) : null}
                                </View>
                            </View>

                            <View style={styles.optionsSectionHeader}>
                                <Text style={styles.optionsSectionTitle}>{t('read.focusModeSettings')}</Text>
                                <TouchableOpacity
                                    onPress={resetFocusSettings}
                                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                                    accessibilityRole="button"
                                    accessibilityLabel={t('read.resetSection')}
                                >
                                    <Feather name="rotate-ccw" size={15} color={themeColors.readerSubtleInk} />
                                </TouchableOpacity>
                            </View>

                            <View style={styles.fontSettingsRows}>
                                <View style={styles.fontSettingsRow}>
                                    <Text style={styles.fontSettingsLabel}>{t('read.focusNavigate')}</Text>
                                    <View style={styles.segmentGroup}>
                                        <TouchableOpacity
                                            style={[styles.segmentButton, focusSwipe && styles.segmentButtonActive]}
                                            onPress={() => handleSettingChange('focusSwipe', true)}
                                            activeOpacity={0.7}
                                            accessibilityRole="button"
                                            accessibilityState={{ selected: focusSwipe }}
                                        >
                                            <MaterialIcons
                                                name="gesture"
                                                size={16}
                                                color={focusSwipe ? themeColors.readerPaper : themeColors.textSecondary}
                                            />
                                            <Text style={[styles.segmentButtonText, focusSwipe && styles.segmentButtonTextActive]} numberOfLines={1}>
                                                {t('read.focusNavSwipe')}
                                            </Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={[styles.segmentButton, !focusSwipe && styles.segmentButtonActive]}
                                            onPress={() => handleSettingChange('focusSwipe', false)}
                                            activeOpacity={0.7}
                                            accessibilityRole="button"
                                            accessibilityState={{ selected: !focusSwipe }}
                                        >
                                            <MaterialIcons
                                                name="touch-app"
                                                size={16}
                                                color={!focusSwipe ? themeColors.readerPaper : themeColors.textSecondary}
                                            />
                                            <Text style={[styles.segmentButtonText, !focusSwipe && styles.segmentButtonTextActive]} numberOfLines={1}>
                                                {t('read.focusNavButtons')}
                                            </Text>
                                        </TouchableOpacity>
                                    </View>
                                </View>

                                <View style={[styles.fontSettingsRow, styles.fontSettingsLastRow]}>
                                    <Text style={styles.fontSettingsLabel}>{t('read.focusSpan')}</Text>
                                    <View style={styles.fontSettingsStepperGroup}>
                                        <TouchableOpacity
                                            style={[
                                                styles.fontSettingsStepperButton,
                                                focusSpan <= FOCUS_SPAN_MIN && styles.focusStepperDisabled,
                                            ]}
                                            onPress={() => handleFocusSpanStep(-1)}
                                            activeOpacity={0.7}
                                            accessibilityRole="button"
                                        >
                                            <Feather name="minus" size={18} color={themeColors.textSecondary} />
                                        </TouchableOpacity>
                                        <Text style={styles.fontSettingsValue}>{focusSpan}</Text>
                                        <TouchableOpacity
                                            style={[
                                                styles.fontSettingsStepperButton,
                                                focusSpan >= FOCUS_SPAN_MAX && styles.focusStepperDisabled,
                                            ]}
                                            onPress={() => handleFocusSpanStep(1)}
                                            activeOpacity={0.7}
                                            accessibilityRole="button"
                                        >
                                            <Feather name="plus" size={18} color={themeColors.textSecondary} />
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            </View>
                            </ScrollView>
                        </View>
                    </Animated.View>
                </View>
            ) : null}

            <SavedWordsPanel
                visible={showSavedPanel}
                colors={themeColors}
                insets={insets}
                initialTab={savedPanelTab}
                savedWords={bookSavedWords}
                candidates={panelCandidates}
                candidatesLoading={panelCandidatesLoading}
                savedStems={panelSavedStems}
                onSaveCandidate={handleSaveCandidate}
                onClose={() => setShowSavedPanel(false)}
            />

            <BeforeYouGoSheet
                visible={showBeforeYouGo}
                colors={themeColors}
                insets={insets}
                onSaveNote={handleSaveNote}
                onClose={() => setShowBeforeYouGo(false)}
            />

            <NotesLogSheet
                visible={showNotesLog}
                colors={themeColors}
                insets={insets}
                bookmarks={bookBookmarks}
                notes={bookNotes}
                onSelectBookmark={handleSelectBookmark}
                onDeleteBookmark={handleDeleteBookmark}
                onDelete={handleDeleteNote}
                onClose={() => setShowNotesLog(false)}
            />

        </View>
    );
};

const createStyles = (themeColors) => StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: themeColors.readerPaper,
    },
    headerBar: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 16,
        paddingBottom: 10,
        backgroundColor: themeColors.readerPaper,
        borderBottomWidth: 1,
        borderBottomColor: themeColors.readerHairline,
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    headerIconButton: {
        width: 30,
        height: 42,
        alignItems: 'center',
        justifyContent: 'center',
    },
    savedButton: {
        width: 34,
        height: 42,
        alignItems: 'center',
        justifyContent: 'center',
    },
    savedBadge: {
        position: 'absolute',
        top: 3,
        right: -1,
        minWidth: 16,
        height: 16,
        borderRadius: 8,
        paddingHorizontal: 4,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: themeColors.inkSlate,
        borderWidth: 1.5,
        borderColor: themeColors.readerPaper,
    },
    savedBadgeText: {
        fontFamily: 'FFSans-Bold',
        fontSize: 10,
        lineHeight: 12,
        color: themeColors.readerPaper,
    },
    headerSpacer: {
        flex: 1,
    },
    headerControls: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    progressCluster: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        minHeight: 42,
        borderRadius: radii.pill,
    },
    progressClusterPressed: {
        opacity: 0.7,
    },
    progressClusterDisabled: {
        opacity: 1,
    },
    fullscreenToggleLayer: {
        position: 'absolute',
        right: spacing.lg,
    },
    fullscreenToggleButton: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 22,
        backgroundColor: themeColors.transparent,
    },
    progressTrack: {
        width: 60,
        height: 3,
        borderRadius: 2,
        backgroundColor: themeColors.readerProgressTrack,
        overflow: 'hidden',
    },
    progressFill: {
        height: '100%',
        borderRadius: 2,
        backgroundColor: themeColors.readerProgressFill,
    },
    controlLabel: {
        fontFamily: 'FFSans-Medium',
        fontSize: 13,
        lineHeight: 17,
        color: themeColors.readerMutedInk,
        minWidth: 33,
        textAlign: 'right',
        fontVariant: ['tabular-nums'],
    },
    reader: {
        flex: 1,
        position: 'relative',
    },
    nativeReaderView: {
        flex: 1,
        backgroundColor: themeColors.readerPaper,
    },
    readerBrightnessOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: '#000000',
    },
    readerErrorState: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: spacing.xl,
        gap: spacing.md,
    },
    readerErrorTitle: {
        ...textStyles.title,
        color: themeColors.readerBodyInk,
        textAlign: 'center',
    },
    readerErrorBody: {
        ...textStyles.bodyMuted,
        color: themeColors.readerMutedInk,
        textAlign: 'center',
    },
    readerErrorMeta: {
        ...textStyles.caption,
        color: themeColors.readerSubtleInk,
        textAlign: 'center',
    },
    readerLoadingState: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: spacing.xl,
        gap: spacing.sm,
    },
    readerLoadingTitle: {
        ...textStyles.label,
        textAlign: 'center',
        color: themeColors.readerBodyInk,
    },
    readerLoadingBody: {
        ...textStyles.caption,
        textAlign: 'center',
        color: themeColors.readerMutedInk,
        maxWidth: 280,
    },
    retryButton: {
        minWidth: 132,
        minHeight: 44,
        borderRadius: radii.pill,
        backgroundColor: themeColors.readerSavedChipBg,
        paddingHorizontal: spacing.lg,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: themeColors.readerBorder,
        marginTop: spacing.sm,
    },
    retryButtonText: {
        ...textStyles.body,
        color: themeColors.readerSavedChipText,
    },
    lookupLayer: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
    },
    lookupLayerTop: {
        justifyContent: 'flex-start',
    },
    lookupLayerBottom: {
        justifyContent: 'flex-end',
    },
    lookupDismissZone: {
        ...StyleSheet.absoluteFillObject,
    },
    hintLayer: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        paddingHorizontal: spacing.md,
    },
    hintCard: {
        borderRadius: radii.pill,
        backgroundColor: themeColors.surfaceElevated,
        borderWidth: 1,
        borderColor: themeColors.border,
        paddingLeft: spacing.md,
        paddingRight: spacing.sm,
        paddingVertical: spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.sm,
    },
    hintCopy: {
        flex: 1,
        minWidth: 0,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
    },
    hintText: {
        ...textStyles.caption,
        color: themeColors.textSubtle,
        flexShrink: 1,
    },
    hintTextStack: {
        flex: 1,
        minWidth: 0,
        gap: 2,
    },
    hintSubtext: {
        ...textStyles.caption,
        color: themeColors.textSubtle,
        flexShrink: 1,
    },
    hintCloseButton: {
        width: 24,
        height: 24,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    settingsButton: {
        width: 20,
        height: 42,
        borderRadius: 0,
        backgroundColor: themeColors.transparent,
        justifyContent: 'center',
        alignItems: 'center',
    },
    menuDropdown: {
        position: 'absolute',
        width: 184,
        backgroundColor: themeColors.surface,
        borderWidth: 1,
        borderColor: themeColors.border,
        borderRadius: 4,
        overflow: 'hidden',
    },
    menuItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 11,
        paddingVertical: 13,
        paddingHorizontal: 16,
    },
    menuItemBorder: {
        borderBottomWidth: 1,
        borderBottomColor: themeColors.divider,
    },
    menuItemLabel: {
        fontFamily: textStyles.body.fontFamily,
        fontSize: 14,
        color: themeColors.text,
    },
    menuItemLabelActive: {
        color: themeColors.inkSlate,
        fontFamily: 'FFSans-SemiBold',
    },
    focusControlsLeft: {
        position: 'absolute',
        left: 22,
        zIndex: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    focusPositionPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: `${themeColors.readerPaper}EB`,
        paddingVertical: 4,
        paddingHorizontal: 10,
        borderRadius: radii.pill,
    },
    focusPositionLabel: {
        fontFamily: 'FFSans-SemiBold',
        fontSize: 10,
        lineHeight: 14,
        letterSpacing: 1.4,
        color: themeColors.readerSubtleInk,
    },
    focusArrowControls: {
        position: 'absolute',
        right: 16,
        zIndex: 12,
        flexDirection: 'column',
        gap: 9,
    },
    focusArrowButtonPrev: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: themeColors.readerSurface,
        borderWidth: 1,
        borderColor: themeColors.readerBorder,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: 'rgba(27, 28, 28, 0.12)',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 4,
    },
    focusArrowButtonNext: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: themeColors.inkSlate,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: 'rgba(27, 28, 28, 0.20)',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 5,
    },
    focusSwipeTrack: {
        width: 44,
        height: 26,
        borderRadius: radii.pill,
    },
    focusSwipeKnob: {
        position: 'absolute',
        top: 3,
        width: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: '#ffffff',
        shadowColor: 'rgba(27, 28, 28, 0.25)',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 1,
        shadowRadius: 3,
        elevation: 2,
    },
    focusStepperDisabled: {
        opacity: 0.35,
    },
    settingsOverlay: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 25,
        elevation: 25,
    },
    settingsBackdrop: {
        ...StyleSheet.absoluteFillObject,
    },
    fontSettingsSheetFrame: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: 'center',
        paddingHorizontal: 14,
    },
    fontSettingsSheet: {
        width: '100%',
        maxWidth: 360,
        backgroundColor: themeColors.readerSurface,
        borderWidth: 1,
        borderColor: themeColors.readerBorder,
        borderRadius: radii.xl,
        paddingTop: 14,
        paddingHorizontal: 24,
        paddingBottom: 26,
        shadowColor: 'rgba(27, 28, 28, 0.08)',
        shadowOffset: { width: 0, height: -10 },
        shadowOpacity: 1,
        shadowRadius: 30,
        elevation: 8,
    },
    menuDropdownFrame: {
        position: 'absolute',
        left: 14,
        right: 14,
        alignItems: 'flex-end',
    },
    optionsSheet: {
        width: '100%',
        maxWidth: 320,
        maxHeight: '100%',
        backgroundColor: themeColors.readerSurface,
        borderWidth: 1,
        borderColor: themeColors.readerBorder,
        borderRadius: radii.lg,
        paddingHorizontal: 22,
        shadowColor: 'rgba(27, 28, 28, 0.18)',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 1,
        shadowRadius: 28,
        elevation: 12,
    },
    optionsScrollContent: {
        paddingTop: 6,
        paddingBottom: 20,
    },
    checkpointsRow: {
        marginTop: 12,
        height: 52,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    checkpointsRowLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    checkpointsLabel: {
        fontFamily: 'FFSans-SemiBold',
        fontSize: 16,
        lineHeight: 21,
        color: themeColors.readerBodyInk,
    },
    optionsSectionHeader: {
        marginTop: 18,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    optionsSectionTitle: {
        fontFamily: 'FFSans-SemiBold',
        fontSize: 12,
        lineHeight: 16,
        letterSpacing: 1.1,
        textTransform: 'uppercase',
        color: themeColors.textSecondary,
    },
    segmentGroup: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 8,
    },
    segmentButton: {
        flex: 1,
        minWidth: 0,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: 7,
        paddingHorizontal: 10,
        borderRadius: radii.sm,
        borderWidth: 1,
        borderColor: themeColors.readerBorder,
        backgroundColor: themeColors.readerSurface,
    },
    segmentButtonActive: {
        backgroundColor: themeColors.inkSlate,
        borderColor: themeColors.inkSlate,
    },
    segmentButtonText: {
        fontFamily: 'FFSans-Medium',
        fontSize: 13,
        lineHeight: 17,
        color: themeColors.textSecondary,
    },
    segmentButtonTextActive: {
        color: themeColors.readerPaper,
        fontFamily: 'FFSans-SemiBold',
    },
    fontSettingsHandleWrap: {
        alignItems: 'center',
    },
    fontSettingsHandle: {
        width: 36,
        height: 4,
        borderRadius: 2,
        backgroundColor: themeColors.readerBorder,
    },
    fontSettingsTitle: {
        marginTop: 18,
        fontFamily: 'FFDisplay-Regular',
        fontSize: 13,
        lineHeight: 17,
        letterSpacing: 3,
        color: themeColors.textSecondary,
        textAlign: 'center',
    },
    fontSettingsRows: {
        marginTop: 16,
    },
    fontSettingsRow: {
        height: 48,
        borderTopWidth: 1,
        borderTopColor: themeColors.readerHairline,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
    },
    fontSettingsLastRow: {
        borderBottomWidth: 1,
        borderBottomColor: themeColors.readerHairline,
    },
    fontSettingsLabel: {
        fontFamily: 'FFSans-Regular',
        fontSize: 15,
        lineHeight: 20,
        color: themeColors.readerBodyInk,
        flexShrink: 0,
    },
    markStyleBlock: {
        borderTopWidth: 1,
        borderTopColor: themeColors.readerHairline,
        paddingVertical: 12,
        gap: 10,
    },
    underlineLegend: {
        paddingTop: 2,
        paddingBottom: 2,
        gap: 6,
    },
    underlineLegendSwatches: {
        flexDirection: 'row',
        height: 4,
        borderRadius: 2,
        overflow: 'hidden',
    },
    underlineLegendSwatch: {
        flex: 1,
        height: '100%',
    },
    underlineLegendLabels: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    underlineLegendLabel: {
        fontFamily: 'FFSans-Regular',
        fontSize: 12,
        lineHeight: 16,
        color: themeColors.readerSubtleInk,
    },
    underlineLegendLabelEnd: {
        textAlign: 'right',
    },
    underlineLegendHint: {
        fontFamily: 'FFSans-Regular',
        fontSize: 12,
        lineHeight: 17,
        color: themeColors.readerSubtleInk,
    },
    fontSettingsStepperGroup: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    fontSettingsStepperButton: {
        width: 30,
        height: 30,
        borderWidth: 1,
        borderColor: themeColors.readerBorder,
        borderRadius: radii.sm,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: themeColors.readerSurface,
    },
    fontSettingsValue: {
        minWidth: 22,
        fontFamily: 'FFSans-Regular',
        fontSize: 15,
        lineHeight: 20,
        color: themeColors.readerBodyInk,
        textAlign: 'center',
    },
    fontSettingsLineSpacingValue: {
        minWidth: 80,
    },
    fontSettingsBrightnessGroup: {
        width: 150,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    fontSettingsBrightnessSlider: {
        flex: 1,
        height: 30,
    },
    fontSettingsSliderTrack: {
        height: 3,
        borderRadius: 2,
    },
    fontSettingsSliderThumb: {
        width: 16,
        height: 16,
        borderRadius: 8,
        borderWidth: 2,
        borderColor: themeColors.readerSurface,
        backgroundColor: themeColors.readerProgressFill,
        shadowColor: themeColors.readerBorder,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 1,
        elevation: 2,
    },
});

export default Read;
