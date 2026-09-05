import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useTranslation } from '../../../hooks/useTranslation';
import { useAppContext } from '../../../contexts/AppContext';
import {
    normalizeBookLanguage,
    normalizeInterfaceLanguageCode,
    getInterfaceLanguageLabel,
    getLanguageLabel,
} from '../../../constants/languages';
import { fontFamilies, spacing, useTheme } from '../../../theme';
import TranslationContent from './TranslationContent';
import DictionaryContent from './DictionaryContent';

const DICTIONARY_COMPACT_HEIGHT = 252;
const DICTIONARY_NO_ROOT_HEIGHT = 215;
// Chinese has no related-roots handle, but it does pack multiple readings + numbered
// senses inline, so it gets a taller compact ceiling to show them at a glance.
const DICTIONARY_ZH_HEIGHT = 316;
const DICTIONARY_TRANSLATION_HEIGHT = 332;
const DICTIONARY_EXPLAIN_HEIGHT = 360;
const DICTIONARY_EXPANDED_MAX_HEIGHT = 548;
const DICTIONARY_EXTRA_ROW_HEIGHT = 52;
const TRANSLATION_MAX_SCROLL_HEIGHT = 150;
const TRANSLATION_PANEL_BOTTOM_PADDING = 22;
const TOP_PLACEMENT_DICTIONARY_TOP_PADDING = 22;
const TOP_PLACEMENT_DICTIONARY_BOTTOM_PADDING = 8;
const TOP_PLACEMENT_TRANSLATION_TOP_PADDING = 22;
const TOP_PLACEMENT_TRANSLATION_BOTTOM_PADDING = 10;

