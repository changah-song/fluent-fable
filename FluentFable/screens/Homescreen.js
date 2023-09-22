import { StyleSheet, Text, View, Modal, Button, TextInput, TouchableOpacity } from 'react-native'
import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react'
// import callGPT from '../components/callGPT';
import Translator from 'react-native-translator'

const Homescreen = () => {
  // required for GPT API call
  const axios = require('axios');
  // state variables to keep track of modal, selected text, translated text, and main text
  const [modalVisible, setModalVisible] = useState(false);
  // const { data } = callGPT({query: 'List five cute animals.'})
  const [selectedText, setSelectedText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [text, setText] = useState('This is an example text that will be replaced \n by ChatGPT prompts in the future iterations.');

  // small functions for opening and closing modal; might just get rid of these later
  const openModal = () => {
    setModalVisible(true);
  };

  const closeModal = () => {
    setModalVisible(false);
  };

  // ############ WORK NEEDED, SAVE WORD TO DATABASE ############
  const saveWord = () => {
    setModalVisible(false);
    console.log('saving word...')
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
      {/* ############ MAKE FONT BIGGER AND SPACE THEM OUT MORE ############ */}
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
