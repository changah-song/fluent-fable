import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert,
    Animated,
    Linking,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    TouchableWithoutFeedback,
    View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import Auth from './Auth';
import { deleteCurrentUserProfile } from '../services/accountDeletion';
import { Screen } from '../components/ui';
import { useAppContext } from '../contexts/AppContext';
import { useTranslation } from '../hooks/useTranslation';
import {
    getActiveTargetLanguageOptionId,
    getInterfaceLanguageLabel,
    KRDICT_INTERFACE_LANGUAGE_OPTIONS,
    normalizeInterfaceLanguageCode,
    TARGET_LANGUAGE_OPTIONS,
} from '../constants/languages';
import {
    CONTACT_EMAIL,
    PRIVACY_POLICY_URL,
    TERMS_OF_SERVICE_URL,
} from '../constants/links';
import { fontFamilies, radii, spacing, textStyles, useTheme } from '../theme';

const getProfileColors = (themeColors) => ({
    bg: themeColors.bgPage,
    surface: themeColors.surface,
    muted: themeColors.surfaceMuted,
    surfaceMuted: themeColors.surfaceMuted,
    ink: themeColors.text,
    sub: themeColors.textTertiary,
    faint: themeColors.textSubtle,
    border: themeColors.divider,
    strongBorder: themeColors.borderStrong,
    accent: themeColors.accent,
    danger: themeColors.danger,
    white: themeColors.white,
});

const getInitial = (name) => {
    const trimmed = String(name || '').trim();
    return trimmed ? trimmed.charAt(0).toUpperCase() : 'R';
};

const TOGGLE_WIDTH = 52;
const TOGGLE_HEIGHT = 32;
const TOGGLE_THUMB = 26;
const TOGGLE_INSET = 3;
const TOGGLE_TRAVEL = TOGGLE_WIDTH - TOGGLE_THUMB - TOGGLE_INSET * 2;

const PillToggle = ({ value, onValueChange, theme }) => {
    const progress = useRef(new Animated.Value(value ? 1 : 0)).current;

    useEffect(() => {
        Animated.timing(progress, {
            toValue: value ? 1 : 0,
            duration: 180,
            useNativeDriver: false,
        }).start();
    }, [value, progress]);

    const trackColor = progress.interpolate({
        inputRange: [0, 1],
        outputRange: [theme.colors.border, theme.colors.accent],
    });
    const translateX = progress.interpolate({
        inputRange: [0, 1],
        outputRange: [0, TOGGLE_TRAVEL],
    });

    return (
        <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: value }}
            hitSlop={8}
            onPress={() => onValueChange(!value)}
            style={{
                width: TOGGLE_WIDTH,
                height: TOGGLE_HEIGHT,
                justifyContent: 'center',
            }}
        >
            <Animated.View
                style={{
                    ...StyleSheet.absoluteFillObject,
                    borderRadius: TOGGLE_HEIGHT / 2,
                    backgroundColor: trackColor,
                }}
            />
            <Animated.View
                style={{
                    width: TOGGLE_THUMB,
                    height: TOGGLE_THUMB,
                    borderRadius: TOGGLE_THUMB / 2,
                    backgroundColor: theme.colors.surface,
                    marginLeft: TOGGLE_INSET,
                    transform: [{ translateX }],
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 1 },
                    shadowOpacity: 0.18,
                    shadowRadius: 2,
                    elevation: 2,
                }}
            />
        </Pressable>
    );
};

const ToggleRow = ({ label, description, value, onValueChange, isLast, styles, theme }) => (
    <View style={[styles.row, isLast && styles.rowLast]}>
        <View style={styles.rowCopy}>
            <Text style={styles.rowLabel}>{label}</Text>
            {description ? <Text style={styles.rowDescription}>{description}</Text> : null}
        </View>
        <PillToggle value={value} onValueChange={onValueChange} theme={theme} />
    </View>
);

const NavRow = ({ label, value, onPress, icon = 'chevron-right', isLast, styles, profileColors }) => (
    <TouchableOpacity
        activeOpacity={0.7}
        onPress={onPress}
        style={[styles.row, isLast && styles.rowLast]}
    >
        <Text style={[styles.rowLabel, styles.rowLabelFlex]}>{label}</Text>
        {value ? <Text style={styles.rowValue}>{value}</Text> : null}
        <Feather name={icon} size={18} color={profileColors.faint} />
    </TouchableOpacity>
);

