import { Text, View, StyleSheet } from 'react-native';

const Overview = () => {
    return (
        <View style={styles.container}>
            <View style={{backgroundColor: '#ebf4f6', alignItems: 'center', borderRadius: 5, margin: 2, marginBottom: 5}}>
                <Text>unorganized</Text>
            </View>
            <View style={styles.slots}>
                <View style={[styles.section, {backgroundColor: '#99d3df'}]}>
                    <Text>good</Text>
                </View>
                <View style={[styles.section, {backgroundColor: '#edc9af'}]}>
                    <Text>mid</Text>
                </View>
                <View style={[styles.section, {backgroundColor: '#f4a261'}]}>
                    <Text>bad</Text>
            </View>
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        width: '95%',
        alignSelf: 'center',
        marginTop: 5,
        marginBottom: 20
    },
    slots: {
        flexDirection: 'row',
        justifyContent: 'center'
    }, 
    section: {
        width: '32%',
        borderRadius: 5,
        margin: 2,
        alignItems: 'center'
    }
})

export default Overview