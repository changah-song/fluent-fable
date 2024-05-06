import { Text, View, StyleSheet, TouchableOpacity, Modal, ScrollView } from 'react-native';
import hanjaRelated from '../api/hanjaRelated';

const HanjaDetails = ({ hanja, handleHanjaPress }) => {
    // save the API call response to the consts
    const { firstTableData: title, similarWordsTableData: result } = hanjaRelated({ query: hanja })

    return (
        <Modal visible={hanja !== null} animationType="fade" transparent={true}>
            <View style={{ flex: 1, alignItems: 'center' }}>
                {/* when pressed outside modal, it should close */}
                <TouchableOpacity style={styles.cancel} onPress={() => handleHanjaPress(null)}></TouchableOpacity>
                
                {/* display all the related words and hanja definition */}
                <View style={styles.modalContent}>
                    {result ? 
                        <View>
                            <View style={{flex: 1, flexWrap: 'wrap', flexDirection: 'row', width:'100%'}}>
                                <Text style={{flex: 0.13, fontSize: 30, marginLeft: 7, marginTop: 2}}>{hanja}</Text>
                                <ScrollView style={{flex: 0.87, height: '80%', marginTop: 7}}>
                                {title.map((word, index) => {
                                    return (
                                        <Text key={index} style={{fontWeight: 'bold'}}>{word.meaning} </Text>
                                    )
                                })}
                                </ScrollView>
                            </View>
                            <ScrollView style={{height: '80%', top: 0, left: 0}}>
                                {result.map((word, index) => {
                                    return (
                                        <View key={index} style={{ flexDirection: 'row' }}>
                                            <Text>{word.korean}(</Text>
                                            {word.hanja.split('').map((newHanja, index) => {
                                                return(
                                                    <TouchableOpacity key={index} onPress={() => handleHanjaPress(newHanja)}>
                                                        <Text>{newHanja}</Text>
                                                        <Text style={{fontSize:5}}></Text>
                                                    </TouchableOpacity>
                                                )
                                            })}
                                            <Text>) {word.meaning}</Text>
                                        </View>
                                    )
                                })}
                            </ScrollView>
                        </View>
                    :
                    <View>
                        <Text>{hanja}</Text>
                        <Text>Not Available...</Text>
                    </View>
                    }

                </View>
                
            </View>
        </Modal>
    )
};

const styles = StyleSheet.create({
    modalContent: {
        position: 'absolute',
        width: "90%",
        height: "65%",
        top: 220,
        backgroundColor: 'white', 
        padding: 10,
        borderRadius: 10,

        justifyContent: 'center',
        alignItems: 'center'
    },
    cancel: {
        position: 'absolute',
        width: "100%",
        height: "100%",
        backgroundColor: 'rgba(168, 162, 158, 0.5)', 
        opacity: '100%',
        padding: 10,
        borderRadius: 10,
        justifyContent: 'center',
        alignItems: 'center'
    }
});

export default HanjaDetails