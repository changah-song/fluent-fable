import React from 'react';
import { Text, View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
// icons for UI
import { Feather } from '@expo/vector-icons';
import { MaterialIcons } from '@expo/vector-icons';
// context for dictMode
import { useAppContext } from '../contexts/AppContext'; // import context
// logic components for tranlsation and dictionary
import TranslationContent from './TopSection/TranslationContent';
import DictionaryContent from './TopSection/DictionaryContent';

const TopSection = ({ highlightedWord }) => {
    // global variable loading and function to edit
    const { dictMode, setDictMode } = useAppContext();
    const toggleContent = () => {
        setDictMode(!dictMode);
    };

    return (
        <View style={styles.topSection}>
            {/* shows highlighted word, header */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ position: 'absolute', top:8, left:13, width: '90%' }}>
                <Text style={{ fontSize: 18 }}>{highlightedWord}</Text>
            </ScrollView>
            
            {/* toggle between translator and dictionary */}
            <TouchableOpacity onPress={toggleContent} style={styles.lookup}>
                {dictMode ? <MaterialIcons name="translate" size={25} color="black" /> : <Feather name="book-open" size={25} color="black" />}
            </TouchableOpacity>

            {/* show either dictionary or translator content depending on dictMode status */}
            {dictMode ? 
            <DictionaryContent highlightedWord={highlightedWord}/> : 
            <TranslationContent highlightedWord={highlightedWord}/>}
            
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
    lookup: {
        position: 'absolute', // Set position to absolute
        top: 10, // Adjust top position as needed
        right: 13, // Adjust right position as needed
        borderRadius: 5, // Example border radius
        justifyContent: 'center', // Center content vertically
        alignItems: 'center', // Center content horizontally
    }

});

export default TopSection