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
        <View>
            {/* shows highlighted word, header */}
            <View style={styles.title}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <Text style={{ fontSize: 18, fontWeight: 'bold', fontFamily: 'serif' }}>{highlightedWord}</Text>
                </ScrollView>
            </View>
            
            {/* toggle between translator and dictionary */}
            <TouchableOpacity onPress={toggleContent} style={styles.toggleButton}>
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
    title: {
        position: 'absolute', 
        top: 2, 
        left: 5, 
        width: '85%',
        height: 25,
    },
    toggleButton: {
        left: 370,
        top: 10
    }

});

export default TopSection