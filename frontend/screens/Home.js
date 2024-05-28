import { Text, View, FlatList, Alert, TouchableOpacity, StyleSheet } from 'react-native'
import Icon from 'react-native-vector-icons/FontAwesome';

const Home = ({ setSrc, books, addBook }) => {

    return (
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
                data={books}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                    <TouchableOpacity onPress={() => setSrc(item.uri)}>
                        <Text>{item.uri.split('/').pop()}</Text>
                    </TouchableOpacity>
                )}
            />
        </View>
        
    )
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