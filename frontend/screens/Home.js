import { Reader, ReaderProvider, useReader } from '@epubjs-react-native/core';
import { useEffect, useState } from 'react';
import { Text, View, Image, FlatList, Alert, TouchableOpacity, StyleSheet } from 'react-native'
import Icon from 'react-native-vector-icons/FontAwesome';
import { useFileSystem } from '@epubjs-react-native/expo-file-system';

const Home = ({ src, setSrc, books, addBook }) => {
    const [metaData, setMetaData] = useState([]);

    return (
        <ReaderProvider>
            <View style={styles.entireTop}>
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
                    style={{top: 50}}
                    data={books}
                    keyExtractor={(item) => item.id}
                    renderItem={({ item }) => (
                        <TouchableOpacity onPress={() => setSrc(item.uri)}>
                            <Text>{item.uri.split('/').pop()}</Text>
                        </TouchableOpacity>
                    )}
                />
                <View style={{height: 0}}>
                    {src && <BookInfo src={src} metaData={metaData} setMetaData={setMetaData} />}
                </View>
                
                {}
                
            </View>
        </ReaderProvider>
    )
}

const BookInfo = ({src, metaData, setMetaData}) => {
    const { getMeta } = useReader();

    useEffect(() => {
        // Function to log metadata
        const logMetadata = async () => {
            try {
                console.log('Attempting to fetch metadata...');
                const metadata = await getMeta();                
                setMetaData([...metaData, [metadata.cover, metadata.title, metadata.author]])
            } catch (error) {
                console.error('Error fetching metadata:', error);
            }
        };

        // Call the function to log metadata
        logMetadata();
    }, [src, getMeta]);

    return(
        <Reader src={src} fileSystem={useFileSystem}></Reader>
    );
}

const styles = StyleSheet.create({
    entireTop: {
        flex: 0.18,
        backgroundColor: '#85929E',
        borderBottomRightRadius: 5,
        borderBottomLeftRadius: 5
    },
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
});

export default Home