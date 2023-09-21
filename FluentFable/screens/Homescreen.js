import { StyleSheet, Text, View } from 'react-native'
import { StatusBar } from 'expo-status-bar';
import React from 'react'
import callGPT from '../components/callGPT';

const Homescreen = () => {
  const axios = require('axios');

  const { data } = callGPT({query: 'List five cute animals.'})

  return (
    <View style={styles.container}>
      <Text>Open up App.js to start working on your app!</Text>
      <StatusBar style={styles.container} />
      <Text>{data}</Text>
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
});
