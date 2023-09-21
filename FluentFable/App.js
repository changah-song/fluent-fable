import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import callGPT from './callGPT';

export default function App() {
  const axios = require('axios');

  const { data } = callGPT({query: 'List five cute animals.'})

  return (
    <View style={styles.container}>
      <Text>Open up App.js to start working on your app!</Text>
      <StatusBar style="auto" />
      <Text>{data}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
