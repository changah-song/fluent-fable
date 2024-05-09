import React, { useRef } from 'react';
import { View, Text, StyleSheet, Animated, PanResponder, Dimensions } from 'react-native';
import { NotoSerifKR_400Regular } from '@expo-google-fonts/noto-serif-kr';
import { useFonts } from 'expo-font'

const Flashcard = ({ vocab }) => {
  // initialize Font
  let [fontsLoaded] = useFonts({NotoSerifKR_400Regular});

  // initialize Animated object
  const pan = useRef(new Animated.ValueXY()).current;

  // create instance for PanResponder that handles actions
  const panResponder = PanResponder.create({
    // when touched
    onStartShouldSetPanResponder: () => true,
    // when moving: only change the x-axis AKA horizontal movement
    onPanResponderMove: Animated.event(
      [null, { dx: pan.x }],
      {useNativeDriver: false} 
      ),
    // when released: if it's a certain value off screen, it keeps going and swipes it away
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
        <Text style={styles.text}>{vocab.word}</Text>
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

  text: {
    textAlign: 'center',
    marginTop: '50%', 
    fontFamily: 'NotoSerifKR_400Regular',
    fontSize: Dimensions.get('window').width * 0.08
  }

});

export default Flashcard;