const Profile = ({ user, signOut, updateUsername }) => {
    const [isSigningOut, setIsSigningOut] = useState(false);
    const [showSignOutModal, setShowSignOutModal] = useState(false);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [isDeletingAccount, setIsDeletingAccount] = useState(false);
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [authMode, setAuthMode] = useState('signin');
    const [showNameEditor, setShowNameEditor] = useState(false);
    const [showInterfaceLanguagePicker, setShowInterfaceLanguagePicker] = useState(false);
    const [showContactModal, setShowContactModal] = useState(false);
    const [emailCopied, setEmailCopied] = useState(false);
    const [draftName, setDraftName] = useState('');
    const [isSavingName, setIsSavingName] = useState(false);
    const [showTargetLanguagePicker, setShowTargetLanguagePicker] = useState(false);
    const {
        interfaceLanguage,
        setInterfaceLanguage,
        targetLanguage,
        setTargetLanguage,
        chineseScript,
        setChineseScript,
        isDarkMode,
        setIsDarkMode,
        notificationsEnabled,
        setNotificationsEnabled,
        personalizedVocabEnabled,
        setPersonalizedVocabEnabled,
    } = useAppContext();
    const theme = useTheme();
    const profileColors = useMemo(() => getProfileColors(theme.colors), [theme.colors]);
    const styles = useMemo(() => createStyles(profileColors, theme.colors), [profileColors, theme.colors]);
    const { t } = useTranslation();
    const isAnonymous = Boolean(user?.is_anonymous);
    const isGuest = !user?.id || isAnonymous;

    const displayName = useMemo(() => {
        const metadataName = user?.user_metadata?.username
            || user?.user_metadata?.display_name
            || user?.user_metadata?.name;

        if (metadataName && String(metadataName).trim()) {
            return String(metadataName).trim();
        }

        return 'Reader';
    }, [user?.user_metadata]);

    const learningSince = useMemo(() => {
        if (!user?.created_at) {
            return t('profile.recently');
        }

        return new Date(user.created_at).toLocaleDateString(normalizeInterfaceLanguageCode(interfaceLanguage), {
            month: 'short',
            year: 'numeric',
        });
    }, [interfaceLanguage, t, user?.created_at]);

    const identitySubtitle = isGuest
        ? t('profile.guestSubtitle')
        : (user?.email || t('profile.userSubtitle', { date: learningSince }));

    const interfaceLanguageOptions = KRDICT_INTERFACE_LANGUAGE_OPTIONS;

    useEffect(() => {
        if (user?.id) {
            setShowAuthModal(false);
        }
    }, [user?.id]);

    const performSignOut = async () => {
        if (isSigningOut) {
            return;
        }

        setIsSigningOut(true);
        try {
            await signOut?.();
        } catch (error) {
            Alert.alert(t('profile.signOutFailed'), error.message || t('profile.preferenceSoon'));
        } finally {
            setIsSigningOut(false);
            setShowSignOutModal(false);
        }
    };

    const performDeleteAccount = async () => {
        if (isDeletingAccount) {
            return;
        }

        setIsDeletingAccount(true);
        try {
            await deleteCurrentUserProfile();
            setShowDeleteModal(false);
            await signOut?.();
        } catch (error) {
            Alert.alert(t('profile.deleteAccountFailed'), error?.message || t('profile.preferenceSoon'));
        } finally {
            setIsDeletingAccount(false);
        }
    };

    const handleInterfaceLanguageSelect = (language) => {
        if (language === targetLanguage) {
            return;
        }

        setInterfaceLanguage(language);
        setShowInterfaceLanguagePicker(false);
    };

    const activeTargetOptionId = getActiveTargetLanguageOptionId(targetLanguage, chineseScript);
    const activeTargetOption = TARGET_LANGUAGE_OPTIONS.find((option) => option.id === activeTargetOptionId);

    const handleTargetLanguageSelect = (option) => {
        setShowTargetLanguagePicker(false);
        if (option.id === activeTargetOptionId) {
            return;
        }
        // Order matters: set the script first so the zh profile/runtime pick it up
        // when the target language flips to 'zh'.
        if (option.chineseScript) {
            setChineseScript(option.chineseScript);
        }
        setTargetLanguage(option.targetLanguage);
    };

    const openAuthModal = (mode) => {
        setAuthMode(mode);
        setShowAuthModal(true);
    };

    const openNameEditor = () => {
        setDraftName(displayName === 'Reader' ? '' : displayName);
        setShowNameEditor(true);
    };

    const openLink = (url) => {
        Linking.openURL(url).catch(() => {
            Alert.alert('', t('profile.linkUnavailable'));
        });
    };

    const openContactModal = () => {
        setEmailCopied(false);
        setShowContactModal(true);
    };

    const handleCopyEmail = async () => {
        try {
            await Clipboard.setStringAsync(CONTACT_EMAIL);
            setEmailCopied(true);
        } catch (error) {
            Alert.alert('', t('profile.linkUnavailable'));
        }
    };

    const handleSaveName = async () => {
        const nextName = draftName.trim();
        if (!nextName) {
            Alert.alert(t('profile.usernameRequiredTitle'), t('profile.usernameRequiredBody'));
            return;
        }

        if (!updateUsername) {
            Alert.alert(t('profile.usernameUnavailableTitle'), t('profile.usernameUnavailableBody'));
            return;
        }

        setIsSavingName(true);
        try {
            await updateUsername(nextName);
            setShowNameEditor(false);
        } catch (error) {
            Alert.alert(t('profile.saveFailed'), error?.message || t('profile.preferenceSoon'));
        } finally {
            setIsSavingName(false);
        }
    };

    return (
        <Screen
            backgroundColor={profileColors.bg}
            contentContainerStyle={styles.screenContent}
        >
            <ScrollView
                style={styles.pageScroller}
                contentContainerStyle={styles.pageScrollerContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
            >
                <View style={styles.appTopBar}>
                    <View style={styles.appTopSide} />
                    <Text style={styles.appTopTitle}>NOEUL</Text>
                    <View style={styles.appTopSide} />
                </View>

                <View style={styles.profileHeader}>
                    <View style={styles.avatar}>
                        <Text style={styles.avatarInitial}>{getInitial(displayName)}</Text>
                    </View>
                    <View style={styles.profileIdentity}>
                        <Text style={styles.profileName} numberOfLines={1}>{displayName}</Text>
                        <Text style={styles.profileSubtitle} numberOfLines={1}>{identitySubtitle}</Text>
                    </View>
                    {!isGuest ? (
                        <TouchableOpacity
                            accessibilityRole="button"
                            accessibilityLabel={t('profile.editUsername')}
                            activeOpacity={0.78}
                            onPress={openNameEditor}
                            style={styles.editUsernameButton}
                        >
                            <Feather name="edit-2" size={16} color={profileColors.sub} />
                        </TouchableOpacity>
                    ) : null}
                </View>

                <View style={styles.section}>
                    <Text style={styles.groupEyebrow}>{t('profile.appearance')}</Text>
                    <View style={styles.segmentControl}>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityState={{ selected: !isDarkMode }}
                            onPress={() => setIsDarkMode(false)}
                            style={[styles.segmentButton, !isDarkMode && styles.segmentButtonActive]}
                        >
                            <Feather name="sun" size={16} color={!isDarkMode ? profileColors.white : profileColors.sub} />
                            <Text style={[styles.segmentText, !isDarkMode && styles.segmentTextActive]}>
                                {t('profile.light')}
                            </Text>
                        </Pressable>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityState={{ selected: isDarkMode }}
                            onPress={() => setIsDarkMode(true)}
                            style={[styles.segmentButton, isDarkMode && styles.segmentButtonActive]}
                        >
                            <Feather name="moon" size={16} color={isDarkMode ? profileColors.white : profileColors.sub} />
                            <Text style={[styles.segmentText, isDarkMode && styles.segmentTextActive]}>
                                {t('profile.dark')}
                            </Text>
                        </Pressable>
                    </View>
                </View>

                <View style={styles.section}>
                    <Text style={styles.groupEyebrow}>{t('profile.learningLanguage')}</Text>
                    <View style={styles.card}>
                        <NavRow
                            label={t('profile.learningLanguage')}
                            value={activeTargetOption?.label}
                            onPress={() => setShowTargetLanguagePicker(true)}
                            isLast
                            styles={styles}
                            profileColors={profileColors}
                        />
                    </View>
                    <Text style={styles.levelHelperText}>{t('profile.learningLanguageDesc')}</Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.groupEyebrow}>{t('profile.preferences')}</Text>
                    <View style={styles.card}>
                        <NavRow
                            label={t('profile.interfaceLanguage')}
                            onPress={() => setShowInterfaceLanguagePicker(true)}
                            styles={styles}
                            profileColors={profileColors}
                        />
                        <ToggleRow
                            label={t('profile.notifications')}
                            value={notificationsEnabled}
                            onValueChange={setNotificationsEnabled}
                            styles={styles}
                            theme={theme}
                        />
                        <ToggleRow
                            label={t('profile.personalizedVocab')}
                            description={t('profile.personalizedVocabDesc')}
                            value={personalizedVocabEnabled}
                            onValueChange={setPersonalizedVocabEnabled}
                            isLast
                            styles={styles}
                            theme={theme}
                        />
                    </View>
                </View>

                {!isGuest ? (
                    <View style={styles.section}>
                        <Text style={styles.groupEyebrow}>{t('profile.about')}</Text>
                        <View style={styles.card}>
                            <NavRow
                                label={t('profile.privacyPolicy')}
                                onPress={() => openLink(PRIVACY_POLICY_URL)}
                                styles={styles}
                                profileColors={profileColors}
                            />
                            <NavRow
                                label={t('profile.termsOfService')}
                                onPress={() => openLink(TERMS_OF_SERVICE_URL)}
                                styles={styles}
                                profileColors={profileColors}
                            />
                            <NavRow
                                label={t('profile.contact')}
                                onPress={openContactModal}
                                icon="mail"
                                isLast
                                styles={styles}
                                profileColors={profileColors}
                            />
                        </View>
                    </View>
                ) : null}

                <View style={styles.section}>
                    <Text style={styles.groupEyebrow}>{t('profile.account')}</Text>
                    {isGuest ? (
                        <View style={styles.guestAuthActions}>
                            <TouchableOpacity
                                activeOpacity={0.86}
                                onPress={() => openAuthModal('signin')}
                                style={[styles.guestAuthButton, styles.guestAuthButtonSecondary]}
                            >
                                <Text style={styles.guestAuthButtonSecondaryText}>{t('profile.signIn')}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                activeOpacity={0.86}
                                onPress={() => openAuthModal('signup')}
                                style={[styles.guestAuthButton, styles.guestAuthButtonPrimary]}
                            >
                                <Text style={styles.guestAuthButtonPrimaryText}>{t('profile.signUp')}</Text>
                            </TouchableOpacity>
                        </View>
                    ) : (
                        <TouchableOpacity
                            activeOpacity={0.86}
                            onPress={() => setShowSignOutModal(true)}
                            disabled={isSigningOut}
                            style={[styles.logoutButton, isSigningOut && styles.logoutButtonDisabled]}
                        >
                            <Text style={styles.logoutText}>
                                {isSigningOut ? t('profile.loggingOut') : t('profile.logout')}
                            </Text>
                        </TouchableOpacity>
                    )}
                </View>

                {!isGuest ? (
                    <View style={styles.section}>
                        <TouchableOpacity
                            accessibilityRole="button"
                            activeOpacity={0.86}
                            onPress={() => setShowDeleteModal(true)}
                            disabled={isDeletingAccount}
                            style={[styles.deleteAccountButton, isDeletingAccount && styles.deleteAccountButtonDisabled]}
                        >
                            <Text style={styles.deleteAccountText}>
                                {isDeletingAccount ? t('profile.deletingAccount') : t('profile.deleteAccount')}
                            </Text>
                        </TouchableOpacity>
                    </View>
                ) : null}
            </ScrollView>

            <Modal
                visible={showTargetLanguagePicker}
                animationType="fade"
                transparent
                onRequestClose={() => setShowTargetLanguagePicker(false)}
            >
                <TouchableWithoutFeedback onPress={() => setShowTargetLanguagePicker(false)}>
                    <View style={styles.modalBackdrop}>
                        <TouchableWithoutFeedback>
                            <View style={[styles.modalCard, styles.languageModalCard]}>
                                <Text style={styles.modalTitle}>{t('profile.learningLanguage')}</Text>
                                <View style={styles.languageOptions}>
                                    {TARGET_LANGUAGE_OPTIONS.map((option) => {
                                        const selected = option.id === activeTargetOptionId;

                                        return (
                                            <Pressable
                                                key={option.id}
                                                accessibilityRole="radio"
                                                accessibilityState={{ selected }}
                                                onPress={() => handleTargetLanguageSelect(option)}
                                                style={[
                                                    styles.languageOptionRow,
                                                    selected && styles.languageOptionRowSelected,
                                                ]}
                                            >
                                                <Feather
                                                    name={selected ? 'check-circle' : 'circle'}
                                                    size={18}
                                                    color={selected ? profileColors.accent : profileColors.faint}
                                                />
                                                <Text
                                                    style={[
                                                        styles.languageOptionText,
                                                        selected && styles.languageOptionTextSelected,
                                                    ]}
                                                >
                                                    {option.label}
                                                </Text>
                                            </Pressable>
                                        );
                                    })}
                                </View>
                                <Text style={styles.languageDisclaimerText}>
                                    {t('profile.learningLanguageDesc')}
                                </Text>
                            </View>
                        </TouchableWithoutFeedback>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>

            <Modal
                visible={showInterfaceLanguagePicker}
                animationType="fade"
                transparent
                onRequestClose={() => setShowInterfaceLanguagePicker(false)}
            >
                <TouchableWithoutFeedback onPress={() => setShowInterfaceLanguagePicker(false)}>
                    <View style={styles.modalBackdrop}>
                        <TouchableWithoutFeedback>
                            <View style={[styles.modalCard, styles.languageModalCard]}>
                                <Text style={styles.modalTitle}>{t('profile.interfaceLanguage')}</Text>
                                <View style={styles.languageOptions}>
                                    {interfaceLanguageOptions.map((option) => {
                                        const selected = option.code === interfaceLanguage;
                                        const disabled = option.code === targetLanguage;

                                        return (
                                            <Pressable
                                                key={option.code}
                                                accessibilityRole="radio"
                                                accessibilityState={{ selected, disabled }}
                                                disabled={disabled}
                                                onPress={() => handleInterfaceLanguageSelect(option.code)}
                                                style={[
                                                    styles.languageOptionRow,
                                                    selected && styles.languageOptionRowSelected,
                                                    disabled && styles.languageOptionRowDisabled,
                                                ]}
                                            >
                                                <Feather
                                                    name={selected ? 'check-circle' : 'circle'}
                                                    size={18}
                                                    color={selected && !disabled ? profileColors.accent : profileColors.faint}
                                                />
                                                <Text
                                                    style={[
                                                        styles.languageOptionText,
                                                        selected && styles.languageOptionTextSelected,
                                                        disabled && styles.languageOptionTextDisabled,
                                                    ]}
                                                >
                                                    {option.label}
                                                </Text>
                                            </Pressable>
                                        );
                                    })}
                                </View>
                                <Text style={styles.languageDisclaimerText}>
                                    {t('profile.translationDisclaimer')}
                                </Text>
                            </View>
                        </TouchableWithoutFeedback>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>

            <Modal
                visible={showContactModal}
                animationType="fade"
                transparent
                onRequestClose={() => setShowContactModal(false)}
            >
                <TouchableWithoutFeedback onPress={() => setShowContactModal(false)}>
                    <View style={styles.modalBackdrop}>
                        <TouchableWithoutFeedback>
                            <View style={styles.modalCard}>
                                <Text style={styles.modalTitle}>{t('profile.contact')}</Text>
                                <Text style={styles.modalHelper}>{t('profile.contactBody')}</Text>
                                <Pressable onPress={handleCopyEmail} style={styles.contactEmailField}>
                                    <Text style={styles.contactEmailText} selectable>{CONTACT_EMAIL}</Text>
                                    <Feather
                                        name={emailCopied ? 'check' : 'copy'}
                                        size={18}
                                        color={emailCopied ? profileColors.accent : profileColors.sub}
                                    />
                                </Pressable>
                                <View style={styles.modalActions}>
                                    <Pressable
                                        onPress={() => setShowContactModal(false)}
                                        style={styles.modalButton}
                                    >
                                        <Text style={styles.modalButtonText}>{t('common.close')}</Text>
                                    </Pressable>
                                    <Pressable
                                        onPress={handleCopyEmail}
                                        style={[styles.modalButton, styles.modalPrimaryButton]}
                                    >
                                        <Text style={[styles.modalButtonText, styles.modalPrimaryButtonText]}>
                                            {emailCopied ? t('profile.emailCopied') : t('profile.copyEmail')}
                                        </Text>
                                    </Pressable>
                                </View>
                            </View>
                        </TouchableWithoutFeedback>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>

            <Modal
                visible={showAuthModal}
                animationType="fade"
                transparent
                onRequestClose={() => setShowAuthModal(false)}
            >
                <View style={styles.authModalBackdrop}>
                    <Pressable style={styles.authModalScrim} onPress={() => setShowAuthModal(false)} />
                    <View style={styles.authModalCard}>
                        <View style={styles.authModalHeader}>
                            <View style={styles.authModalCopy}>
                                <Text style={styles.authModalTitle}>
                                    {t('profile.authTitle')}
                                </Text>
                                <Text style={styles.authModalHelper}>
                                    {t('profile.authBody')}
                                </Text>
                            </View>
                            <TouchableOpacity
                                accessibilityRole="button"
                                accessibilityLabel={t('profile.closeSignIn')}
                                activeOpacity={0.78}
                                onPress={() => setShowAuthModal(false)}
                                style={styles.authModalCloseButton}
                            >
                                <Text style={styles.authModalCloseText}>×</Text>
                            </TouchableOpacity>
                        </View>
                        <Auth
                            key={authMode}
                            embedded
                            initialMode={authMode}
                            showApple={false}
                            showHeader={false}
                            showModeToggle={false}
                            showSectionLabels={false}
                            title=""
                            subtitle=""
                            onAuthenticated={() => setShowAuthModal(false)}
                        />
                    </View>
                </View>
            </Modal>

            <Modal
                visible={showNameEditor}
                animationType="fade"
                transparent
                onRequestClose={() => setShowNameEditor(false)}
            >
                <TouchableWithoutFeedback onPress={() => setShowNameEditor(false)}>
                    <View style={styles.modalBackdrop}>
                        <TouchableWithoutFeedback>
                            <View style={styles.modalCard}>
                                <Text style={styles.modalTitle}>{t('profile.editUsernameTitle')}</Text>
                                <TextInput
                                    value={draftName}
                                    onChangeText={setDraftName}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    editable={!isSavingName}
                                    placeholder={t('profile.usernamePlaceholder')}
                                    placeholderTextColor={profileColors.faint}
                                    style={styles.usernameInput}
                                />
                                <View style={styles.modalActions}>
                                    <Pressable
                                        onPress={() => setShowNameEditor(false)}
                                        style={styles.modalButton}
                                        disabled={isSavingName}
                                    >
                                        <Text style={styles.modalButtonText}>{t('common.cancel')}</Text>
                                    </Pressable>
                                    <Pressable
                                        onPress={handleSaveName}
                                        style={[
                                            styles.modalButton,
                                            styles.modalPrimaryButton,
                                            isSavingName && styles.modalButtonDisabled,
                                        ]}
                                        disabled={isSavingName}
                                    >
                                        <Text style={[styles.modalButtonText, styles.modalPrimaryButtonText]}>
                                            {isSavingName ? t('common.working') : t('common.save')}
                                        </Text>
                                    </Pressable>
                                </View>
                            </View>
                        </TouchableWithoutFeedback>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>

            <Modal
                visible={showSignOutModal}
                animationType="fade"
                transparent
                onRequestClose={() => setShowSignOutModal(false)}
            >
                <TouchableWithoutFeedback onPress={() => setShowSignOutModal(false)}>
                    <View style={styles.modalBackdrop}>
                        <TouchableWithoutFeedback>
                            <View style={styles.modalCard}>
                                <Text style={styles.modalTitle}>{t('profile.logoutTitle')}</Text>
                                <Text style={styles.modalHelper}>
                                    {t('profile.logoutBody')}
                                </Text>
                                <View style={styles.modalActions}>
                                    <Pressable
                                        onPress={() => setShowSignOutModal(false)}
                                        style={styles.modalButton}
                                    >
                                        <Text style={styles.modalButtonText}>{t('common.cancel')}</Text>
                                    </Pressable>
                                    <Pressable
                                        onPress={() => performSignOut()}
                                        style={[styles.modalButton, styles.modalPrimaryButton]}
                                    >
                                        <Text style={[styles.modalButtonText, styles.modalPrimaryButtonText]}>
                                            {t('profile.logout')}
                                        </Text>
                                    </Pressable>
                                </View>
                            </View>
                        </TouchableWithoutFeedback>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>

            <Modal
                visible={showDeleteModal}
                animationType="fade"
                transparent
                onRequestClose={() => (isDeletingAccount ? null : setShowDeleteModal(false))}
            >
                <TouchableWithoutFeedback onPress={() => (isDeletingAccount ? null : setShowDeleteModal(false))}>
                    <View style={styles.modalBackdrop}>
                        <TouchableWithoutFeedback>
                            <View style={styles.modalCard}>
                                <Text style={styles.modalTitle}>{t('profile.deleteAccountTitle')}</Text>
                                <Text style={styles.modalHelper}>
                                    {t('profile.deleteAccountBody')}
                                </Text>
                                <View style={styles.modalActions}>
                                    <Pressable
                                        onPress={() => setShowDeleteModal(false)}
                                        style={styles.modalButton}
                                        disabled={isDeletingAccount}
                                    >
                                        <Text style={styles.modalButtonText}>{t('common.cancel')}</Text>
                                    </Pressable>
                                    <Pressable
                                        onPress={() => performDeleteAccount()}
                                        style={[
                                            styles.modalButton,
                                            styles.modalDangerButton,
                                            isDeletingAccount && styles.modalButtonDisabled,
                                        ]}
                                        disabled={isDeletingAccount}
                                    >
                                        <Text style={[styles.modalButtonText, styles.modalDangerButtonText]}>
                                            {isDeletingAccount ? t('profile.deletingAccount') : t('profile.deleteAccountConfirm')}
                                        </Text>
                                    </Pressable>
                                </View>
                            </View>
                        </TouchableWithoutFeedback>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>
        </Screen>
    );
};

