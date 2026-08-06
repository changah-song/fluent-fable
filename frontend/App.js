import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { TranslatorProvider } from 'react-native-translator';
import { useEffect, useMemo, useState } from 'react';
import { Alert } from 'react-native';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import {
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
} from '@expo-google-fonts/inter';
import {
    Fraunces_400Regular,
    Fraunces_500Medium,
    Fraunces_400Regular_Italic,
    Fraunces_500Medium_Italic,
    Fraunces_600SemiBold,
    Fraunces_700Bold,
} from '@expo-google-fonts/fraunces';
import {
    NotoSerifKR_400Regular,
    NotoSerifKR_500Medium,
    NotoSerifKR_600SemiBold,
    NotoSerifKR_700Bold,
} from '@expo-google-fonts/noto-serif-kr';
import LocalDataDecisionModal from './components/Auth/LocalDataDecisionModal';
import { tabScreenOptions } from './components/shared/TabBar';
import { AppProvider } from './contexts/AppContext';
import { LocalOwnerProvider, useLocalOwner } from './contexts/LocalOwnerContext';
import { VocabWordsProvider } from './contexts/VocabWordsContext';
import useAppSetup from './hooks/useAppSetup';
import useAuth from './hooks/useAuth';
import Home from './screens/Home';
import Learn from './screens/Learn';
import Profile from './screens/Profile';
import Read from './screens/Read';
// Write screen is shelved: kept on disk (screens/Write.js) but no longer routed.
// To un-shelf, restore this import and the <Tab.Screen name="Write"> block below.
// import Write from './screens/Write';
import { GUEST_OWNER_ID, getLocalOwnerId } from './services/localDataScope';
import {
    getActiveOwnerId,
    resumeCloudSync,
    transitionLocalOwner,
} from './services/localOwnerCoordinator';
import { getLegacyMigrationStatus } from './services/localOwnerMigration';
import { applyOwnershipDecision } from './services/localOwnershipDecisions';
import { hasLocalUserData } from './services/localUserData';
import { getRuntimeInterfaceLanguage, loadRuntimeInterfaceLanguage } from './services/interfaceLanguage';
import { translate } from './i18n/translations';
import { initializeOverlayLookupBridge } from './services/overlayLookup';
import { syncUserDataFromCloud } from './services/userDataSync';
import { subscribeUserDataSyncRequests } from './services/userDataSyncQueue';
import { colors, useTheme } from './theme';

const Tab = createBottomTabNavigator();
const APP_BACKGROUND = colors.bgPage;
const DEFAULT_USER_DATA_SYNC_DELAY_MS = 1500;
const PASSIVE_CONTEXT_SYNC_DELAY_MS = 30000;
const USER_DATA_SYNC_DELAY_BY_REASON = {
    'reader-visible-vocab-context': PASSIVE_CONTEXT_SYNC_DELAY_MS,
};
const isStaleSyncGenerationError = (error) => (
    String(error?.message || error || '').includes('stale sync generation')
);

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function App() {
    return (
        <LocalOwnerProvider>
            <AppContent />
        </LocalOwnerProvider>
    );
}

