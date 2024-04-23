import { StyleSheet } from 'react-native';
import { useState, useEffect } from 'react';
import axios from 'axios';

const stemWord = ( {query} ) => {
  const [stemWord, setStemWord] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // apparently 10.0.2.2 is the address for android emulator :(( took so much time
  const api_url = `http:/10.0.2.2:8000/okt_morphs`;

  const options = {
      method: 'get',
      url: api_url,
      params: {
          text: query
      }
  };

  const fetchMorphs = async () => {
    setIsLoading(true);
    try {
      const response = await axios.request(options);
      if (!response.data) {
          throw new Error("Empty response data");
      }

      const filteredWords = response.data.result.filter(([word, pos]) => {
        // Filter out only nouns, verbs, adverbs, adjectives, and modifiers
        return ['Noun', 'Verb', 'Adverb', 'Adjective', 'Modifier'].includes(pos);
      });
      const filteredWordList = filteredWords.map(([word, _]) => word);
      console.log('full response', response.data.result)
      console.log('filtered response', filteredWordList)

      setStemWord(filteredWordList);
      setIsLoading(false);

    } catch (error) {
      console.error('Error fetching morphs:', error);
      setError(error.message);
      setIsLoading(false);
    }
  }

  useEffect(() => {
      fetchMorphs();
  }, [query]);

  return stemWord;
}

export default stemWord

const styles = StyleSheet.create({})