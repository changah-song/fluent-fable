import { useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import { isBookPreprocessed } from '../services/Database';
import { extractBookCoverColors } from '../services/bookCoverColors';
import { uploadUserBook } from '../services/bookCloudSync';
import { readEpubMetadata } from '../services/epubMetadata';
import { isCurrentSyncGeneration } from '../services/localOwnerCoordinator';
import { readPdfMetadata, renderPdfCover } from '../services/pdfMetadata';
import { SUPPORTED_BOOK_LANGUAGES, getLanguageLabel, normalizeBookLanguage } from '../constants/languages';
import { useTranslation } from './useTranslation';

const createBookId = () => {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }

    return `book-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

const useBooks = ({
    books,
    setBooks,
    setCurrentBook,
    onBookImported,
    user,
    ownerId,
    syncGeneration,
    targetLanguage = 'ko',
    setTargetLanguage = () => {},
}) => {
    const [isImporting, setIsImporting] = useState(false);
    const [openingBookUri, setOpeningBookUri] = useState(null);
    const [pdfCoverPrompt, setPdfCoverPrompt] = useState(null);
    const [pdfCoverPageInput, setPdfCoverPageInput] = useState('1');
    const pdfCoverChoiceResolverRef = useRef(null);

    const navigation = useNavigation();
    const { t } = useTranslation();
    const activeTargetLanguage = normalizeBookLanguage(targetLanguage);

    // language.* keys only cover the book languages the app supports.
    const localizedLanguageName = (code) => (
        ['ko', 'en', 'zh'].includes(code) ? t(`language.${code}`) : getLanguageLabel(code)
    );

    const getAssetFormat = (asset) => {
        const name = String(asset?.name || '').toLowerCase();
        const mimeType = String(asset?.mimeType || '').toLowerCase();
        const uri = String(asset?.uri || '').toLowerCase();

        if (
            name.endsWith('.pdf') ||
            uri.endsWith('.pdf') ||
            mimeType === 'application/pdf'
        ) {
            return 'pdf';
        }

        if (
            name.endsWith('.epub') ||
            uri.endsWith('.epub') ||
            mimeType === 'application/epub+zip'
        ) {
            return 'epub';
        }

        return null;
    };

    const pickBookAsset = async () => {
        const { assets, canceled } = await DocumentPicker.getDocumentAsync({
            copyToCacheDirectory: true,
        });

        if (canceled || !assets?.[0]) {
            return null;
        }

        const pickedAsset = assets[0];
        const format = getAssetFormat(pickedAsset);
        if (!format) {
            Alert.alert(
                t('books.unsupportedFileTitle'),
                t('books.chooseFileBody')
            );
            return null;
        }

        if (format === 'pdf' && Platform.OS !== 'android') {
            Alert.alert(
                t('books.pdfUnavailableTitle'),
                t('books.pdfUnavailableBody')
            );
            return null;
        }

        return { ...pickedAsset, format };
    };

    const promptForPdfCoverChoice = (metadata = {}) => new Promise((resolve) => {
        if (pdfCoverChoiceResolverRef.current) {
            pdfCoverChoiceResolverRef.current({ type: 'page', pageNumber: 1 });
        }

        pdfCoverChoiceResolverRef.current = resolve;
        setPdfCoverPageInput('1');
        setPdfCoverPrompt({
            title: metadata.title || t('common.untitled'),
            author: metadata.author || '',
            pageCount: Number(metadata.pageCount) || null,
        });
    });

    const resolvePdfCoverChoice = (choice) => {
        const resolver = pdfCoverChoiceResolverRef.current;
        pdfCoverChoiceResolverRef.current = null;
        setPdfCoverPrompt(null);
        setPdfCoverPageInput('1');
        resolver?.(choice);
    };

    const handlePdfCoverPageInputChange = (value) => {
        setPdfCoverPageInput(String(value || '').replace(/[^\d]/g, '').slice(0, 5));
    };

    const parsePdfCoverPageNumber = (value) => {
        const pageNumber = Number.parseInt(String(value || '1'), 10);
        const pageCount = Number(pdfCoverPrompt?.pageCount) || null;

        if (!Number.isInteger(pageNumber) || pageNumber < 1) {
            return null;
        }

        if (pageCount && pageNumber > pageCount) {
            return null;
        }

        return pageNumber;
    };

    const choosePdfCoverDefault = () => {
        resolvePdfCoverChoice({ type: 'page', pageNumber: 1 });
    };

    const choosePdfCoverNone = () => {
        resolvePdfCoverChoice({ type: 'none' });
    };

    const choosePdfCoverCustom = () => {
        const pageNumber = parsePdfCoverPageNumber(pdfCoverPageInput);
        if (!pageNumber) {
            const pageCount = Number(pdfCoverPrompt?.pageCount) || null;
            Alert.alert(
                t('books.invalidPageTitle'),
                pageCount
                    ? t('books.invalidPageRangeBody', { count: pageCount })
                    : t('books.invalidPageMinBody')
            );
            return;
        }

        resolvePdfCoverChoice({ type: 'page', pageNumber });
    };

    const addBook = async () => {
        try {
            const pickedAsset = await pickBookAsset();

            if (!pickedAsset) {
                return;
            }

            const { uri } = pickedAsset;
            const format = pickedAsset.format || 'epub';
            setIsImporting(true);

            const fallbackName = pickedAsset?.name || uri.split('/').pop() || t('common.untitled');
            const metadata = format === 'pdf'
                ? await readPdfMetadata(uri, fallbackName)
                : await readEpubMetadata(uri, fallbackName);
            const { title, author, language, wordCount } = metadata;
            // Book-driven import: keep the book's own language when we can read it.
            // metadata.language is already ko/zh/en or null (unknown / untagged, e.g.
            // most PDFs) — fall back to the learner's current target for untagged books.
            const taggedLanguage = normalizeBookLanguage(language, null);
            const detectedLanguage = taggedLanguage ?? activeTargetLanguage;
            if (!SUPPORTED_BOOK_LANGUAGES.includes(detectedLanguage)) {
                Alert.alert(
                    t('books.languageUnsupportedTitle'),
                    t('books.languageUnsupportedBody', { language: localizedLanguageName(detectedLanguage) })
                );
                setIsImporting(false);
                return;
            }

            // Importing a book in another supported language moves the learner into
            // that language, so the shelf (filtered by target language) shows it and
            // the per-language level/profile context matches what they're reading.
            if (detectedLanguage !== activeTargetLanguage) {
                setTargetLanguage(detectedLanguage);
            }
            let cover = metadata.cover;
            let pdfCoverPageNumber = null;

            if (format === 'pdf') {
                const coverChoice = await promptForPdfCoverChoice(metadata);
                if (coverChoice?.type === 'page') {
                    pdfCoverPageNumber = coverChoice.pageNumber || 1;
                    try {
                        cover = await renderPdfCover(uri, fallbackName, pdfCoverPageNumber);
                    } catch (coverError) {
                        console.warn('[useBooks] PDF cover render failed; importing without cover:', coverError);
                        Alert.alert(
                            t('books.coverNotGeneratedTitle'),
                            t('books.coverNotGeneratedBody')
                        );
                        cover = null;
                        pdfCoverPageNumber = null;
                    }
                } else {
                    cover = null;
                }
            }

            const coverColors = cover
                ? await extractBookCoverColors({
                    coverUri: cover,
                    cacheKey: `import:${uri}:${title}:${author}`,
                })
                : {};

            const existingBook = books.find(
                (book) => book.downloaded !== false
                && normalizeBookLanguage(book.language ?? 'ko') === detectedLanguage
                && (
                    book.uri === uri
                    || (
                        book.title === title
                        && book.author === author
                        && String(book.format || 'epub').toLowerCase() === format
                    )
                )
            );

            if (existingBook) {
                const needsMetadataPatch = !existingBook.originalTitle
                    || !existingBook.originalAuthor
                    || !Object.prototype.hasOwnProperty.call(existingBook, 'originalCover')
                    || (!existingBook.cover && cover)
                    || (!existingBook.language && detectedLanguage)
                    || (!existingBook.wordCount && wordCount)
                    || (!existingBook.format && format)
                    || (!existingBook.coverAccentColor && coverColors.coverAccentColor)
                    || (!existingBook.coverBackgroundColor && coverColors.coverBackgroundColor)
                    || (!existingBook.pdfCoverPageNumber && pdfCoverPageNumber);

                const openedAt = new Date().toISOString();
                setBooks((prevBooks) => prevBooks.map((book) => (
                    book.id === existingBook.id
                        ? {
                            ...book,
                            ...(needsMetadataPatch ? {
                                cover: book.cover || cover,
                                coverAccentColor: book.coverAccentColor || coverColors.coverAccentColor,
                                coverBackgroundColor: book.coverBackgroundColor || coverColors.coverBackgroundColor,
                                originalTitle: book.originalTitle || title,
                                originalAuthor: book.originalAuthor || author,
                                originalCover: Object.prototype.hasOwnProperty.call(book, 'originalCover')
                                    ? book.originalCover
                                    : cover ?? null,
                                originalFilename: book.originalFilename || fallbackName,
                                format: book.format || format,
                                language: book.language || detectedLanguage || null,
                                wordCount: book.wordCount || wordCount || null,
                                pdfCoverPageNumber: book.pdfCoverPageNumber || pdfCoverPageNumber || null,
                            } : null),
                            lastOpenedAt: openedAt,
                        }
                        : book
                )));
                setCurrentBook(existingBook.uri);
                setIsImporting(false);
                navigation.navigate('Read', { returnTo: 'Home' });
                return;
            }

            const preprocessed = await isBookPreprocessed(uri, { ownerId });
            const openedAt = new Date().toISOString();
            const newBook = {
                id: createBookId(),
                uri,
                size: pickedAsset?.size ?? null,
                format,
                title,
                author,
                cover,
                ...coverColors,
                language: detectedLanguage,
                wordCount: wordCount ?? null,
                pdfCoverPageNumber,
                originalTitle: title,
                originalAuthor: author,
                originalCover: cover ?? null,
                originalFilename: fallbackName,
                location: null,
                nativePosition: null,
                progress: 0,
                preprocessed,
                preprocessing: false,
                cloudId: null,
                cloudFilePath: null,
                cloudSyncedAt: null,
                downloaded: true,
                createdAt: openedAt,
                lastOpenedAt: openedAt,
            };

            setBooks((prevBooks) => [...prevBooks, newBook]);

            setCurrentBook(uri);
            onBookImported?.(newBook);
            setIsImporting(false);
            navigation.navigate('Read', { returnTo: 'Home' });

            if (user?.id && ownerId === user.id && isCurrentSyncGeneration(syncGeneration)) {
                uploadUserBook({
                    user,
                    ownerId,
                    generation: syncGeneration,
                    localBook: newBook,
                    pickedAsset,
                })
                    .then((cloudBook) => {
                        if (!isCurrentSyncGeneration(syncGeneration)) {
                            return;
                        }
                        setBooks((prevBooks) => prevBooks.map((book) => (
                            book.id === newBook.id
                                ? {
                                    ...book,
                                    cloudId: cloudBook.id,
                                    cloudOwnerId: cloudBook.user_id,
                                    cloudFilePath: cloudBook.file_path,
                                    cloudCoverPath: cloudBook.cover_path ?? null,
                                    cloudSyncedAt: cloudBook.updated_at ?? cloudBook.uploaded_at ?? new Date().toISOString(),
                                    downloaded: true,
                                }
                                : book
                        )));
                    })
                    .catch((uploadError) => {
                        console.warn('[useBooks] Cloud book upload failed; local import remains usable:', uploadError);
                    });
            }
        } catch (error) {
            console.error("[useBooks] Error in addBook:", error);
            Alert.alert(
                t('books.importFailedTitle'),
                error?.message || t('books.importFailedBody')
            );
            setIsImporting(false);
        }
    };

    const confirmAddBook = () => {
        Alert.alert(
            t('books.importBookTitle'),
            t('books.chooseFileBody'),
            [
                { text: t('books.importCta'), onPress: addBook },
                { text: t('common.cancel'), style: 'cancel' }
            ]
        );
    };

    const handlePress = async (uri) => {
        try {
            setOpeningBookUri(uri);
            setCurrentBook(uri);
            navigation.navigate('Read', { returnTo: 'Home' });
        } catch (error) {
            console.error("[useBooks] Error handling book press:", error);
        } finally {
            setTimeout(() => {
                setOpeningBookUri((current) => (current === uri ? null : current));
            }, 900);
        }
    };

    return {
        isImporting,
        openingBookUri,
        pdfCoverPrompt,
        pdfCoverPageInput,
        setPdfCoverPageInput: handlePdfCoverPageInputChange,
        choosePdfCoverDefault,
        choosePdfCoverNone,
        choosePdfCoverCustom,
        addBook,
        confirmAddBook,
        handlePress,
    };
};

export default useBooks;
