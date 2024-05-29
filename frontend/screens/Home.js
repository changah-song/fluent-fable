import { Reader, ReaderProvider, useReader } from '@epubjs-react-native/core';
import { useEffect, useState } from 'react';
import { Text, View, Image, FlatList, Alert, TouchableOpacity, StyleSheet } from 'react-native'
import Icon from 'react-native-vector-icons/FontAwesome';
import { useFileSystem } from '@epubjs-react-native/expo-file-system';
import * as DocumentPicker from 'expo-document-picker';

const Home = ({ setCurrentBook }) => {
    const [books, setBooks] = useState([]);
    return (
        <ReaderProvider>
            <HandleBooks books={books} setBooks={setBooks} setCurrentBook={setCurrentBook}/>
        </ReaderProvider>
    )
}

const HandleBooks = ({ books, setBooks, setCurrentBook }) => {
    const { getMeta } = useReader();

    const addBook = async () => {
        try {
            const { title, author, cover } = await getMeta();
            const { assets } = await DocumentPicker.getDocumentAsync({copyToCacheDirectory: true});
            if (!assets) return;
            const { uri } = assets[0];
            if (uri) {
                setBooks([...books, { uri, title, author, cover }]);
            }
            console.log("it works!!", { uri, title, author });
        } catch (error) {
            console.log("Error fetching metadata:", error);
        }
    };

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

            <FlatList
                style={styles.bookList}
                data={books}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                    <TouchableOpacity onPress={() => setCurrentBook(item.uri)}>
                        <Text>{item.uri.split('/').pop()}</Text>
                    </TouchableOpacity>
                )}
            />

            <View style={styles.text}>
                {books.map((value, index) => (
                    <View key={index}>
                        <Text>Title: {value.title}</Text>
                        <Text>Author: {value.author}</Text>
                        <Image style={styles.image} source={{uri: value.cover}}/>
                    </View>
                ))}
            </View>

            <Reader src={"file:///data/user/0/host.exp.exponent/cache/DocumentPicker/7bf7acef-c5eb-4741-933b-16e8a91147cb.epub"} fileSystem={useFileSystem}></Reader>
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
        top: 200,
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