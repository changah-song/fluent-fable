import AsyncStorage from '@react-native-async-storage/async-storage';
import preprocessChapter from './api/preprocessChapter';
import {
    insertBookIndexEntries,
    insertCacheEntries,
    lookupCacheByStems,
} from './Database';
import {
    normalizeBookLanguage,
    normalizeInterfaceLanguageCode,
} from '../constants/languages';

// Songs reuse the reader's book-index machinery so lyric lookups are instant:
// the backend segments the lyrics into surface→stem pairs and returns their
// dictionary entries, which we cache locally and index under a synthetic
// `song:<id>` book URI. Once indexed, tapping a word resolves surface → stem →
// cached definition entirely on-device — no remote stemming or dictionary call.

export const getSongBookUri = (songId) => (songId ? `song:${songId}` : null);

// AsyncStorage flag so we only hit the backend once per (song, content,
// interface language, script) combination instead of on every open. The lyrics
// signature invalidates the flag when the song is edited.
const preprocessMarkerKey = (ownerId, language, songId) => (
    `@ff/song-preprocess/${ownerId || 'guest'}/${normalizeBookLanguage(language)}/${songId}`
);

const lyricsSignature = (lyrics) => {
    const text = String(lyrics || '');
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
        hash = (hash * 31 + text.charCodeAt(index)) | 0;
    }
    return `${text.length}:${hash}`;
};

const buildSignature = ({ lyrics, interfaceLanguage, script }) => [
    normalizeInterfaceLanguageCode(interfaceLanguage),
    script || '',
    lyricsSignature(lyrics),
].join('|');

const preprocessSong = async ({
    song,
    ownerId,
    interfaceLanguage,
    targetLanguage,
    script,
}) => {
    const songId = song?.id;
    const bookUri = getSongBookUri(songId);
    const lyrics = String(song?.lyrics || '').trim();
    if (!bookUri || !lyrics) {
        return { indexed: 0 };
    }

    const normalizedLanguage = normalizeBookLanguage(targetLanguage);
    const normalizedInterfaceLanguage = normalizeInterfaceLanguageCode(interfaceLanguage);
    const cacheScope = {
        language: normalizedLanguage,
        interfaceLanguage: normalizedInterfaceLanguage,
    };

    const response = await preprocessChapter({
        bookUri,
        spineIndex: 0,
        text: lyrics,
        language: normalizedLanguage,
        interfaceLanguage: normalizedInterfaceLanguage,
        script,
    });

    const results = Array.isArray(response?.results) ? response.results : [];
    const surfaceIndex = Array.isArray(response?.surface_index) ? response.surface_index : [];

    // Non-English interface languages only trust cache entries fetched for that
    // same interface language; mirror the reader's guard (Read.js) so we never
    // surface an English definition where a localized one is expected.
    const cacheEntries = results
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
        return { indexed: 0 };
    }

    const cachedRows = await lookupCacheByStems(stems, cacheScope);
    const stemToId = {};
    cachedRows.forEach((row) => {
        stemToId[row.stem] = row.id;
    });

    const seenSurfaceStem = new Set();
    const bookIndexEntries = surfaceIndex
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

    await insertBookIndexEntries(bookUri, bookIndexEntries, {
        ownerId,
        language: normalizedLanguage,
    });

    return { indexed: bookIndexEntries.length };
};

/**
 * Preprocess a song's lyrics for instant on-device lookups, skipping the work
 * when the same content was already indexed for this interface language and
 * script. Safe to fire-and-forget on song open; failures are non-fatal (taps
 * fall back to the live lookup path).
 */
export const ensureSongPreprocessed = async ({
    song,
    ownerId,
    interfaceLanguage,
    targetLanguage,
    script,
} = {}) => {
    const songId = song?.id;
    const lyrics = String(song?.lyrics || '').trim();
    if (!songId || !lyrics) {
        return;
    }

    const markerKey = preprocessMarkerKey(ownerId, targetLanguage, songId);
    const signature = buildSignature({ lyrics, interfaceLanguage, script });

    try {
        const stored = await AsyncStorage.getItem(markerKey);
        if (stored === signature) {
            return;
        }
    } catch (error) {
        // A marker read failure just means we re-preprocess; not worth aborting.
    }

    await preprocessSong({ song, ownerId, interfaceLanguage, targetLanguage, script });

    try {
        await AsyncStorage.setItem(markerKey, signature);
    } catch (error) {
        console.warn('[songPreprocess] Failed to persist preprocess marker:', error?.message ?? error);
    }
};
