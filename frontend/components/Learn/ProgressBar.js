import React from 'react';
import { Text, View, StyleSheet } from 'react-native';

const ProgressBar = () => {

const data = [
    { word: 'example1', def: 'definition1', hanja: 'hanja1', level: 'unorganized' },
    { word: 'example2', def: 'definition2', hanja: 'hanja2', level: 'unorganized' },
    { word: 'example3', def: 'definition3', hanja: 'hanja3', level: 'good' },
    { word: 'example4', def: 'definition4', hanja: 'hanja4', level: 'mid' },
    { word: 'example5', def: 'definition5', hanja: 'hanja5', level: 'unorganized' },
    { word: 'example6', def: 'definition6', hanja: 'hanja6', level: 'unorganized' },
    { word: 'example7', def: 'definition7', hanja: 'hanja7', level: 'good' },
    { word: 'example8', def: 'definition8', hanja: 'hanja8', level: 'good' },
    { word: 'example9', def: 'definition9', hanja: 'hanja9', level: 'unorganized' },
    { word: 'example10', def: 'definition10', hanja: 'hanja10', level: 'bad' },
    // Add more entries as needed
    ];

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
        <View style={[styles.bar, { width: `${unorganizedPercent}%`, backgroundColor: '#ccc' }]}>
          <Text style={styles.text}>{`${unorganizedCount}`}</Text>
        </View>
        <View style={[styles.bar, { width: `${badPercent}%`, backgroundColor: '#FF6363' }]}>
          <Text style={styles.text}>{`${badCount}`}</Text>
        </View>
        <View style={[styles.bar, { width: `${midPercent}%`, backgroundColor: '#FFCD63' }]}>
            <Text style={styles.text}>{`${midCount}`}</Text>
        </View>
        <View style={[styles.bar, { width: `${goodPercent}%`, backgroundColor: '#63FFA1' }]}>
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
    marginBottom: 10,
    marginRight: 10,
    marginLeft: 10,
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden' // makes sure parent is on top
  },
  bar: {
    alignItems: 'center'
  }
});

export default ProgressBar;