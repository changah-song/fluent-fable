import React from 'react';
import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useAppContext } from '../contexts/AppContext';

const BottomSection = ({ text, setHighlightedWord }) => {
    // use context for word or sentence mode of bottomsection
    const { dictMode } = useAppContext();
    const [pressedWord, setPressedWord] = useState("");
    const [sentenceMode, setSentenceMode] = useState(true);

    // if it's highlighted already, and is pressed again, highlight 
    // more given that the translator mode is on
    const handleWordPress = (word) => {
        if (pressedWord === word[1] && !dictMode) {
            // highlighted word is the sentence
            setSentenceMode(false);
            setHighlightedWord(sentences[word[0]]);
            setPressedWord(sentences[word[0]]);
        } else {
            setSentenceMode(true);
            setHighlightedWord(word[1]);
            setPressedWord(word[1]);
        }
    };

    // this should only remove if a sentence is highlighted
    useEffect(() => {
        setHighlightedWord("");
    }, [sentenceMode]);
  
    //const words = text.match(/[\p{Script=Hangul}]+|[a-zA-Z]+|[^\p{Script=Hangul}\w]|[\d]+/gu);
    //const sentences = text.match(/[^.!?]+[.!?]/g);

    const sentences = text.match(/[^.!?]+[.!?]/g);
    const words = [];

    sentences.forEach((sentence, sentenceIndex) => {
        const sentenceWords = sentence.match(/[\p{Script=Hangul}]+|[a-zA-Z]+|[^\p{Script=Hangul}\w]|[\d]+/gu);
        sentenceWords.forEach((word, _) => {
            words.push([sentenceIndex, word]);
        });
    });

    return (
        <View style={styles.bottomSection}>
            <Text style={styles.text}>
                {words.map((word, index) => {
                    const strippedWord = word[1].match(/[\p{L}\p{N}]+/gu) ? word : null;
                    return (
                        <TouchableOpacity 
                            key={index} 
                            onPress={() => strippedWord && handleWordPress(strippedWord)} 
                            // checks if strippedWord is null or not and then does the rest for styling
                            style={strippedWord ? (pressedWord === strippedWord[1] ? styles.highlighted : null) : null}
                        >
                            <Text style={styles.text}>{word[1]}{''}</Text>
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
    paddingLeft: '5%',
    paddingRight: '5%',
    width: '100%'
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