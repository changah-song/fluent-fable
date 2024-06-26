import { Text, View, StyleSheet, TouchableOpacity, Modal, ScrollView } from 'react-native';
import hanjaRelated from '../api/hanjaRelated';


// this is the modal popup when a hanja is clicked
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
                                <Text style={styles.hanjaHeader}> { hanja } </Text>
                                <ScrollView style={styles.hanjaHeaderDescription}>
                                {title.map((word, index) => {
                                    return (
                                        <Text key={index} style={styles.headerDescriptionText}>{word.meaning} </Text>
                                    )
                                })}
                                </ScrollView>
                            </View>
                            <ScrollView style={{height: '80%', top: 0, left: 0}}>
                                {result.map((word, index) => {
                                    return (
                                        <View key={index} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', marginBottom: 4 }}>
                                            <Text style={styles.text}>{word.korean}</Text>
                                            <View style={{flexDirection: 'row'}}>
                                                <Text style={{marginHorizontal: 5}}>(</Text>
                                                {word.hanja.split('').map((newHanja, index) => {
                                                    return(
                                                        <TouchableOpacity key={index} onPress={() => handleHanjaPress(newHanja)}>
                                                            <Text>{newHanja}</Text>
                                                        </TouchableOpacity>
                                                    )
                                                })}
                                                <Text style={{marginHorizontal: 5}}>)</Text>
                                            </View>
                                            <Text style={styles.text}>- {word.meaning}</Text>
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
        height: "85%",
        top: 100,
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
    },
    hanjaHeader: {
        fontSize: 35, 
        borderWidth: 1,
        borderRadius: 10,
        fontFamily: 'serif'
    },
    hanjaHeaderDescription: {
        height: '80%', 
        width: '50%',
        marginLeft: 10,
    },
    headerDescriptionText: {
        fontFamily: 'serif',
        fontSize: 20
    },
    text: {
    }
});

export default HanjaDetails