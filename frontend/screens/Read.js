import { useState, useEffect } from 'react';
import { View, SafeAreaView, StyleSheet } from 'react-native';

import { Reader, ReaderProvider, useReader } from '@epubjs-react-native/core';
import { useFileSystem } from '@epubjs-react-native/expo-file-system';

import TopSection from '../components/TopSection';
import { AppProvider } from '../contexts/AppContext';

const Read = ({ currentBook }) => {
    const [highlightedWord, setHighlightedWord] = useState('');

    return (
        <SafeAreaView style={{ flex: 1 }}>
            <View style={styles.entireTop}>
                <View style={styles.topSection}>
                    <AppProvider>
                        <TopSection highlightedWord={highlightedWord} />
                    </AppProvider>
                </View>
            </View>

            <View style={styles.reader}>
                <ReaderProvider>
                    <Reader
                        src={currentBook}
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
    entireTop: {
        top: 40, 
        flex: 0.18,
        backgroundColor: '#85929E',
        borderBottomRightRadius: 5,
        borderBottomLeftRadius: 5
    },
    loadBook: {
        backgroundColor: '#ebf4f6'
    },
    topSection: {
        height: '50%',
    },
    reader: {
        flex: 0.82,
    }
});

export default Read;
