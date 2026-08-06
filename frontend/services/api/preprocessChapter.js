import { api } from './client';
import { normalizeBookLanguage, normalizeInterfaceLanguageCode } from '../../constants/languages';
import { getRuntimeChineseScript } from '../interfaceLanguage';

const emptyChapterResult = {
  results: [],
  surface_index: [],
  stats: {
    total_stems: 0,
    cache_hits: 0,
    new_fetched: 0,
  },
};

const preprocessChapter = async ({
  bookUri,
  spineIndex,
  text,
  language = 'ko',
  interfaceLanguage = 'en',
  script = getRuntimeChineseScript(),
}) => {
  const targetLanguage = normalizeBookLanguage(language);
  const normalizedInterfaceLanguage = normalizeInterfaceLanguageCode(interfaceLanguage);

  if (!text || text.trim() === '') {
    return {
      book_uri: bookUri,
      spine_index: spineIndex,
      ...emptyChapterResult,
    };
  }

  const endpointByLanguage = {
    en: '/preprocess_chapter_en/',
    zh: '/preprocess_chapter_zh/',
  };
  const endpoint = endpointByLanguage[targetLanguage] ?? '/preprocess_chapter/';

  const response = await api.post(
    endpoint,
    {
      book_uri: bookUri,
      spine_index: spineIndex,
      text,
      language: targetLanguage,
      interface_language: normalizedInterfaceLanguage,
      script,
    },
    {
      timeout: 45000,
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );

  return response.data;
};

export default preprocessChapter;