function AppContent() {
    const { user, loading, signOut, updateUsername, updateProfile } = useAuth();
    const {
        activeOwnerId,
        ownershipBlocked,
        pendingOwnershipDecision,
        syncPaused,
        syncGeneration,
    } = useLocalOwner();
    const [ownerMigrationReady, setOwnerMigrationReady] = useState(false);
    const [localDataDecisionBusy, setLocalDataDecisionBusy] = useState(false);
    const { books, setBooks, currentBook, setCurrentBook, preprocessOnOpen, setPreprocessOnOpen, updateBookPreprocessed, syncCloudBooks, loading: appSetupLoading, loadedOwnerId: appSetupOwnerId } = useAppSetup({
        ownerId: activeOwnerId,
        ownerReady: !loading && ownerMigrationReady,
        user,
    });
    const [fontsLoaded] = useFonts({
        'FFSans-Regular': Inter_400Regular,
        'FFSans-Medium': Inter_500Medium,
        'FFSans-SemiBold': Inter_600SemiBold,
        'FFSans-Bold': Inter_700Bold,
        'FFDisplay-Regular': Fraunces_400Regular,
        'FFDisplay-Medium': Fraunces_500Medium,
        'FFDisplay-Italic': Fraunces_400Regular_Italic,
        'FFDisplay-MediumItalic': Fraunces_500Medium_Italic,
        'FFDisplay-SemiBold': Fraunces_600SemiBold,
        'FFDisplay-Bold': Fraunces_700Bold,
        'FFSerif-Regular': NotoSerifKR_400Regular,
        'FFSerif-Medium': NotoSerifKR_500Medium,
        'FFSerif-SemiBold': NotoSerifKR_600SemiBold,
        'FFSerif-Bold': NotoSerifKR_700Bold,
    });

    const appOwnerStateReady = !appSetupLoading && appSetupOwnerId === activeOwnerId;
    const appReady = !loading && ownerMigrationReady && appOwnerStateReady && fontsLoaded;

    useEffect(() => {
        SystemUI.setBackgroundColorAsync(APP_BACKGROUND).catch(() => {});
    }, []);

    useEffect(() => {
        if (appReady) {
            SplashScreen.hideAsync().catch(() => {});
        }
    }, [appReady]);

    useEffect(() => {
        if (!appReady) {
            return undefined;
        }

        let cleanup = null;
        let isActive = true;

        loadRuntimeInterfaceLanguage()
            .catch((error) => {
                console.warn('[App] Failed to load interface language for overlay:', error?.message ?? error);
            })
            .finally(() => {
                if (isActive) {
                    cleanup = initializeOverlayLookupBridge();
                }
            });

        return () => {
            isActive = false;
            cleanup?.();
        };
    }, [appReady]);

    useEffect(() => {
        if (loading) {
            setOwnerMigrationReady(false);
            return undefined;
        }

        let isActive = true;
        setOwnerMigrationReady(false);

        const transitionOwner = async () => {
            const previousOwnerId = getActiveOwnerId();
            const nextOwnerId = getLocalOwnerId(user);
            const authEvent = user?.id ? 'SESSION_RESTORED' : 'SIGNED_OUT';

            try {
                const migrationStatus = await getLegacyMigrationStatus({ user });
                const hasGuestData = await hasLocalUserData(GUEST_OWNER_ID);
                if (!isActive) {
                    return;
                }

                const transitionResult = await transitionLocalOwner({
                    previousOwnerId,
                    nextOwnerId,
                    authEvent,
                    user,
                    hasGuestData,
                    hasRemoteData: false,
                    hasLegacyDecisionRequired: migrationStatus.requiresDecision,
                });
                if (!isActive) {
                    return;
                }

                if (transitionResult.status === 'blocked') {
                    const reason = transitionResult.reason === 'guest-data'
                        ? 'Guest local data requires an explicit ownership decision before cloud sync resumes.'
                        : 'Legacy local data requires an explicit migration decision before cloud sync resumes.';
                    console.warn(`[App] ${reason}`);
                }

                setOwnerMigrationReady(true);
            } catch (error) {
                if (!isActive) {
                    return;
                }

                await transitionLocalOwner({
                    previousOwnerId,
                    nextOwnerId,
                    authEvent: `${authEvent}:ERROR`,
                    user,
                    hasGuestData: false,
                    hasRemoteData: false,
                    hasLegacyDecisionRequired: Boolean(user?.id),
                });
                if (!isActive) {
                    return;
                }

                setOwnerMigrationReady(true);
                console.warn('[App] Legacy local data migration check failed; cloud sync remains paused:', error?.message ?? error);
            }
        };

        transitionOwner();

        return () => {
            isActive = false;
        };
    }, [loading, user?.id]);

    useEffect(() => {
        if (
            loading
            || !ownerMigrationReady
            || !appOwnerStateReady
            || ownershipBlocked
            || pendingOwnershipDecision
            || syncPaused
            || !user?.id
        ) {
            return;
        }

        if (activeOwnerId !== user.id) {
            return;
        }

        syncUserDataFromCloud({
            user,
            ownerId: activeOwnerId,
            generation: syncGeneration,
        }).catch((error) => {
            if (isStaleSyncGenerationError(error)) {
                return;
            }
            console.warn('[App] User data sync failed:', error?.message ?? error);
        });
    }, [
        activeOwnerId,
        appOwnerStateReady,
        loading,
        ownerMigrationReady,
        ownershipBlocked,
        pendingOwnershipDecision,
        syncGeneration,
        syncPaused,
        user?.id,
    ]);

    useEffect(() => {
        if (
            loading
            || !ownerMigrationReady
            || !appOwnerStateReady
            || ownershipBlocked
            || pendingOwnershipDecision
            || syncPaused
            || !user?.id
            || activeOwnerId !== user.id
        ) {
            return undefined;
        }

        let syncTimer = null;
        let scheduledSyncAt = null;
        let syncInFlight = false;
        let rerunAfterCurrentSync = false;
        const scheduleQueuedSync = (delayMs = DEFAULT_USER_DATA_SYNC_DELAY_MS) => {
            const nextRunAt = Date.now() + delayMs;
            if (syncTimer && scheduledSyncAt && scheduledSyncAt <= nextRunAt) {
                return;
            }

            if (syncTimer) {
                clearTimeout(syncTimer);
            }

            scheduledSyncAt = nextRunAt;
            syncTimer = setTimeout(runQueuedSync, Math.max(0, nextRunAt - Date.now()));
        };

        const runQueuedSync = () => {
            syncTimer = null;
            scheduledSyncAt = null;
            if (syncInFlight) {
                rerunAfterCurrentSync = true;
                return;
            }

            syncInFlight = true;
            syncUserDataFromCloud({
                user,
                ownerId: activeOwnerId,
                generation: syncGeneration,
            })
                .catch((error) => {
                    if (isStaleSyncGenerationError(error)) {
                        return;
                    }
                    console.warn('[App] Queued user data sync failed:', error?.message ?? error);
                })
                .finally(() => {
                    syncInFlight = false;
                    if (rerunAfterCurrentSync) {
                        rerunAfterCurrentSync = false;
                        scheduleQueuedSync();
                    }
                });
        };

        const unsubscribe = subscribeUserDataSyncRequests((request) => {
            scheduleQueuedSync(
                USER_DATA_SYNC_DELAY_BY_REASON[request?.reason] ?? DEFAULT_USER_DATA_SYNC_DELAY_MS
            );
        });

        return () => {
            if (syncTimer) {
                clearTimeout(syncTimer);
            }
            scheduledSyncAt = null;
            unsubscribe();
        };
    }, [
        activeOwnerId,
        appOwnerStateReady,
        loading,
        ownerMigrationReady,
        ownershipBlocked,
        pendingOwnershipDecision,
        syncGeneration,
        syncPaused,
        user,
        user?.id,
    ]);

    useEffect(() => {
        if (user?.id && activeOwnerId !== user.id) {
            setCurrentBook(null);
            setBooks([]);
        }
    }, [activeOwnerId, setBooks, setCurrentBook, user?.id]);

    const handleOwnershipDecision = async (action) => {
        if (!pendingOwnershipDecision || localDataDecisionBusy) {
            return;
        }

        setLocalDataDecisionBusy(true);
        try {
            await applyOwnershipDecision({
                decision: pendingOwnershipDecision,
                action,
                user,
            });
        } catch (error) {
            Alert.alert(
                translate(getRuntimeInterfaceLanguage(), 'localData.decisionFailedTitle'),
                error?.message || translate(getRuntimeInterfaceLanguage(), 'localData.decisionFailedBody')
            );
        } finally {
            setLocalDataDecisionBusy(false);
        }
    };

    useEffect(() => {
        if (
            loading
            || !ownerMigrationReady
            || !appOwnerStateReady
            || user?.id
            || activeOwnerId !== GUEST_OWNER_ID
            || ownershipBlocked
            || pendingOwnershipDecision
            || !syncPaused
        ) {
            return;
        }

        resumeCloudSync();
    }, [
        activeOwnerId,
        appOwnerStateReady,
        loading,
        ownerMigrationReady,
        ownershipBlocked,
        pendingOwnershipDecision,
        syncPaused,
        user?.id,
    ]);

    useEffect(() => {
        if (
            loading
            || !ownerMigrationReady
            || !appOwnerStateReady
            || !user?.id
            || activeOwnerId !== user.id
            || ownershipBlocked
            || pendingOwnershipDecision
            || !syncPaused
        ) {
            return;
        }

        resumeCloudSync();
    }, [
        activeOwnerId,
        appOwnerStateReady,
        loading,
        ownerMigrationReady,
        ownershipBlocked,
        pendingOwnershipDecision,
        syncPaused,
        user?.id,
    ]);

    useEffect(() => {
        if (
            loading
            || !ownerMigrationReady
            || !appOwnerStateReady
            || ownershipBlocked
            || pendingOwnershipDecision
        ) {
            return;
        }

        if (user?.id && (syncPaused || activeOwnerId !== user.id)) {
            return;
        }

        syncCloudBooks({
            user,
            ownerId: activeOwnerId,
            generation: syncGeneration,
        }).catch((error) => {
            if (isStaleSyncGenerationError(error)) {
                return;
            }
            console.warn('[App] Cloud book sync failed:', error);
        });
    }, [
        activeOwnerId,
        appOwnerStateReady,
        loading,
        ownerMigrationReady,
        ownershipBlocked,
        pendingOwnershipDecision,
        syncCloudBooks,
        syncGeneration,
        syncPaused,
        user?.id,
    ]);

    if (!appReady) {
        return null;
    }

    return (
        <AppProvider user={user}>
          <VocabWordsProvider>
            <ThemedAppShell
                books={books}
                setBooks={setBooks}
                currentBook={currentBook}
                setCurrentBook={setCurrentBook}
                setPreprocessOnOpen={setPreprocessOnOpen}
                preprocessOnOpen={preprocessOnOpen}
                user={user}
                signOut={signOut}
                updateUsername={updateUsername}
                updateProfile={updateProfile}
                updateBookPreprocessed={updateBookPreprocessed}
                pendingOwnershipDecision={pendingOwnershipDecision}
                localDataDecisionBusy={localDataDecisionBusy}
                onOwnershipDecision={handleOwnershipDecision}
            />
          </VocabWordsProvider>
        </AppProvider>
    );
}

