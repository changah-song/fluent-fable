import React, { useState, useEffect } from 'react';
import { Text, View, StyleSheet, TouchableOpacity, ScrollView, Switch, CheckBox } from 'react-native';

import Translator from 'react-native-translator';
import koreanDictionary from './api/koreanDictionary';
import stemWord from './api/stemWord';

import { Feather } from '@expo/vector-icons';
import { MaterialIcons } from '@expo/vector-icons';
import { AntDesign } from '@expo/vector-icons';

import { insertData, removeData } from './Database';

const TopSection = ({ highlightedWord }) => {
    // handles 'more' and 'less' to control how much info is displayed from dictionary def
    const [expandedWords, setExpandedWords] = useState([]);
    const toggleExpanded = (word) => {
        setExpandedWords((prevExpandedWords) =>
            prevExpandedWords.includes(word) ? prevExpandedWords.filter((w) => w !== word) : [...prevExpandedWords, word]
        );
    };

    const [translated, setTranslated] = useState(''); 
    const [type, setType] = useState('papago');
    
    const [transNotDict, setTransNotDict] = useState(true);
    const [savedWords, setSavedWords] = useState({});

    const stemWordList  = stemWord({ query: highlightedWord });
    const { dictionaryData } = koreanDictionary({ query: stemWordList });
    
    const toggleContent = () => {
        setTransNotDict(!transNotDict);
    };

    const handleTypeChange = () => {
        setType(type === 'papago' ? 'google' : 'papago');
    };

    // add word to database and toggle save
    const toggleSave = async (word, origin, definition) => {
        const updatedSavedWords = { ...savedWords, [(word, origin, definition)]: true };
        setSavedWords(updatedSavedWords);
        insertData(word, origin, definition, "unorganized");
    };

    // remove word from database and toggle unsave
    const toggleUnSave = async (word, origin, definition) => {
        const updatedSavedWords = { ...savedWords };
        delete updatedSavedWords[(word, origin, definition)];
        setSavedWords(updatedSavedWords);
        removeData(word, origin, definition);
    }

    const isWordSaved = (word, origin, definition) => savedWords[(word, origin, definition)] === true;

    return (
        <View style={styles.topSection}>

            <Text style={{ fontSize: 18, position: 'absolute', top:8, left:13 }}>{highlightedWord}</Text>
            
            {/* toggle between translator and dictionary */}
            <TouchableOpacity onPress={toggleContent} style={styles.lookup}>
                {transNotDict ? <MaterialIcons name="translate" size={25} color="black" /> : <Feather name="book-open" size={25} color="black" />}
            </TouchableOpacity>
                
            {transNotDict ? (
            <ScrollView style={{ marginTop: 30, marginLeft: 0 }}>
                {stemWordList.map((word, index) => (
                    <View key={index}>
                        {dictionaryData[index] && dictionaryData[index].length > 0 ? (
                            <>
                            {/* this shows the first entry of the dictionary definition */}
                            <View>

                                <TouchableOpacity onPress={() => isWordSaved(word, dictionaryData[index][0].origin, dictionaryData[index][0].transWord) 
                                    ? toggleUnSave(word, dictionaryData[index][0].origin, dictionaryData[index][0].transWord) 
                                    : toggleSave(word, dictionaryData[index][0].origin, dictionaryData[index][0].transWord)} 
                                    style={styles.save}>
                                    <AntDesign name={isWordSaved(word, dictionaryData[index][0].origin, dictionaryData[index][0].transWord) 
                                        ? "checksquare" : "checksquareo"} size={15} color="black" />
                                </TouchableOpacity>

                                <View style={styles.content}>
                                    <Text style={{ fontWeight: 'bold' }}>{word}</Text>
                                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                        <Text style={{ marginHorizontal: 5 }}>(</Text>
                                        <TouchableOpacity>
                                            <Text>{dictionaryData[index][0].origin}</Text>
                                        </TouchableOpacity>
                                        <Text style={{ marginHorizontal: 5 }}>)</Text>
                                        <Text>{dictionaryData[index][0].transWord}</Text>
                                    </View>
                                    {dictionaryData[index].length > 1 ? (
                                        <TouchableOpacity onPress={() => toggleExpanded(word)}>
                                            <Text style={{ color: 'blue', textDecorationLine: 'underline', marginLeft: 5}}>
                                                {expandedWords.includes(word) ? 'less' : 'more'}
                                            </Text>
                                        </TouchableOpacity>
                                    ) : null}
                                </View>

                            </View>
                            {/* shows the rest of the definitions once 'more' is pressed */}
                            {expandedWords.includes(word) &&
                                dictionaryData[index].slice(1).map((entry, i) => (
                                    <View key={i} style={{ flexDirection: 'row', alignItems: 'center' }}>

                                        <TouchableOpacity onPress={() => isWordSaved(entry.word, entry.origin, entry.transWord) 
                                            ? toggleUnSave(entry.word, entry.origin, entry.transWord) 
                                            : toggleSave(entry.word, entry.origin, entry.transWord)} style={styles.save}>
                                            <AntDesign name={isWordSaved(entry.word, entry.origin, entry.transWord) 
                                                ? "checksquare" : "checksquareo"} size={15} color="black" style={{ opacity: 0.5 }}/>
                                        </TouchableOpacity>

                                        <View style={styles.content}>
                                            <Text>{entry.word}</Text>
                                            <Text style={{ marginHorizontal: 5 }}>(</Text>
                                            <TouchableOpacity>
                                                <Text>{entry.origin}</Text>
                                            </TouchableOpacity>
                                            <Text style={{ marginHorizontal: 5 }}>)</Text>
                                            <Text>{entry.transWord}</Text>
                                        </View>
                                    </View>
                                ))}
                            </>
                        ) : (
                            <Text> "Loading..." </Text>
                        )}
                    </View>
                ))}
            </ScrollView>
            ) : (
            <ScrollView style={{ marginTop: 30 }}>
                <Switch
                    value={type === 'google'}
                    onValueChange={handleTypeChange}
                    style={{ top: -12, right: -42, transform: [{ scaleX: .8 }, { scaleY: .8 }] }}
                />
                <Translator
                from="ko"
                to="en"
                value={highlightedWord}
                type={type}
                onTranslated={(t) => setTranslated(t)}
                />
                <Text style={{ position: 'absolute', top: 0}}>
                    {type === 'papago' 
                    ? <Text><Text style={{ fontWeight: 'bold' }}>Papago</Text>: {translated}</Text> 
                    : <Text><Text style={{ fontWeight: 'bold' }}>Google</Text>: {translated}</Text>}
                </Text>
            </ScrollView>
            )}
            
        </View>
    );
  };

const styles = StyleSheet.create({

    topSection: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: '20%',
        justifyContent: 'center',
        alignItems: 'left',
        padding: '3%',
        backgroundColor: '#e0e0e0',
        width: '100%',
    },
    save: {
        position: 'absolute', // Set position to absolute
        top: 3, // Adjust top position as needed
        left: 5, // Adjust right position as needed
        borderRadius: 5, // Example border radius
        justifyContent: 'center', // Center content vertically
        alignItems: 'center', // Center content horizontally
    },
    lookup: {
        position: 'absolute', // Set position to absolute
        top: 10, // Adjust top position as needed
        right: 13, // Adjust right position as needed
        borderRadius: 5, // Example border radius
        justifyContent: 'center', // Center content vertically
        alignItems: 'center', // Center content horizontally
    },
    content: {
        left: 25,
        flexDirection: 'row'
    }

});

export default TopSection