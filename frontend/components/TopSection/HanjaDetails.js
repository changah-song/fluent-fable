import { Text, View, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import hanjaRelated from '../api/hanjaRelated';

const HanjaDetails = ({ hanja, handleHanjaPress }) => {
    const result = hanjaRelated({ query: hanja })
    return (
        <Modal visible={hanja !== null} animationType="fade" transparent={true}>
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <TouchableOpacity style={styles.cancel} onPress={() => handleHanjaPress(null)}></TouchableOpacity>
                <View style={styles.modalContent}>
                    <Text>{hanja}</Text>
                    {result.map((word, index) => {
                        return (
                            <Text key={index}>{word[0]}({word[2]}) {word[1]}</Text>
                        )
                    })}
                </View>
                <TouchableOpacity onPress={() => handleHanjaPress(null)}></TouchableOpacity>
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