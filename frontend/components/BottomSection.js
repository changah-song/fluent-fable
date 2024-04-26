import React from 'react';
import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

const BottomSection = ({ text, setHighlightedWord }) => {
    const [pressedWord, setPressedWord] = useState("");

    const handleWordPress = (word) => {
      setHighlightedWord(word);
      setPressedWord(word);
    };
  
    const words = text.match(/[\p{Script=Hangul}]+|[a-zA-Z]+|[^\p{Script=Hangul}\w]|[\d]+/gu);
  
    return (
      <View style={styles.bottomSection}>
        <Text style={styles.text}>
          {words.map((word, index) => {
            const strippedWord = word.match(/[\p{L}\p{N}]+/gu) ? word : null;
            return (
              <TouchableOpacity key={index} onPress={() => strippedWord && handleWordPress(strippedWord)} style={pressedWord === strippedWord ? styles.highlighted : null}>
                <Text style={styles.text}>{word}{''}</Text>
              </TouchableOpacity>
            );
          })}
        </Text>
      </View>
    );
  };

const styles = StyleSheet.create({
  bottomSection: {
    position: 'absolute',
    bottom: 0,
    height: '90%',
    justifyContent: 'center',
    alignItems: 'left',
    padding: '10%',
    width: '120%',
  },
  text: {
    fontSize: 18,
    textAlign: 'center',
    lineHeight: 30,
  },
  highlighted: {
    backgroundColor: '#D5DEE0',
  },
});

export default BottomSection;