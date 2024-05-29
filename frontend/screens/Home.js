import { Reader, ReaderProvider, useReader } from '@epubjs-react-native/core';
import { useEffect, useState } from 'react';
import { Text, View, Image, FlatList, Alert, TouchableOpacity, StyleSheet } from 'react-native'
import Icon from 'react-native-vector-icons/FontAwesome';
import { useFileSystem } from '@epubjs-react-native/expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import { ScrollView } from 'react-native-gesture-handler';

const Home = ({ currentBook, setCurrentBook }) => {
    const [books, setBooks] = useState([]);
    return (
        <ReaderProvider>
            <HandleBooks books={books} setBooks={setBooks} currentBook={currentBook} setCurrentBook={setCurrentBook}/>
        </ReaderProvider> 
    )
}

const HandleBooks = ({ books, setBooks, currentBook, setCurrentBook }) => {
    const { getMeta } = useReader();

    const addBook = async () => {
        try {
            const { assets } = await DocumentPicker.getDocumentAsync({copyToCacheDirectory: true});
            if (!assets) return;
            const { uri } = assets[0];
            setCurrentBook(uri);
        } catch (error) {
            console.log("Error picking document:", error);
        }
    };

    useEffect(() => {
        const fetchMeta = async () => {
            if (currentBook) {
                try {
                    const { title, author, cover } = await getMeta();
                    setBooks(prevBooks => [...prevBooks, { uri: currentBook, title, author, cover }]);
                } catch (error) {
                    console.log("Error fetching metadata:", error);
                }
            }
        };

        fetchMeta();
    }, [currentBook]);

    return(
        <View>

            <View style={styles.loadBook}>
                <TouchableOpacity
                    style={styles.addButton}
                    onPress={() => {
                        Alert.alert(
                            'Instructions',
                            'To make this work, copy the books (.epub) located on your computer and paste in the emulator',
                            [
                                {
                                    text: 'Ok',
                                    onPress: addBook,
                                },
                            ]
                        );
                    }}
                >
                    <Icon name="plus" size={20} color="#ebf4f6" />
                </TouchableOpacity>
            </View>
            
            <Reader height="0" src={currentBook} fileSystem={useFileSystem}></Reader>

            <FlatList
                showsVerticalScrollIndicator={true}
                style={styles.bookList}
                data={books}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                    <TouchableOpacity onPress={() => setCurrentBook(item.uri)}>
                        <Text>Title: {item.title}</Text>
                        <Text>Author: {item.author}</Text>
                        <Image style={styles.image} source={item.cover ? { uri: item.cover } : require('../assets/favicon.png')} />
                    </TouchableOpacity>
                )}
            />

        </View>
    );
}

const styles = StyleSheet.create({
    loadBook: {
        backgroundColor: '#ebf4f6'
    },
    addButton: {
        position: 'absolute',
        top: 730,
        right: 20,
        width: 50,
        height: 50,
        borderRadius: 25,
        backgroundColor: '#f4a261',
        justifyContent: 'center',
        alignItems: 'center',
    },
    bookList: {
        position: 'absolute',
        top: 50,
        height: 750,
        width: 410
    },
    image: {
        width: 50,
        height: 80,
        borderWidth: 1, 
    },
    text: {
        position: 'absolute',
        top: 400,
    }
});

export default Home