import React from 'react';
import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useAppContext } from '../contexts/AppContext';
const BottomSection = ({ text, setHighlightedWord }) => {
    // use context for word or sentence mode of bottomsection
    const { transNotDict } = useAppContext();
    const [pressedWord, setPressedWord] = useState("");

    // if it's highlighted already, and is pressed again, highlight 
    // more given that the translator mode is on
    const handleWordPress = (word) => {
      setHighlightedWord(word);
      setPressedWord(word);
    };

    useEffect(() => {
        setHighlightedWord("");
    }, [transNotDict]);
  
    const words = text.match(/[\p{Script=Hangul}]+|[a-zA-Z]+|[^\p{Script=Hangul}\w]|[\d]+/gu);
    const sentences = text.match(/[^.!?]+[.!?]/g);

    return (
        <View style={styles.bottomSection}>
            <Text style={styles.text}>
                {transNotDict ? (
                    // display the individual words
                    words.map((word, index) => {
                        const strippedWord = word.match(/[\p{L}\p{N}]+/gu) ? word : null;
                        return (
                            <TouchableOpacity key={index} onPress={() => strippedWord && handleWordPress(strippedWord)} style={pressedWord === strippedWord ? styles.highlighted : null}>
                                <Text style={styles.text}>{word}{''}</Text>
                            </TouchableOpacity>
                        );
                    })
                ) : (

                    // display sentences joined together         
                    sentences.map((sentence, index) => {
                        return (
                            <TouchableOpacity key={index} onPress={() => handleWordPress(sentence)} style={pressedWord === sentence ? styles.highlighted : null}>
                                <Text style={styles.text}>{sentence}{''}</Text>
                            </TouchableOpacity>
                        )
                    })

                )}  
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
    flexDirection: 'row'
  },
  highlighted: {
    backgroundColor: '#D5DEE0',
  },
});

export default BottomSection;