import React, { useState, useEffect } from 'react';
import { View, SafeAreaView, StyleSheet } from 'react-native';

import { Reader, ReaderProvider, useReader } from '@epubjs-react-native/core';
import { useFileSystem } from '@epubjs-react-native/expo-file-system';
import { useFocusEffect } from '@react-navigation/native';

import TopSection from '../components/TopSection';
import { AppProvider } from '../contexts/AppContext';

const Read = ({ books, setBooks, currentBook }) => {
    const [highlightedWord, setHighlightedWord] = useState('');

    useFocusEffect(
        React.useCallback(() => {
            // Reset highlightedWord when the screen loses focus
            return () => setHighlightedWord('');
        }, [])
    );

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
                    <BottomSection 
                        books={books} 
                        setBooks={setBooks} 
                        currentBook={currentBook} 
                        setHighlightedWord={setHighlightedWord}/>
                </ReaderProvider>
            </View>

        </SafeAreaView>
    );
}

const BottomSection = ({books, setBooks, currentBook, setHighlightedWord}) => {
    const { getCurrentLocation, goToLocation } = useReader();

    const saveCurrentLocation = () => {
        const currentLocation = getCurrentLocation();
        if (!currentLocation || !currentLocation.start) {
            console.log("Failed to get current location or start CFI");
            return;
        }
        const startCfi = currentLocation.start.cfi;
        setBooks(prevBooks => prevBooks.map(book => 
            book.uri === currentBook ? { ...book, location: startCfi } : book
        ));
        console.log('current location', startCfi);
    };

    const initialLocation = books.find(book => book.uri === currentBook)?.location;

    return  (
        <Reader
            src={currentBook}
            fileSystem={useFileSystem}
            enableSelection={true}
            onSelected={(text) => { setHighlightedWord(text) }}
            menuItems={[]}
            onLocationChange={() => { saveCurrentLocation() }}
            initialLocation={initialLocation || ""}
        />
    )
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
