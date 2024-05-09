import React, { useState, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, PanResponder, Dimensions } from 'react-native';
import { NotoSerifKR_400Regular } from '@expo-google-fonts/noto-serif-kr';
import { useFonts } from 'expo-font'

const Flashcard = ({ vocab }) => {
  let [fontsLoaded] = useFonts({NotoSerifKR_400Regular});
  const [isFlipped, setIsFlipped] = useState(false);
  const [flipAnimation] = useState(new Animated.Value(0));
  const pan = useRef(new Animated.ValueXY()).current;

  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderMove: Animated.event(
      [null, { dx: pan.x }],
      { useNativeDriver: false }
    ),
    onPanResponderRelease: (e, gestureState) => {
      if (Math.abs(gestureState.dx) < 10 && Math.abs(gestureState.dy) < 10) {
        // It's a click
        flipCard();
      } else {
        // It's a swipe
        const screenWidth = Dimensions.get('window').width;
        const threshold = 0.7 * screenWidth;
        const dx = gestureState.dx;
        if (dx > threshold || dx < -threshold) {
          Animated.spring(
            pan,
            { toValue: { x: dx > 0 ? screenWidth : -screenWidth, y: 0 }, useNativeDriver: false }
          ).start(() => {
            setIsFlipped(!isFlipped);
            flipCard();
          });
        } else {
          Animated.spring(
            pan,
            { toValue: { x: 0, y: 0 }, useNativeDriver: false }
          ).start();
        }
      }
    }
  });

  const flipCard = () => {
    setIsFlipped(!isFlipped);
    Animated.timing(flipAnimation, {
      toValue: isFlipped ? 0 : 180,
      duration: 500,
      useNativeDriver: false,
    }).start();
  };

  const frontInterpolate = flipAnimation.interpolate({
    inputRange: [0, 180],
    outputRange: ['0deg', '180deg'],
  });

  const backInterpolate = flipAnimation.interpolate({
    inputRange: [0, 180],
    outputRange: ['180deg', '360deg'],
  });

  const frontAnimatedStyle = {
    transform: [{ rotateX: frontInterpolate }, { translateX: pan.x }, { translateY: pan.y }],
  };

  const backAnimatedStyle = {
    transform: [{ rotateX: backInterpolate }, { translateX: pan.x }, { translateY: pan.y }],
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={flipCard}>
        <Animated.View
          style={[styles.card, frontAnimatedStyle]}
          {...panResponder.panHandlers}
        >
          <Text style={[styles.text, {fontFamily: 'NotoSerifKR_400Regular'}]}>{vocab.word}</Text>
        </Animated.View>
        <Animated.View
          style={[styles.card, styles.flipCardBack, backAnimatedStyle]}
          {...panResponder.panHandlers}
        >
          <Text style={styles.text}>{vocab.hanja}</Text>
        </Animated.View>
      </TouchableOpacity>
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
    top: 10,
    borderWidth: 0.5,
    width: 370,
    height: 570,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'white',
    backfaceVisibility: 'hidden',
    paddingBottom: 200
  },
  text: {
    textAlign: 'center',
    marginTop: '50%',
    fontSize: 30
  },
  flipCardBack: {
    position: 'absolute',
    top: 10,
  },
});

export default Flashcard;
