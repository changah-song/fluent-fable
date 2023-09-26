import { StyleSheet, Text, View, Modal, TextInput, TouchableOpacity } from 'react-native'
import { StatusBar } from 'expo-status-bar';
import React, { useState, useEffect } from 'react'
// import callGPT from '../components/callGPT';
import Translator from 'react-native-translator'
import * as SQLite from 'expo-sqlite'

const Homescreen = () => {
  // required for GPT API call
  const axios = require('axios');
  // state variables to keep track of modal, selected text, translated text, and main text
  const [modalVisible, setModalVisible] = useState(false);

  // const { data } = callGPT({query: 'List five cute animals.'})  ############ ADD A RELOAD BUTTON THAT RESETS PROMPT ############

  const [selectedText, setSelectedText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [text, setText] = useState('This is an example text that will be replaced \n by ChatGPT prompts in the future iterations.');

  // accesssing sqlite database
  const db = SQLite.openDatabase('words.db')
  const [words, setWords] = useState([])

  useEffect(() => {
    db.transaction(tx => {
      tx.executeSql('CREATE TABLE IF NOT EXISTS words (id INTEGER PRIMARY KEY AUTOINCREMENT, word TEXT, level INTEGER)')
    });

    db.transaction(tx => {
      tx.executeSql('SELECT * FROM words', null, 
      (txObj, resultSet) => setWords(resultSet.rows._array),
      (txOjb, error) => console.log(error))
    });
  }, []);

  const showWords = () => {
    return words.map((word, index) => {
      return (
        <View>
          <Text>{word.word}</Text>
          <Text>{word.level}</Text>
        </View>
      )
    })
  }

  // small functions for opening and closing modal; might just get rid of these later
  const openModal = () => {
    setModalVisible(true);
  };

  const closeModal = () => {
    setModalVisible(false);
  };

  const saveWord = () => {
    db.transaction(tx => {
      tx.executeSql('INSERT INTO words (word, level) values (?, ?)', [selectedText, 1],
      (txObj, resultSet) => {
        let existingWords = [...words];
        existingWords.push({ id: resultSet.insertId, word: selectedText, level: 1 });
        setWords(existingWords);
      },
      (txObj, error) => console.log(error))
    })

    closeModal();
  };

  // when text is selected, output selected text value using text.substring method
  const handleTextSelectionChange = (selection) => {
    if (selection.start !== selection.end) {
       const selectedContent = text.substring(selection.start, selection.end)
       setSelectedText(selectedContent);
       openModal(); 
    }
  } 

  return (
    <View style={styles.container}>
      <StatusBar style={styles.container} />
      <MyTextInput
        multiline={true}
        selectable={true}
        onTextSelectionChange={handleTextSelectionChange}
        value={text}
        caretHidden={true}
        inputMode="none"
      />
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent={true}
      >
        <View style={{flexDirection: 'row', flex: 1, justifyContent:'center'}}>
          <TouchableOpacity style={styles.modalOverlayLeft} onPress = {() => saveWord()}></TouchableOpacity>
          <TouchableOpacity style={styles.modalOverlayRight} onPress = {() => closeModal()}></TouchableOpacity>
          <TouchableOpacity style={styles.modalContent} activeOpacity={1}>
            <Translator 
                from="en"
                to="ko"
                value={selectedText}
                onTranslated={(t) => setTranslatedText(t)}  
            />
            <Text>{translatedText}</Text>
          </TouchableOpacity>
        </View>
        
      </Modal>
    </View>
  );
}

const MyTextInput = ({ onTextSelectionChange, ...props }) => {
  const handleTextSelectionChange = (e) => {
    onTextSelectionChange(e.nativeEvent.selection);
  };

  return <TextInput {...props} onSelectionChange={handleTextSelectionChange} />;
};

export default Homescreen

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalOverlayLeft: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 10, 0, 0.5)', 
  },
  modalOverlayRight: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(50, 0, 0, 0.5)',
  },
  modalContent: {
    position: 'absolute',
    backgroundColor: 'white',
    padding: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 350,
  },
});
