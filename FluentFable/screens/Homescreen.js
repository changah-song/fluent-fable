import { StyleSheet, Text, View, Modal, Button } from 'react-native'
import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react'
// import callGPT from '../components/callGPT';

const Homescreen = () => {
  const axios = require('axios');
  const [modalVisible, setModalVisible] = useState(false);
  // const { data } = callGPT({query: 'List five cute animals.'})

  const openModal = () => {
    setModalVisible(true);
  };

  const closeModal = () => {
    setModalVisible(false);
  };

  return (
    <View style={styles.container}>
      <StatusBar style={styles.container} />
      <Text 
        selectable={false}
        onLongPress={openModal}>
          This is an example sentence!
      </Text>
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent={true}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text>Additional information goes here.</Text>
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
