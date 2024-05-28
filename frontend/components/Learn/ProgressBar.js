import React from 'react';
import { Text, View, StyleSheet } from 'react-native';

const ProgressBar = ({ data }) => { 

  // Initialize counters for each level
  let unorganizedCount = 0;
  let badCount = 0;
  let midCount = 0;
  let goodCount = 0;

  // Total count of items
  const totalCount = data.length;

  // Calculate counts for each level
  data.forEach(item => {
    switch (item.level) {
      case 'unorganized':
        unorganizedCount++;
        break;
      case 'bad':
        badCount++;
        break;
      case 'mid':
        midCount++;
        break;
      case 'good':
        goodCount++;
        break;
      default:
        break;
    }
  });

  // Calculate percentages
  const unorganizedPercent = (unorganizedCount / totalCount) * 100;
  const badPercent = (badCount / totalCount) * 100;
  const midPercent = (midCount / totalCount) * 100;
  const goodPercent = (goodCount / totalCount) * 100;

  return (
    <View>
      <View style={styles.container}>
        <View style={[styles.bar, { width: `${unorganizedPercent}%`, backgroundColor: '#edc9af' }]}>
          <Text style={styles.text}>{`${unorganizedCount}`}</Text>
        </View>
        <View style={[styles.bar, { width: `${badPercent}%`, backgroundColor: '#f4a261' }]}>
          <Text style={styles.text}>{`${badCount}`}</Text>
        </View>
        <View style={[styles.bar, { width: `${midPercent}%`, backgroundColor: '#ebf4f6' }]}>
            <Text style={styles.text}>{`${midCount}`}</Text>
        </View>
        <View style={[styles.bar, { width: `${goodPercent}%`, backgroundColor: '#99d3df' }]}>
            <Text style={styles.text}>{`${goodCount}`}</Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    height: 20,
    marginTop: 100,
    marginBottom: 10,
    marginRight: 10,
    marginLeft: 10,
    borderRadius: 5,
    overflow: 'hidden', // makes sure parent is on top for border radius
    backgroundColor: '#6e7b8b'
  },
  bar: {
    alignItems: 'center'
  },
  text: {
    color: 'white'
  }
});

export default ProgressBar;