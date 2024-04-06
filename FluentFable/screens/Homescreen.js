import { StyleSheet, Text, View, Modal, TextInput, TouchableOpacity } from 'react-native'
import { StatusBar } from 'expo-status-bar';
import React, { useState, useEffect } from 'react'
// import callGPT from '../components/callGPT';
import Translator from 'react-native-translator'
import * as SQLite from 'expo-sqlite'

// import news api component
import callNews from '../components/callNews'
import callKorean from '../components/callKorean'

const Homescreen = () => {
  // required for GPT API call
  const axios = require('axios');
  // state variables to keep track of modal, selected text, translated text, and main text
  const [modalVisible, setModalVisible] = useState(false);

  // const { data } = callGPT({query: 'List five cute animals.'})  ############ ADD A RELOAD BUTTON THAT RESETS PROMPT ############
  // const { data } = callNews({query: "entertainment"});
  // const { data } = callKorean();  // <-- this will be fixed later

  const [selectedText, setSelectedText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [text, setText] = useState("6일 인스타그램과 엑스(X·옛 트위터) 등 사회관계망서비스(SNS)에는 전날부터 다양한 투표 인증 사진이 올라왔다. 이 중 젊은 세대의 눈길을 사로잡은 것은 손바닥만 한 크기의 종이를 들고 찍은 인증 사진이다. 이는 유권자가 투표소로 향하기 전 직접 챙겨간 인증 용지다. 손등에 도장을 남기던 방식에서 벗어나 투표 인증을 위한 이미지를 만든 것이다. 인증 용지에 등장하는 이미지는 만화 캐릭터, 이모티콘 캐릭터, 프로야구팀 등 다양하다. 자신의 관심 분야에 맞춰 직접 용지를 만들거나 SNS에 무료 배포된 이미지를 출력해 사용한다. 아이돌 팬들은 최애 멤버의 포토카드를 활용하기도 한다. 인증 방법은 정해져 있다. 그림 속 비워진 공간이나 글자에 기표 도장을 찍어 이미지를 완성시키면 된다.");

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
        // value={text}
        value = {text}
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
                from="ko"
                to="en"
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
