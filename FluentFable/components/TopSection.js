import React, { useState, useEffect } from 'react';
import { Text, View, StyleSheet, TouchableOpacity } from 'react-native';
import googleTranslate from './lookup/googleTranslate';
import koreanDictionary from './lookup/koreanDictionary';
import { Ionicons } from '@expo/vector-icons';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Feather } from '@expo/vector-icons';
import { MaterialIcons } from '@expo/vector-icons';

import { insertData, viewData } from './Database';

const TopSection = ({ highlightedWord }) => {
    // const { translatedData } = googleTranslate({query: highlightedWord});
    const { dictionaryData } = koreanDictionary({query: highlightedWord});
    const [isSaved, setIsSaved] = useState(true);
    const [isContent1Visible, setIsContent1Visible] = useState(true);
    const toggleContent = () => {
        setIsContent1Visible(!isContent1Visible);
    };

    const toggleSave = () => {
        insertData(highlightedWord,"umm",dictionaryData.join(", "),"unorganized");
        setIsSaved(!isSaved);
    };

    return (
        <View style={styles.topSection}>

            <Text style={{ fontSize: 18, position: 'absolute', top:11, left:15 }}> 
                {highlightedWord}
            </Text>
            
            {isContent1Visible ? (
                <TouchableOpacity onPress={toggleContent} style={styles.lookup}>
                    <MaterialIcons name="translate" size={28} color="black" />
                </TouchableOpacity>
            ) : (
                <TouchableOpacity onPress={toggleContent} style={styles.lookup}>
                    <Feather name="book-open" size={28} color="black" />
                </TouchableOpacity>
            )}

            {isSaved ? (
                <TouchableOpacity onPress={toggleSave} style={styles.save}>
                    <MaterialCommunityIcons name="content-save-check" size={28} color="black" />
                </TouchableOpacity>
            ) : (
                <TouchableOpacity onPress={toggleSave} style={styles.save}>
                    <Ionicons name="save-outline" size={28} color="black" />
                </TouchableOpacity>
            )}
    
            {isContent1Visible ? (
            <Text style={{position: 'absolute', top: 40, left: 15}}>
                {dictionaryData && dictionaryData.length > 0 && (
                <Text>{ dictionaryData.join("\n") }</Text>
                )}
            </Text>
            ) : (
            /*<Text style={{position: 'absolute', top: 40, left: 15}}>
                {translatedData && translatedData.length > 0 && (
                <Text> { translatedData } </Text>
                )}
            </Text>*/
            <Text>Placeholder</Text>
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
        height: '15%',
        justifyContent: 'center',
        alignItems: 'left',
        padding: '3%',
        backgroundColor: '#e0e0e0',
        width: '120%',
    },
    save: {
        width: 30, // Set width to make it square
        height: 30, // Set height to make it square
        position: 'absolute', // Set position to absolute
        top: 15, // Adjust top position as needed
        right: 53, // Adjust right position as needed
        borderRadius: 5, // Example border radius
        justifyContent: 'center', // Center content vertically
        alignItems: 'center', // Center content horizontally
    },
    lookup: {
        width: 30, // Set width to make it square
        height: 30, // Set height to make it square
        position: 'absolute', // Set position to absolute
        top: 15, // Adjust top position as needed
        right: 95, // Adjust right position as needed
        borderRadius: 5, // Example border radius
        justifyContent: 'center', // Center content vertically
        alignItems: 'center', // Center content horizontally
    }

});

export default TopSection