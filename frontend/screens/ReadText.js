import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import BottomSection from '../components/BottomSection';
import TopSection from '../components/TopSection';

const ReadText = () => {
  const [highlightedWord, setHighlightedWord] = useState('');

  return (
    <View style={styles.container}>
      <TopSection highlightedWord={highlightedWord} />
      <BottomSection setHighlightedWord={setHighlightedWord} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: '10%',  // leave space for the top section
  }
});

export default ReadText;