function ThemedAppShell({
    books,
    setBooks,
    currentBook,
    setCurrentBook,
    setPreprocessOnOpen,
    preprocessOnOpen,
    user,
    signOut,
    updateUsername,
    updateProfile,
    updateBookPreprocessed,
    pendingOwnershipDecision,
    localDataDecisionBusy,
    onOwnershipDecision,
}) {
    const { colors: themeColors, isDarkMode } = useTheme();
    const appBackground = themeColors.bgPage;
    const navigationTheme = useMemo(() => ({
        ...DefaultTheme,
        colors: {
            ...DefaultTheme.colors,
            primary: themeColors.inkSlate,
            background: appBackground,
            card: appBackground,
            text: themeColors.text,
            border: themeColors.border,
            notification: themeColors.inkSlate,
        },
    }), [appBackground, themeColors]);
    const sceneContainerStyle = useMemo(() => ({
        backgroundColor: appBackground,
    }), [appBackground]);

    useEffect(() => {
        SystemUI.setBackgroundColorAsync(appBackground).catch(() => {});
    }, [appBackground]);

    return (
        <TranslatorProvider>
            <StatusBar
                style={isDarkMode ? 'light' : 'dark'}
                backgroundColor={appBackground}
                translucent={false}
            />
            <NavigationContainer theme={navigationTheme}>
                <Tab.Navigator
                    sceneContainerStyle={sceneContainerStyle}
                    screenOptions={(props) => tabScreenOptions(props, {
                        themeColors,
                    })}
                >
                    <Tab.Screen name="Home">
                        {props => (
                            <Home
                                {...props}
                                books={books}
                                setBooks={setBooks}
                                currentBook={currentBook}
                                setCurrentBook={setCurrentBook}
                                setPreprocessOnOpen={setPreprocessOnOpen}
                                user={user}
                            />
                        )}
                    </Tab.Screen>
                    <Tab.Screen name="Read">
                        {props => (
                            <Read
                                {...props}
                                books={books}
                                setBooks={setBooks}
                                currentBook={currentBook}
                                preprocessOnOpen={preprocessOnOpen}
                                user={user}
                                onPreprocessComplete={(uri) => {
                                    setPreprocessOnOpen(false);
                                    updateBookPreprocessed(uri);
                                }}
                            />
                        )}
                    </Tab.Screen>
                    <Tab.Screen name="Learn">
                        {props => (
                            <Learn
                                {...props}
                                books={books}
                                user={user}
                            />
                        )}
                    </Tab.Screen>
                    {/* Write tab shelved — see the commented-out import above to un-shelf. */}
                    <Tab.Screen name="Profile">
                        {props => (
                            <Profile
                                {...props}
                                user={user}
                                books={books}
                                signOut={signOut}
                                updateUsername={updateUsername}
                                updateProfile={updateProfile}
                            />
                        )}
                    </Tab.Screen>
                </Tab.Navigator>
            </NavigationContainer>
            <LocalDataDecisionModal
                decision={pendingOwnershipDecision}
                user={user}
                busy={localDataDecisionBusy}
                onResolve={onOwnershipDecision}
            />
        </TranslatorProvider>
    );
}
