import React, { useRef } from 'react';
import { View, Text, StyleSheet, Animated, PanResponder, Dimensions } from 'react-native';

const Flashcard = ({ vocab }) => {
  const pan = useRef(new Animated.ValueXY()).current;

  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderMove: Animated.event(
      [null, { dx: pan.x }],
      {useNativeDriver: false} 
      ),
    onPanResponderRelease: () => {
      const screenWidth = Dimensions.get('window').width;
      const threshold = 0.7 * screenWidth;
      const dx = pan.x._value; // Access the current x-value from the Animated.Value
      if (dx > threshold || dx < -threshold) {
        Animated.spring(
          pan,
          { toValue: { x: dx > 0 ? screenWidth : -screenWidth, y: 0 }, useNativeDriver: false }
        ).start();
      } else {
        Animated.spring(
          pan,
          { toValue: { x: 0, y: 0 }, useNativeDriver: false }
        ).start();
      }
    }
  });

  return (
    <View style={styles.container}>
      <Animated.View
        style={[
          styles.card,
          { transform: [{ translateX: pan.x }, { translateY: pan.y }] }
        ]}
        {...panResponder.panHandlers}
      >
        <Text>{vocab.word}</Text>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center'
  },

  card: {
    position: 'absolute',
    top: 10,
    borderWidth: 1,
    backgroundColor: 'white',
    width: '96%',
    height: 560,
    borderRadius: 4
  },
});

export default Flashcard;