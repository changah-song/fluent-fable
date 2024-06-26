import React, { useState, useEffect } from 'react';
import { Text, View, ScrollView, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { useAppContext } from '../../contexts/AppContext';
import Translator from 'react-native-translator';

// Translator Component
const TranslationContent = ({ highlightedWord }) => {
    // global variable
    const { dictMode } = useAppContext();
  
      // store current translated word and translator service
    const [gootranslated, setGooTranslated] = useState(''); 
    const [papTranslated, setPapTranslated] = useState('');

    const [service, setService] = useState('papago');
    // initialize translator object

    // reset translated word if mode changes
    useEffect(() => {
        setGooTranslated('');
        setPapTranslated('');
    }, [dictMode, service]);

    // once switch is pressed, change service to the other one
    const handleTypeChange = () => {
        setService(service === 'papago' ? 'google' : 'papago');
    };    

    return (
        <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', position: 'absolute', right: 0, top: 100 }}>
                <TouchableOpacity onPress={handleTypeChange} activeOpacity={0.8} style={{ zIndex:10, opacity: service==='papago' ? 1 : 0.3 }}>
                    <View style={[styles.imageContainer, { borderTopLeftRadius: 10, borderBottomLeftRadius: 10 }]}>
                        <Image source={require('../../assets/papagoicon.png')} style={styles.image} />
                    </View>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleTypeChange} activeOpacity={0.8} style={{ zIndex: 10, opacity: service==='google' ? 1 : 0.3 }}>
                    <View style={[styles.imageContainer, { borderTopRightRadius: 10, borderBottomRightRadius: 10 }]}>
                        <Image source={require('../../assets/googletranslateicon.png')} style={styles.image} />
                    </View>
                </TouchableOpacity>
            </View>

            <ScrollView style={styles.translationSection}>
                <Translator
                    from="ko"
                    to="en"
                    value={highlightedWord}
                    type={'google'}
                    onTranslated={(t) => setGooTranslated(t)}
                />                
                <Translator
                    from="ko"
                    to="en"
                    value={highlightedWord}
                    type={'papago'}
                    onTranslated={(t) => setPapTranslated(t)}
                />
                {service === 'papago' ? <Text>{papTranslated}</Text> : <Text>{gootranslated}</Text>}
            </ScrollView>   
        </View>
    )
};

const styles = StyleSheet.create({
    imageContainer: {
        borderWidth: 1, 
        borderColor: 'black', 
        padding: 2,
        backgroundColor: 'lightgray',
        right: '30%',
        top: -60
    },
    image: {
        width: 20,
        height: 20,
    },
    translationSection: {
        left: 5,
        position: 'absolute',
        width: '85%',         
    }
});

export default TranslationContent