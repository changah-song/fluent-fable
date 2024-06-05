import { Reader, ReaderProvider, useReader } from '@epubjs-react-native/core';
import { useState, useEffect } from 'react';
import { Text, View, Image, FlatList, Alert, TouchableOpacity, StyleSheet } from 'react-native'
import Icon from 'react-native-vector-icons/FontAwesome';
import { useFileSystem } from '@epubjs-react-native/expo-file-system';
import * as DocumentPicker from 'expo-document-picker';

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
    const [loading, setLoading] = useState(false);
    const [bookRendered, setBookRendered] = useState(false);
    const { getMeta } = useReader();

    const addBook = async () => {
        try {
            const { assets } = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
            if (!assets) return;
            const { uri } = assets[0];
            setCurrentBook(uri);
            setBookRendered(false);  // Reset book rendered state
        } catch (error) {
            console.log("Error in addBook:", error);
        }
    };

    useEffect(() => {
        if (bookRendered && currentBook) {
            // Fetch metadata once the book is rendered
            const fetchMeta = async () => {
                try {
                    const { title, author, cover } = getMeta();
                    console.log("after getting meta info", { title });

                    // Check if the book already exists in the books array
                    const bookExists = books.some(book => book.title === title && book.author === author && book.cover === cover);
                    if (bookExists) {
                        Alert.alert('Duplicate Book', 'This book is already loaded.');
                        return;
                    }
                    // Add the book to the books array if it doesn't already exist
                    setBooks(prevBooks => [...prevBooks, { id: Math.random().toString(), uri: currentBook, title, author, cover }]);
                } catch (error) {
                    console.log("Error fetching meta:", error);
                }
            };

            fetchMeta();
        }
    }, [bookRendered]);


    const handlePress = async (uri) => {
        try {
            setLoading(true);
            await setCurrentBook(uri);
            setBookRendered(false);  // Reset book rendered state
        } catch (error) {
            console.error("Error handling book press:", error);
        } finally {
            setLoading(false);  // Set loading to false after the async operation
        }
    };

    return(
        <View>
            <TouchableOpacity
                style={styles.addButton}
                onPress={() => {
                    Alert.alert(
                        'Instructions',
                        'Choose an EPUB file to load',
                        [
                            {
                                text: 'Ok',
                                onPress: addBook
                            },
                            {
                                text: 'Cancel',
                                style: 'cancel'
                            }
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
                    <TouchableOpacity style={styles.book} onPress={() => handlePress(item.uri)}>
                        <Image style={styles.bookImage} source={item.cover ? { uri: item.cover } : require('../assets/icon.png')} />

                        <View style={styles.bookInfo}>
                            <View style={{flexWrap: 'wrap', flexDirection: 'row'}}><Text style={styles.bookTitle}>{item.title}</Text></View>
                            <Text style={styles.bookAuthor}>{item.author}</Text>
                        </View>
                    </TouchableOpacity>
                )}
            />

            <Reader
                height="0"
                src={currentBook}
                fileSystem={useFileSystem}
                onReady={() => setBookRendered(true)} 
            />

        </View>
    );
}

const styles = StyleSheet.create({
    header: {
        height: "12%",
        backgroundColor: '#6e7b8b',
        borderBottomRightRadius: 10,
        borderBottomLeftRadius: 10
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
        height: 720,
        paddingTop: 10,
        width: "100%",
        backgroundColor: 'white',
    },
    book: {
        padding: 5,
        margin: 5,
        height: 150,
        flexDirection: 'row',
        backgroundColor: 'white',
        borderRadius: 5,
        borderWidth: 0.5,
        borderColor: '#6e7b8b',
        elevation: 5
    },
    bookImage: {
        width: "25%",
        height: "100%",
        borderRadius: 10,
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