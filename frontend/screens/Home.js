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
        <View>
            <View style={styles.header}>
                <Text style={styles.title}>Books</Text>
            </View>
            <View style={styles.body}>
            <ReaderProvider>
                <HandleBooks books={books} setBooks={setBooks} currentBook={currentBook} setCurrentBook={setCurrentBook}/>
            </ReaderProvider> 
            </View>
        </View>
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
        
            <FlatList
                showsVerticalScrollIndicator={true}
                style={styles.bookContainer}
                data={books}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                    <TouchableOpacity style={styles.book} onPress={() => setCurrentBook(item.uri)}>
                        <Image style={styles.bookImage} source={item.cover ? { uri: item.cover } : require('../assets/favicon.png')} />

                        <View style={styles.bookInfo}>
                            <View style={{flexWrap: 'wrap', flexDirection: 'row'}}><Text style={styles.bookTitle}>{item.title}</Text></View>
                            <Text style={styles.bookAuthor}>{item.author}</Text>
                        </View>
                    </TouchableOpacity>
                )}
            />

            <View style={{height:0}}><Reader height="0" src={currentBook} fileSystem={useFileSystem}></Reader></View>

        </View>
    );
}

const styles = StyleSheet.create({
    header: {
        height: "12%",
        backgroundColor: '#6e7b8b',
    }, 
    title: {
        position: 'absolute',
        top: 45,
        left: 12,
        fontSize: 25,
        fontFamily: 'Roboto',
        color: '#ebf4f6'
    }, 
    body: {
        height: "88%",
    },  
    addButton: {
        position: 'absolute',
        top: 640,
        right: 30,
        width: 50,
        height: 50,
        borderRadius: 25,
        backgroundColor: '#f4a261',     
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 5
    },
    bookContainer: {
        height: 750,
        width: "100%",
        backgroundColor: '#38596e'
    },
    book: {
        padding: 5,
        margin: 5,
        height: 150,
        flexDirection: 'row',
        backgroundColor: 'white',
        borderRadius: 5,
    },
    bookImage: {
        width: "25%",
        height: "100%",
    },
    bookInfo: {
        marginLeft: 8,
        width: "73%",
        flexWrap: 'wrap',
        flexDirection: 'col',
    },
    bookTitle: {
        fontSize: 18,
        fontWeight: 'bold'
    },
    bookAuthor: {
    }
});

export default Home