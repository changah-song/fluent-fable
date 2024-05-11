import { View, Text, ScrollView, StyleSheet } from "react-native";
import hanjaRelated from "../api/hanjaRelated"

const Hanja = ({ hanja }) => {
    const { firstTableData: title, similarWordsTableData: result } = hanjaRelated({ query: hanja })

    return (
        <View>
            <View style={styles.headerContainer}>
                <Text style={styles.headerHanja}>{hanja}</Text>
                <ScrollView style={styles.headerMeaning}>
                {title.map((word, index) => {
                    return (
                        <Text key={index} style={{fontWeight: 'bold'}}>{word.meaning} </Text>
                    )
                })}
                </ScrollView>
            </View>
            <ScrollView style={styles.bodyContainer}>
                {result.map((word, index) => {
                    return (
                        <View key={index} style={styles.bodyView}>
                            <Text>{word.korean} ( </Text>
                            {word.hanja.split('').map((newHanja, index) => {
                                return(
                                    <View key={index}>
                                        <Text>{newHanja}</Text>
                                        <Text style={{fontSize:5}}></Text>
                                    </View>
                                )
                            })}
                            <Text> ) {word.meaning}</Text>
                        </View>
                    )
                })}
            </ScrollView>
        </View>
    )
}

const styles = StyleSheet.create({
    headerContainer: {flex: 1, flexWrap: 'wrap', flexDirection: 'row', width:'100%'},
    headerHanja: {flex: 0.13, fontSize: 30, marginLeft: 7, marginTop: 2},
    headerMeaning: {flex: 0.87, height: '80%', marginTop: 7},
    bodyContainer: {height: '80%', top: 0, left: 0},
    bodyView: { flexDirection: 'row', flexWrap: 'wrap' },
});

export default Hanja