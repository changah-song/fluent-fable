import { Text, View, StyleSheet, TouchableOpacity, Modal, ScrollView } from 'react-native';
import hanjaRelated from '../api/hanjaRelated';

const HanjaDetails = ({ hanja, handleHanjaPress }) => {
    const { firstTableData: title, similarWordsTableData: result } = hanjaRelated({ query: hanja })
    return (
        <Modal visible={hanja !== null} animationType="fade" transparent={true}>
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <TouchableOpacity style={styles.cancel} onPress={() => handleHanjaPress(null)}></TouchableOpacity>
                
                <View style={styles.modalContent}>
                    {result ? 
                        <View>
                            <View style={{flex: 1, flexWrap: 'wrap', flexDirection: 'row'}}>
                                <Text style={{flex: 0.13, fontSize: 30}}>{hanja}</Text>
                                <ScrollView style={{flex: 0.87, height: '80%', marginTop: 5}}>
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
                                        <Text key={index} style={{lineHeight: 25}}>{word.korean}({word.hanja}) {word.meaning}</Text>
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