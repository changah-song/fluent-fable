import React from 'react';
import { View, StyleSheet } from 'react-native';

const ActivityChecker = () => {
  // Dummy data for activity level (0-4, where 0 is least active and 4 is most active)
  const activityData = [
    [0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0, 1, 2],
    [1, 2, 3, 4, 0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0, 1, 2, 3],
    [2, 3, 4, 0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0, 1, 2, 3, 4],
    [3, 4, 0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0]
  ];

  return (
    <View style={styles.container}>
      {activityData.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.row}>
          {row.map((activityLevel, columnIndex) => (
            <View
              key={columnIndex}
              style={[
                styles.square,
                { backgroundColor: `rgba(64, 196, 99, ${0.2 + activityLevel * 0.2})` }
              ]}
            />
          ))}
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
    padding: 10,
  },
  row: {
    flexDirection: 'row',
  },
  square: {
    width: 20,
    height: 20,
    margin: 1,
    borderRadius: 2,
    borderColor: 'black',
    borderWidth: 1
  },
});

export default ActivityChecker;