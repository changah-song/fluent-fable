import { Text, View, StyleSheet } from 'react-native';

const Overview = () => {
    return (
        <View style={styles.container}>
            <View style={styles.section}>
                <Text>unorganized</Text>
            </View>
            <View style={[styles.section]}>
                <Text>bad</Text>
            </View>
            <View style={styles.section}>
                <Text>mid</Text>
            </View>
            <View style={styles.section}>
                <Text>good</Text>
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: 'red',
    },
    section: {
        backgroundColor: 'blue',
        width: '50%',
    }
})

export default Overview