import { StyleSheet, Text, View, Modal, Button, TextInput } from 'react-native'
import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react'
// import callGPT from '../components/callGPT';
import Translator from 'react-native-translator'

const Homescreen = () => {
  const axios = require('axios');
  const [modalVisible, setModalVisible] = useState(false);
  // const { data } = callGPT({query: 'List five cute animals.'})
  const [value, setValue] = useState('');
  const [result, setResult] = useState('');
  const [text, setText] = useState('This is an example text that will be replaced \n by ChatGPT prompts in the future iterations.');

  const openModal = () => {
    setModalVisible(true);
  };

  const closeModal = () => {
    setModalVisible(false);
  };

  // const handleLongPress = (text) => {
  //   setValue(text);
  //   openModal();
  //   console.log({value})
  // };

  const handleTextSelectionChange = (selection) => {
    if (selection.start !== selection.end) {
       const selectedContent = text.substring(selection.start, selection.end)
       console.log(selectedContent)
       setValue(selectedContent);
       openModal();
    }
  } 

  return (
    <View style={styles.container}>
      <StatusBar style={styles.container} />
      {/* <Text selectable={true} onSelect onPress={(text) => handleLongPress(text)}>
          가위 바위 보라색
      </Text> */}
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
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View>
              <Translator 
                from="en"
                to="ko"
                value={value}
                onTranslated={(t) => setResult(t)}  
              />
              <Text>{result}</Text>
            </View>
            <View style={styles.buttonContainer}>
              <Button title="Save" onPress={closeModal} />
              <Button title="Close" onPress={closeModal} />
            </View>
          </View>
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
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)', // Semi-transparent background
  },
  modalContent: {
    backgroundColor: 'white',
    padding: 20,
    borderRadius: 10,
  },
  buttonContainer: {
    flexDirection: 'row', // Horizontal layout
    justifyContent: 'space-between', // Distribute space between buttons
    marginTop: 20, // Add margin for spacing
  },
});