const TopSection = ({
    highlightedWord,
    sourceSentence = '',
    isNativeSelection,
    placement = 'bottom',
    isDarkMode,
    onClose,
    onWordSave,
    onWordUnsave,
    onSavedWordsChanged,
    currentBook,
    sourceBook,
    savedWords,
    translationVisualState = {},
}) => {
    const { t } = useTranslation();
    const { colors: themeColors } = useTheme();
    const styles = useMemo(() => createStyles(themeColors), [themeColors]);
    const { interfaceLanguage, targetLanguage: activeTargetLanguage } = useAppContext();
    const [dictionaryExpandedRows, setDictionaryExpandedRows] = useState(0);
    const [dictionaryContentHeight, setDictionaryContentHeight] = useState(0);
    const [visibleWord, setVisibleWord] = useState('');
    const [translationTarget, setTranslationTarget] = useState('');
    const [isCopied, setIsCopied] = useState(false);
    const [isCopying, setIsCopying] = useState(false);
    const [isLookupExpanded, setIsLookupExpanded] = useState(false);
    const [isExplainMode, setIsExplainMode] = useState(false);
    const [canExpandLookup, setCanExpandLookup] = useState(false);
    const [translationStatus, setTranslationStatus] = useState({
        isLoading: false,
        hasError: false,
        hasText: false,
        translatedText: '',
    });
    const copyTimeoutRef = useRef(null);
    const prevWordRef = useRef('');
    const canExpandLookupRef = useRef(false);
    const placementRef = useRef(placement);
    const translateY = useRef(new Animated.Value(24)).current;
    const opacity = useRef(new Animated.Value(0)).current;
    const panResponder = useRef(PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) => (
            canExpandLookupRef.current
            &&
            Math.abs(gestureState.dy) > 12
            && Math.abs(gestureState.dy) > Math.abs(gestureState.dx)
        ),
        onPanResponderRelease: (_, gestureState) => {
            if (!canExpandLookupRef.current) {
                return;
            }

            const shouldExpand = placementRef.current === 'top'
                ? gestureState.dy > 28
                : gestureState.dy < -28;
            const shouldCollapse = placementRef.current === 'top'
                ? gestureState.dy < -28
                : gestureState.dy > 28;

            if (shouldExpand) {
                setIsLookupExpanded(true);
                return;
            }

            if (shouldCollapse) {
                setIsLookupExpanded(false);
            }
        },
    })).current;

    useEffect(() => {
        placementRef.current = placement;
    }, [placement]);

    useEffect(() => {
        if (highlightedWord && highlightedWord !== prevWordRef.current) {
            prevWordRef.current = highlightedWord;
            setDictionaryExpandedRows(0);
            setDictionaryContentHeight(0);
            setTranslationTarget('');
            setIsLookupExpanded(false);
            setIsExplainMode(false);
            setCanExpandLookup(false);
            setTranslationStatus({ isLoading: false, hasError: false, hasText: false, translatedText: '' });
            setIsCopied(false);
            setIsCopying(false);
        }
    }, [highlightedWord]);

    useEffect(() => {
        canExpandLookupRef.current = canExpandLookup;
        if (!canExpandLookup) {
            setIsLookupExpanded(false);
        }
    }, [canExpandLookup]);

    useEffect(() => () => {
        if (copyTimeoutRef.current) {
            clearTimeout(copyTimeoutRef.current);
        }
    }, []);

    useEffect(() => {
        if (highlightedWord) {
            setVisibleWord(highlightedWord);
            Animated.parallel([
                Animated.timing(translateY, {
                    toValue: 0,
                    duration: 240,
                    easing: Easing.out(Easing.cubic),
                    useNativeDriver: true,
                }),
                Animated.timing(opacity, {
                    toValue: 1,
                    duration: 240,
                    easing: Easing.out(Easing.quad),
                    useNativeDriver: true,
                }),
            ]).start();
            return;
        }

        prevWordRef.current = '';
        Animated.parallel([
            Animated.timing(translateY, {
                toValue: 24,
                duration: 180,
                easing: Easing.in(Easing.cubic),
                useNativeDriver: true,
            }),
            Animated.timing(opacity, {
                toValue: 0,
                duration: 180,
                easing: Easing.in(Easing.quad),
                useNativeDriver: true,
            }),
        ]).start(({ finished }) => {
            if (finished) {
                setVisibleWord('');
            }
        });
    }, [highlightedWord, opacity, translateY]);

    const handleDictionaryExpandedStateChange = useCallback((rowCount) => {
        const nextRowCount = Number.isFinite(rowCount) ? rowCount : 0;
        setDictionaryExpandedRows((previousRowCount) => {
            if (previousRowCount !== nextRowCount) {
                setDictionaryContentHeight(0);
            }

            return nextRowCount;
        });
    }, []);

    const handleTranslationStatusChange = useCallback((nextStatus) => {
        setTranslationStatus((previousStatus) => {
            const normalizedStatus = {
                isLoading: Boolean(nextStatus?.isLoading),
                hasError: Boolean(nextStatus?.hasError),
                hasText: Boolean(nextStatus?.hasText),
                translatedText: typeof nextStatus?.translatedText === 'string' ? nextStatus.translatedText : '',
            };

            if (
                previousStatus.isLoading === normalizedStatus.isLoading &&
                previousStatus.hasError === normalizedStatus.hasError &&
                previousStatus.hasText === normalizedStatus.hasText &&
                previousStatus.translatedText === normalizedStatus.translatedText
            ) {
                return previousStatus;
            }

            return normalizedStatus;
        });
    }, []);

    if (!visibleWord) {
        return null;
    }

    const isTranslationMode = isNativeSelection;
    const isTopPlacement = placement === 'top';
    const panelColors = {
        background: themeColors.readerSurface,
        border: themeColors.readerBorder,
        text: themeColors.readerBodyInk,
        accent: themeColors.readerProgressFill,
        closeIcon: themeColors.readerSubtleInk,
    };

    const isDictionaryTranslationSheet = dictionaryExpandedRows === -1;
    const expandedFallbackHeight = DICTIONARY_COMPACT_HEIGHT + (Math.max(dictionaryExpandedRows, 0) * DICTIONARY_EXTRA_ROW_HEIGHT);
    const expandedContentHeight = dictionaryContentHeight > 0
        ? Math.ceil(dictionaryContentHeight)
        : expandedFallbackHeight;
    const isDictionarySheetTall = isLookupExpanded || dictionaryExpandedRows > 0;
    // Compact sheets hug their measured content so a short (one-line) definition
    // doesn't leave dead space above the action buttons. The definition itself is
    // capped at two rows and scrolls inside DictionaryContent, so the measured
    // content never grows past the fixed ceiling below. `compactChrome` is the
    // non-scrolling height around the definition (handle + action row + padding),
    // which varies with placement and whether the roots handle is shown.
    const dictionaryBookLanguage = normalizeBookLanguage(
        sourceBook?.language ?? activeTargetLanguage ?? 'ko'
    );
    const isChineseDictionarySheet = dictionaryBookLanguage === 'zh';
    const compactCeiling = isChineseDictionarySheet
        ? DICTIONARY_ZH_HEIGHT
        : (canExpandLookup ? DICTIONARY_COMPACT_HEIGHT : DICTIONARY_NO_ROOT_HEIGHT);
    const compactChrome = isTopPlacement
        ? (canExpandLookup ? 124 : 104)
        : (canExpandLookup ? 132 : 112);
    const compactHeight = dictionaryContentHeight > 0
        ? Math.min(compactCeiling, Math.ceil(dictionaryContentHeight) + compactChrome)
        : compactCeiling;
    const dictionaryHeight = isDictionaryTranslationSheet
        ? DICTIONARY_TRANSLATION_HEIGHT
        : isExplainMode
        // Smart-definition mode uses a fixed, modest height; the body ScrollView
        // scrolls when the explanation is long, so we never leave dead space.
        ? DICTIONARY_EXPLAIN_HEIGHT
        : isDictionarySheetTall
        ? Math.min(
            DICTIONARY_EXPANDED_MAX_HEIGHT,
            Math.max(DICTIONARY_EXPANDED_MAX_HEIGHT, expandedContentHeight)
        )
        : compactHeight;
    const translationText = translationTarget || visibleWord;
    const translationSourceLanguage = dictionaryBookLanguage;
    const translationTargetLanguage = normalizeInterfaceLanguageCode(interfaceLanguage);
    // The source is the book/target language (ko, zh) — use the target-language
    // label map, not the interface-language one, which would fall back to
    // English for any code (like 'ko') that isn't a supported UI language.
    const translationSourceLabel = getLanguageLabel(translationSourceLanguage);
    const translationTargetLabel = getInterfaceLanguageLabel(translationTargetLanguage);
    const sheetSizeStyle = isTranslationMode
        ? styles.sheetTranslation
        : { height: dictionaryHeight };
    const sheetBottomPadding = isTranslationMode
        ? (isTopPlacement ? TOP_PLACEMENT_TRANSLATION_BOTTOM_PADDING : TRANSLATION_PANEL_BOTTOM_PADDING)
        : (isTopPlacement ? TOP_PLACEMENT_DICTIONARY_BOTTOM_PADDING : 26);
    const forceTranslationLoading = Boolean(translationVisualState.loading);
    const forceTranslationError = Boolean(translationVisualState.error);
    const forceTranslationCopied = Boolean(translationVisualState.copied);
    const isTranslationBusy = isTranslationMode && (forceTranslationLoading || translationStatus.isLoading);
    const hasTranslationError = isTranslationMode && (forceTranslationError || translationStatus.hasError);
    const copyableTranslationText = translationStatus.translatedText.trim();
    const canCopyTranslation = isTranslationMode && !isTranslationBusy && !hasTranslationError && Boolean(copyableTranslationText);
    const isCopyConfirmed = isCopied || forceTranslationCopied;

    const handleCopy = async () => {
        if (isCopied || isCopying || !canCopyTranslation) {
            return;
        }

        setIsCopying(true);
        try {
            await Clipboard.setStringAsync(copyableTranslationText);
            setIsCopied(true);
            if (copyTimeoutRef.current) {
                clearTimeout(copyTimeoutRef.current);
            }
            copyTimeoutRef.current = setTimeout(() => {
                setIsCopied(false);
            }, 1800);
        } catch (error) {
            console.warn('[TopSection] Failed to copy translation', error);
        } finally {
            setIsCopying(false);
        }
    };

    return (
        <Animated.View
            style={[
                styles.sheet,
                isTopPlacement && styles.sheetTop,
                !isTranslationMode ? styles.sheetDictionary : styles.sheetTranslationBase,
                isTopPlacement && !isTranslationMode && styles.sheetDictionaryTop,
                isTopPlacement && isTranslationMode && styles.sheetTranslationTop,
                sheetSizeStyle,
                { paddingBottom: sheetBottomPadding },
                { backgroundColor: panelColors.background, borderColor: panelColors.border },
                {
                    opacity,
                    transform: [{ translateY }],
                },
            ]}
        >
            {isTranslationMode ? (
                <View style={styles.translationHeader}>
                    <View style={styles.translationHeaderLeft}>
                        <MaterialIcons name="translate" size={16} color={themeColors.readerSubtleInk} />
                        <Text numberOfLines={1} style={[styles.translationLangText, { color: themeColors.readerMutedInk }]}>
                            {translationSourceLabel} → {translationTargetLabel}
                        </Text>
                    </View>
                    {canCopyTranslation ? (
                        <TouchableOpacity
                            accessibilityRole="button"
                            accessibilityLabel={isCopyConfirmed ? t('lookup.copied') : t('lookup.copy')}
                            activeOpacity={0.75}
                            onPress={handleCopy}
                            style={styles.copyButton}
                        >
                            {isCopyConfirmed ? (
                                <MaterialIcons name="check" size={13} color={panelColors.closeIcon} style={styles.copyIcon} />
                            ) : null}
                            <Text style={[styles.copyLabel, { color: panelColors.closeIcon }]}>
                                {isCopyConfirmed ? t('lookup.copied') : t('lookup.copy')}
                            </Text>
                        </TouchableOpacity>
                    ) : null}
                </View>
            ) : null}

            {!isTopPlacement && !isTranslationMode && canExpandLookup ? (
                <View style={styles.sheetHandleWrap} {...panResponder.panHandlers}>
                    <View style={styles.sheetHandle} />
                    {!isLookupExpanded ? (
                        <Text style={styles.sheetGestureHint}>
                            {t(isChineseDictionarySheet ? 'read.slideUpForChars' : 'read.slideUpForRoots')}
                        </Text>
                    ) : null}
                </View>
            ) : null}

            {!isTopPlacement && !isTranslationMode && !canExpandLookup ? (
                <View style={styles.sheetHandleStatic}>
                    <View style={styles.sheetHandle} />
                </View>
            ) : null}

            <View style={isTranslationMode ? styles.contentTranslation : styles.content}>
                {!isTranslationMode ? (
                    <DictionaryContent
                        highlightedWord={visibleWord}
                        sourceSentence={sourceSentence}
                        isDarkMode={isDarkMode}
                        onWordSave={onWordSave}
                        onWordUnsave={onWordUnsave}
                        onSavedWordsChanged={onSavedWordsChanged}
                        onTranslatePress={(text) => {
                            const target = typeof text === 'string' && text.trim() ? text.trim() : visibleWord;
                            setTranslationTarget(target);
                        }}
                        onExpandedStateChange={handleDictionaryExpandedStateChange}
                        onExplainModeChange={setIsExplainMode}
                        onContentHeightChange={setDictionaryContentHeight}
                        onCanExpandChange={setCanExpandLookup}
                        isPanelExpanded={isLookupExpanded}
                        currentBook={currentBook}
                        sourceBook={sourceBook}
                        savedWords={savedWords}
                    />
                ) : (
                    <TranslationContent
                        key={`${translationText}-${translationSourceLanguage}-${translationTargetLanguage}-translation`}
                        highlightedWord={translationText}
                        isDarkMode={isDarkMode}
                        sourceLanguage={translationSourceLanguage}
                        targetLanguage={translationTargetLanguage}
                        compact
                        forceLoading={forceTranslationLoading}
                        forceError={forceTranslationError}
                        forceErrorMessage={translationVisualState.errorMessage}
                        forceTranslatedText={translationVisualState.translatedText}
                        maxScrollHeight={TRANSLATION_MAX_SCROLL_HEIGHT}
                        bottomPadding={spacing.sm}
                        nestedScrollEnabled
                        onStatusChange={handleTranslationStatusChange}
                    />
                )}

            </View>
            {isTopPlacement && !isTranslationMode && canExpandLookup ? (
                <View style={styles.sheetHandleWrapBottom} {...panResponder.panHandlers}>
                    {!isLookupExpanded ? (
                        <Text style={styles.sheetGestureHint}>
                            {t(isChineseDictionarySheet ? 'read.slideDownForChars' : 'read.slideDownForRoots')}
                        </Text>
                    ) : null}
                    <View style={styles.sheetHandle} />
                </View>
            ) : null}

            {isTopPlacement && !isTranslationMode && !canExpandLookup ? (
                <View style={styles.sheetHandleStaticBottom}>
                    <View style={styles.sheetHandle} />
                </View>
            ) : null}
        </Animated.View>
    );
};

