import { View, Text, ScrollView, StyleSheet } from "react-native";
import hanjaRelated from "../api/hanjaRelated"

const Hanja = ({ hanja }) => {
    const { firstTableData: title, similarWordsTableData: result } = hanjaRelated({ query: hanja })
    console.log('called hanja again...');
    console.log('----');
    return (
        <View style={{ flexDirection: 'column' }}>
            <View style={styles.headerContainer}>
                <Text style={styles.headerHanja}>{hanja}</Text>
                <ScrollView horizontal style={styles.headerMeaning}>
                {title.map((word, index) => {
                    return (
                        <Text key={index} style={{fontSize: 10, fontWeight: 'bold'}}>{word.meaning} </Text>
                    )
                })}
                </ScrollView>
            </View>
            <ScrollView style={styles.bodyContainer}>
                {result.map((word, index) => {
                    return (
                        <View key={index} style={styles.bodyView}>
                            <Text style={styles.text}>{word.korean}</Text>
                            <Text style={styles.text}>
                                (
                                {word.hanja.split('').map((newHanja, index) => {
                                    return(
                                        <Text key={index} style={styles.text}>{newHanja}</Text>
                                    )
                                })}
                                )
                            </Text>
                            <Text style={styles.text}> {word.meaning}</Text>
                        </View>
                    )
                })}
            </ScrollView>
        </View>
    )
}

const styles = StyleSheet.create({
    headerContainer: { flexDirection: 'row' },
    headerHanja: { fontSize: 15, marginLeft: 1},
    headerMeaning: { marginLeft: 2, marginTop: 3},

    bodyContainer: { height: '95%' },
    bodyView: { flexDirection: 'row', flexWrap: 'wrap' },
    text: { fontSize: 10 }
});

export default Hanja