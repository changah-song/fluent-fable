import { api } from './client';

export const explainInContext = async ({
  word,
  sentence,
  language,
  interfaceLanguage,
  // Optional grounding for the agentic (EXPLAIN_USE_GRAPH) backend workflow. All
  // omittable — the backend degrades to an ungrounded explanation when absent.
  pKnown,
  hanja,
  anchorWords,
  // The dictionary result the panel already fetched on-device, reused to ground
  // the explanation (no re-query). Shape: { found: boolean, senses: [{ headword,
  // pos, definition }] }. Omittable — absent means "no dictionary signal".
  dictionary,
  timeout = 30000,
} = {}) => {
  const response = await api.post(
    '/explain_in_context/',
    {
      word,
      sentence,
      language,
      interface_language: interfaceLanguage,
      // Only include grounding fields that are actually present, so we never send
      // nulls that would look like deliberate "no signal" values.
      ...(Number.isFinite(pKnown) ? { p_known: pKnown } : {}),
      ...(hanja ? { hanja } : {}),
      ...(Array.isArray(anchorWords) && anchorWords.length ? { anchor_words: anchorWords } : {}),
      ...(dictionary ? { dictionary } : {}),
    },
    {
      timeout,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  return response.data;
};
