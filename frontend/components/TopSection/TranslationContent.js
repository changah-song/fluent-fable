import React, { useState, useEffect } from 'react';
import { Text, View, ScrollView, StyleSheet, Switch } from 'react-native';
import { useTranslator } from 'react-native-translator';
import { useAppContext } from '../../contexts/AppContext';

// Translator Component
const TranslationContent = ({ highlightedWord }) => {
    // global variable
    const { dictMode } = useAppContext();

    // store current translated word and translator service
    const [translated, setTranslated] = useState(''); 
    const [service, setService] = useState('papago');
    // initialize translator object
    const { translate } = useTranslator();

    // reset translated word if mode changes
    useEffect(() => {
        setTranslated('');
    }, [dictMode]);

    // Whenever highlightedWord or service changes, update the translation
    useEffect(() => {
        if (highlightedWord) {
          translateText();
        }
    }, [highlightedWord, service]);
    
    // once switch is pressed, change service to the other one
    const handleTypeChange = () => {
        setService(service === 'papago' ? 'google' : 'papago');
    };    

    // calls the Translator promise to translate highlightedWord
    const translateText = async () => {
        if (highlightedWord) {
            try{ 
                const translation = await translate('ko', 'en', highlightedWord, { service });
                setTranslated(translation);
            } catch(error) {
                console.error('Translation failed:', error);
                setTranslated('Translation failed');
            }
        }
    };

    return (
        <View style={{ flex: 1 }}>
            <Switch
                    value={service === 'papago'}
                    onValueChange={handleTypeChange}
                    style={{ position: 'absolute', right: 20, top: 50, transform: [{ scaleX: .8 }, { scaleY: .8 }] }}
                />
            <ScrollView style={{ marginTop: 30 }}>
                {translated ? (
                    <Text style={{ flex: 0.8, width: '95%' }}>{translated}</Text>
                ) : (
                    <Text style={{ flex: 1, width: '95%'}}>No translation available</Text>
                )}
            </ScrollView>   
        </View>
    )
};

const styles = StyleSheet.create({});

export default TranslationContent