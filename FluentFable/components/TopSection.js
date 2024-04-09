import React, { useState, useEffect } from 'react';
import { Text, View, StyleSheet, TouchableOpacity, Switch, Button } from 'react-native';
import googleTranslate from '../components/googleTranslate';
import koreanDictionary from '../components/koreanDictionary';
import { Ionicons } from '@expo/vector-icons';
import { MaterialCommunityIcons } from '@expo/vector-icons';

const TopSection = ({ highlightedWord }) => {
    // const { translatedData } = googleTranslate({query: highlightedWord});
    const { dictionaryData } = koreanDictionary({query: highlightedWord});
    const [isSaved, setIsSaved] = useState(true);
    const [isContent1Visible, setIsContent1Visible] = useState(true);
    const toggleContent = () => {
        setIsContent1Visible(!isContent1Visible);
    };
    const toggleSave = () => {
        setIsSaved(!isSaved);
    }

    return (
        <View style={styles.topSection}>
            <Text style={{ fontSize: 17, position: 'absolute', top:11, left:15 }}> 
            {highlightedWord}
            </Text>
            
            <Switch
                style={{ position: 'absolute', top: 0,right:40 }}
                trackColor={{ false: "#767577", true: "#81b0ff" }}
                thumbColor={isContent1Visible ? "#f4f3f4" : "#f4f3f4"}
                onValueChange={ toggleContent }
                value={isContent1Visible}
            />

            {isSaved ? (
                <TouchableOpacity onPress={toggleSave} style={styles.button}>
                    <MaterialCommunityIcons name="content-save-check" size={28} color="black" />
                </TouchableOpacity>
            ) : (
                <TouchableOpacity onPress={toggleSave} style={styles.button}>
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
    button: {
        width: 30, // Set width to make it square
        height: 30, // Set height to make it square
        position: 'absolute', // Set position to absolute
        top: 50, // Adjust top position as needed
        right: 53, // Adjust right position as needed
        borderRadius: 5, // Example border radius
        justifyContent: 'center', // Center content vertically
        alignItems: 'center', // Center content horizontally
    }

});

export default TopSection