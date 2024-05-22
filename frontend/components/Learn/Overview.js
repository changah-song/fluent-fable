import { Text, View, StyleSheet } from 'react-native';

const Overview = () => {
    return (
        <View style={styles.container}>
            <View style={{alignItems: 'center', borderWidth: 1, borderRadius: 2, margin: 2, marginBottom: 5}}>
                <Text>unorganized</Text>
            </View>
            <View style={styles.slots}>
                <View style={styles.section}>
                    <Text>good</Text>
                </View>
                <View style={styles.section}>
                    <Text>mid</Text>
                </View>
                <View style={styles.section}>
                    <Text>bad</Text>
            </View>
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: 'pink',
        width: '95%',
        alignSelf: 'center'
    },
    slots: {
        flexDirection: 'row',
        justifyContent: 'center'
    }, 
    section: {
        width: '32%',
        borderWidth: 1,
        borderRadius: 5,
        margin: 2,
        alignItems: 'center'
    }
})

export default Overview