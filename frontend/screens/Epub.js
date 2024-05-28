import { useState } from 'react';
import { Alert, View, Text, SafeAreaView, TouchableOpacity, StyleSheet } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';

import { Reader, ReaderProvider } from '@epubjs-react-native/core';
import { useFileSystem } from '@epubjs-react-native/expo-file-system';

import TopSection from '../components/TopSection';
import { AppProvider } from '../contexts/AppContext';

const Epub = () => {
    const [highlightedWord, setHighlightedWord] = useState('');

    const [src, setSrc] = useState(null);

    return (
        <SafeAreaView style={{ flex: 1 }}>

            <View style={styles.loadBook}>

                <TouchableOpacity
                onPress={() => {
                    Alert.alert(
                    'Instructions',
                    'To make this work copy the books (.epub) located on your computer and paste in the emulator',
                    [
                        {
                        text: 'Ok',
                        onPress: async () => {
                            const { assets } = await DocumentPicker.getDocumentAsync({
                                copyToCacheDirectory: true,
                            });
                            if (!assets) return;

                            const { uri } = assets[0];

                            if (uri) setSrc(uri);
                            console.log(uri);
                        },
                        },
                    ]
                    );
                }}
                >
                <Text>  > Load EPUB book</Text>
                </TouchableOpacity>
            </View>
            <View style={styles.topSection}>
                <AppProvider>
                    <TopSection highlightedWord={highlightedWord} />
                </AppProvider>
            </View>
            <View style={styles.reader}>
                <ReaderProvider>
                    <Reader
                        src={src}
                        fileSystem={useFileSystem}
                        enableSelection={true}
                        onSelected={(text) => { setHighlightedWord(text) }}
                        menuItems={[]}
                    />
                </ReaderProvider>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    loadBook: {
        flex: 0.03,
    },
    topSection: {
        flex: 0.15,
        borderWidth: 0.5,
    },
    reader: {
        flex: 0.82,
    }
});

export default Epub;