const createStyles = (colors) => StyleSheet.create({
    sheet: {
        marginHorizontal: 0,
        paddingHorizontal: 24,
        paddingTop: 12,
        paddingBottom: 26,
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 0,
        backgroundColor: colors.surfaceElevated,
        borderWidth: 1,
        borderColor: colors.border,
        borderBottomWidth: 0,
        shadowColor: colors.shadow,
        shadowOffset: { width: 0, height: -10 },
        shadowOpacity: 1,
        shadowRadius: 30,
        elevation: 10,
        overflow: 'hidden',
    },
    sheetTop: {
        borderTopLeftRadius: 0,
        borderTopRightRadius: 0,
        borderBottomLeftRadius: 16,
        borderBottomRightRadius: 16,
        borderBottomWidth: 1,
        shadowOffset: { width: 0, height: 10 },
    },
    sheetDictionary: {
        paddingHorizontal: 0,
        paddingTop: 0,
        paddingBottom: 0,
    },
    sheetDictionaryTop: {
        borderTopWidth: 0,
        paddingTop: TOP_PLACEMENT_DICTIONARY_TOP_PADDING,
    },
    sheetCompact: {
        height: DICTIONARY_COMPACT_HEIGHT,
    },
    sheetExpanded: {
        height: DICTIONARY_EXPANDED_MAX_HEIGHT,
    },
    sheetTranslation: {},
    sheetTranslationBase: {
        marginHorizontal: 16,
        marginBottom: 16,
        paddingHorizontal: 14,
        paddingTop: 12,
        paddingBottom: 12,
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
        borderBottomLeftRadius: 12,
        borderBottomRightRadius: 12,
        borderBottomWidth: 1,
        shadowColor: colors.shadow,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 1,
        shadowRadius: 24,
    },
    sheetTranslationTop: {
        marginTop: 0,
        marginBottom: 0,
        paddingTop: TOP_PLACEMENT_TRANSLATION_TOP_PADDING,
        borderTopLeftRadius: 0,
        borderTopRightRadius: 0,
        borderBottomLeftRadius: 12,
        borderBottomRightRadius: 12,
        shadowOffset: { width: 0, height: 8 },
    },
    translationHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 8,
    },
    translationHeaderLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        flex: 1,
        minWidth: 0,
    },
    translationLangText: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 11,
        lineHeight: 17,
        letterSpacing: 0.8,
    },
    copyButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 6,
        paddingVertical: 4,
        borderRadius: 4,
    },
    copyIcon: {
        marginRight: 3,
    },
    copyLabel: {
        fontFamily: fontFamilies.sansMedium,
        fontSize: 10,
        letterSpacing: 1.6,
        textTransform: 'uppercase',
    },
    content: {
        marginTop: 0,
        flex: 1,
        minHeight: 0,
    },
    contentTranslation: {
        paddingHorizontal: 0,
        paddingTop: 0,
    },
    sheetHandleWrap: {
        alignItems: 'center',
        paddingTop: 12,
        marginBottom: 16,
        gap: 6,
    },
    sheetHandleStatic: {
        alignItems: 'center',
        paddingTop: 12,
        marginBottom: 16,
    },
    sheetHandleWrapBottom: {
        alignItems: 'center',
        paddingBottom: 6,
        marginTop: 10,
        gap: 6,
    },
    sheetHandleStaticBottom: {
        alignItems: 'center',
        paddingBottom: 6,
        marginTop: 10,
    },
    sheetHandle: {
        width: 36,
        height: 4,
        borderRadius: 2,
        backgroundColor: colors.borderStrong,
    },
    sheetGestureHint: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 8,
        lineHeight: 13,
        letterSpacing: 1.6,
        textTransform: 'uppercase',
        color: colors.frame,
    },
    contentFill: {
        flex: 1,
        minHeight: 0,
    },
});

export default memo(TopSection);
