import { Text, View } from 'react-native'
import React , { useState, useEffect } from 'react'
import { useFocusEffect } from '@react-navigation/native'; // Import useFocusEffect

import { viewData } from '../Database';


const Flashcard = () => {
  const [words, setWords] = useState([]);
  console.log()
  const fetchWords = () => {
    viewData()
      .then(data => {
        setWords(data);
      })
      .catch(error => {
        console.error('Error fetching data:', error);
      });
  };
  useEffect(() => {
    fetchWords();
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      fetchWords(); // Fetch data whenever screen is focused
    }, [])
  );

  const [result, setResult] = useState('');
  const [result2, setResult2] = useState('');

  const showWords = () => {
    return words.map((word, index) => {
      return (
        <View key={index}>
          {word.word && <Text>Word: {word.word}</Text>}
          {word.def && <Text>Definition: {word.def}</Text>}
          {word.hanja && <Text>Hanja: {word.hanja}</Text>}
          {word.level && <Text>Korean Level: {word.level}</Text>}
          <Text>-------------</Text>
        </View>
      )
    })
  }

  return (
    <View>
      {showWords()}
    </View>
  )
};  

export default Flashcard