const createStyles = (profileColors, themeColors) => StyleSheet.create({
    screenContent: {
        flex: 1,
        paddingHorizontal: 0,
        paddingTop: 0,
        paddingBottom: 0,
        backgroundColor: profileColors.bg,
    },
    pageScroller: {
        flex: 1,
        width: '100%',
    },
    pageScrollerContent: {
        flexGrow: 1,
        paddingBottom: 28,
    },
    appTopBar: {
        height: 52,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
        borderBottomWidth: 1,
        borderBottomColor: profileColors.border,
        backgroundColor: profileColors.bg,
    },
    appTopSide: {
        width: 70,
        alignItems: 'flex-start',
    },
    appTopTitle: {
        flex: 1,
        textAlign: 'center',
        ...textStyles.appTitle,
        color: profileColors.ink,
    },
    profileHeader: {
        paddingTop: 24,
        paddingBottom: 20,
        paddingHorizontal: 24,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
    },
    avatar: {
        width: 64,
        height: 64,
        borderRadius: 32,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: profileColors.ink,
    },
    avatarInitial: {
        fontFamily: fontFamilies.serifBold,
        fontSize: 28,
        lineHeight: 34,
        color: profileColors.white,
    },
    profileIdentity: {
        flex: 1,
        minWidth: 0,
    },
    profileName: {
        width: '100%',
        fontFamily: fontFamilies.displaySemiBold,
        fontSize: 26,
        lineHeight: 32,
        letterSpacing: 0,
        color: profileColors.ink,
    },
    profileSubtitle: {
        marginTop: 3,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 19,
        color: profileColors.sub,
    },
    editUsernameButton: {
        width: 38,
        height: 38,
        borderRadius: radii.pill,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: profileColors.border,
        backgroundColor: profileColors.bg,
    },
    section: {
        paddingTop: 18,
        paddingHorizontal: 24,
    },
    groupEyebrow: {
        marginBottom: 10,
        fontFamily: fontFamilies.sansBold,
        fontSize: 11.5,
        lineHeight: 15,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
        color: profileColors.faint,
    },
    segmentControl: {
        flexDirection: 'row',
        padding: 4,
        borderRadius: radii.lg,
        backgroundColor: profileColors.muted,
        gap: 4,
    },
    segmentButton: {
        flex: 1,
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        borderRadius: radii.md,
        backgroundColor: themeColors.transparent,
    },
    segmentButtonActive: {
        backgroundColor: profileColors.ink,
    },
    segmentText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 15,
        lineHeight: 19,
        color: profileColors.sub,
    },
    segmentTextActive: {
        color: profileColors.white,
    },
    card: {
        width: '100%',
        borderRadius: radii.lg,
        borderWidth: 1,
        borderColor: profileColors.border,
        backgroundColor: profileColors.surface,
        overflow: 'hidden',
    },
    row: {
        minHeight: 58,
        paddingVertical: 16,
        paddingHorizontal: 18,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        borderBottomWidth: 1,
        borderBottomColor: profileColors.border,
    },
    rowLast: {
        borderBottomWidth: 0,
    },
    rowCopy: {
        flex: 1,
        minWidth: 0,
    },
    rowLabel: {
        fontFamily: fontFamilies.sansMedium,
        fontSize: 16,
        lineHeight: 21,
        color: profileColors.ink,
    },
    rowLabelFlex: {
        flex: 1,
        minWidth: 0,
    },
    rowValue: {
        fontFamily: fontFamilies.sansMedium,
        fontSize: 15,
        lineHeight: 21,
        color: profileColors.sub,
        marginRight: 8,
    },
    rowDescription: {
        marginTop: 4,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13,
        lineHeight: 18,
        color: profileColors.sub,
    },
    guestAuthActions: {
        flexDirection: 'row',
        gap: 10,
    },
    guestAuthButton: {
        flex: 1,
        minHeight: 50,
        borderRadius: radii.md,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 14,
        paddingVertical: 12,
    },
    guestAuthButtonSecondary: {
        borderWidth: 1,
        borderColor: profileColors.border,
        backgroundColor: profileColors.surface,
    },
    guestAuthButtonPrimary: {
        backgroundColor: profileColors.ink,
    },
    guestAuthButtonSecondaryText: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 15,
        lineHeight: 19,
        color: profileColors.ink,
    },
    guestAuthButtonPrimaryText: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 15,
        lineHeight: 19,
        color: profileColors.white,
    },
    logoutButton: {
        minHeight: 52,
        paddingVertical: 14,
        paddingHorizontal: 14,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radii.md,
        borderWidth: 1,
        borderColor: profileColors.border,
        backgroundColor: profileColors.surface,
    },
    logoutButtonDisabled: {
        opacity: 0.62,
    },
    logoutText: {
        fontFamily: fontFamilies.sansSemiBold,
        fontSize: 16,
        lineHeight: 20,
        color: profileColors.danger,
    },
    deleteAccountButton: {
        minHeight: 52,
        paddingVertical: 14,
        paddingHorizontal: 14,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radii.md,
        backgroundColor: profileColors.danger,
    },
    deleteAccountButtonDisabled: {
        opacity: 0.62,
    },
    deleteAccountText: {
        fontFamily: fontFamilies.sansBold,
        fontSize: 16,
        lineHeight: 20,
        color: profileColors.white,
    },
    languageModalCard: {
        gap: 14,
    },
    languageOptions: {
        gap: 8,
    },
    languageOptionRow: {
        minHeight: 44,
        paddingHorizontal: 12,
        paddingVertical: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        borderWidth: 1,
        borderColor: profileColors.border,
        backgroundColor: profileColors.surface,
    },
    languageOptionRowSelected: {
        borderColor: profileColors.strongBorder,
        backgroundColor: profileColors.surfaceMuted,
    },
    languageOptionRowDisabled: {
        opacity: 0.56,
    },
    languageOptionText: {
        flex: 1,
        minWidth: 0,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 14,
        lineHeight: 18,
        color: profileColors.ink,
    },
    languageOptionTextSelected: {
        fontFamily: fontFamilies.sansBold,
        color: profileColors.accent,
    },
    languageOptionTextDisabled: {
        color: profileColors.faint,
    },
    languageDisclaimerText: {
        marginTop: 4,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 11.5,
        lineHeight: 16,
        color: profileColors.sub,
    },
    authModalBackdrop: {
        flex: 1,
        justifyContent: 'center',
        paddingHorizontal: 18,
        backgroundColor: themeColors.overlay,
    },
    authModalScrim: {
        ...StyleSheet.absoluteFillObject,
    },
    authModalCard: {
        maxHeight: '88%',
        borderRadius: radii.xl,
        borderWidth: 1,
        borderColor: profileColors.border,
        backgroundColor: profileColors.surface,
        padding: 22,
    },
    authModalHeader: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
        paddingBottom: 22,
    },
    authModalCopy: {
        flex: 1,
        gap: 12,
    },
    authModalTitle: {
        fontFamily: fontFamilies.serifBold,
        fontSize: 24,
        lineHeight: 30,
        color: profileColors.ink,
    },
    authModalHelper: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 13.5,
        lineHeight: 20,
        color: profileColors.sub,
    },
    authModalCloseButton: {
        width: 34,
        height: 34,
        borderRadius: radii.pill,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: profileColors.muted,
    },
    authModalCloseText: {
        fontFamily: fontFamilies.sansRegular,
        fontSize: 24,
        lineHeight: 28,
        color: profileColors.sub,
    },
    modalBackdrop: {
        flex: 1,
        backgroundColor: themeColors.overlay,
        justifyContent: 'center',
        paddingHorizontal: spacing.lg,
    },
    modalCard: {
        backgroundColor: themeColors.surfaceElevated,
        borderRadius: radii.lg,
        padding: spacing.lg,
        borderWidth: 1,
        borderColor: themeColors.border,
        gap: spacing.md,
    },
    modalTitle: {
        ...textStyles.sectionTitle,
        color: profileColors.ink,
    },
    modalHelper: {
        ...textStyles.bodyMuted,
        lineHeight: 20,
        color: profileColors.sub,
    },
    contactEmailField: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        minHeight: 48,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderWidth: 1,
        borderColor: profileColors.border,
        borderRadius: radii.md,
        backgroundColor: profileColors.surface,
    },
    contactEmailText: {
        flex: 1,
        minWidth: 0,
        fontFamily: fontFamilies.sansMedium,
        fontSize: 15,
        lineHeight: 20,
        color: profileColors.ink,
    },
    modalActions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: spacing.sm,
    },
    modalButton: {
        minWidth: 88,
        minHeight: 40,
        borderRadius: radii.pill,
        paddingHorizontal: spacing.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: themeColors.surfaceMuted,
    },
    modalPrimaryButton: {
        backgroundColor: themeColors.accentSoft,
    },
    modalDangerButton: {
        backgroundColor: profileColors.danger,
    },
    modalButtonDisabled: {
        opacity: 0.62,
    },
    usernameInput: {
        minHeight: 46,
        borderWidth: 1,
        borderColor: profileColors.border,
        borderRadius: radii.md,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        backgroundColor: profileColors.surface,
        color: profileColors.ink,
        fontFamily: fontFamilies.sansRegular,
        fontSize: 15,
        lineHeight: 20,
    },
    modalButtonText: {
        ...textStyles.label,
        color: themeColors.text,
    },
    modalPrimaryButtonText: {
        color: themeColors.accentStrong,
    },
    modalDangerButtonText: {
        color: profileColors.white,
    },
    levelHelperText: {
        fontFamily: fontFamilies.regular,
        fontSize: 12,
        lineHeight: 17,
        color: profileColors.faint,
        paddingHorizontal: spacing.md,
        paddingTop: spacing.sm,
        paddingBottom: spacing.xs,
    },
});

export default Profile;
