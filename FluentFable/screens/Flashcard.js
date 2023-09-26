import { Text, View } from 'react-native'
import React , { useState, useEffect } from 'react'
import * as SQLite from 'expo-sqlite'

const Flashcard = () => {
  const db = SQLite.openDatabase('words.db')
  const [words, setWords] = useState([])

  useEffect(() => {
    db.transaction(tx => {
      tx.executeSql('SELECT * FROM words', null, 
      (txObj, resultSet) => setWords(resultSet.rows._array),
      (txOjb, error) => console.log(error))
    });
  });

  const showWords = () => {
    return words.map((word, index) => {
      return (
        <View>
          <Text>{word.word}{word.level}</Text>
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