import React, { useState, useRef, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, PanResponder, Dimensions } from 'react-native';
import { updateLevel } from '../Database';
import Hanja from '../TopSection/Hanja';

const Flashcard = ({ vocab, setTodaySwiped }) => {
  // load font
  // state variable to keep track of if the card is flipped or not
  const [isFlipped, setIsFlipped] = useState(false);
  // initialize flip animation
  const [flipAnimation] = useState(new Animated.Value(0));
  // initialize pan resopnder for gesture input tracking
  const pan = useRef(new Animated.ValueXY()).current;

  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    // allows only for horizontal swipes
    onPanResponderMove: Animated.event(
      [null, { dx: pan.x }],
      { useNativeDriver: false }
    ),
    // when finger is released (handles both tap and swipe)
    onPanResponderRelease: (e, gestureState) => {
      if (Math.abs(gestureState.dx) < 10 && Math.abs(gestureState.dy) < 10) {
        // tap: if press and release is very short, it's a tap
        flipCard();
      } else {
        // swipe: otherwise, it's a swipe
        const screenWidth = Dimensions.get('window').width;
        // threshold for how much off screen the card needs to be before it swipes completely
        const threshold = 0.7 * screenWidth;
        // save the dx value of the swipe
        const dx = gestureState.dx;
        // conditional for what happens for big and small swipe
        if (dx > threshold || dx < -threshold) {
          Animated.spring(
            pan,
            { toValue: { x: dx > 0 ? screenWidth : -screenWidth, y: 0 }, useNativeDriver: false }
          ).start(() => {
            if (dx > threshold) {
              // swiped right
              swipeRight();
            } else if (dx <- threshold) {
              // swiped left
              swipeLeft();
            }
            setIsFlipped(!isFlipped);
            flipCard();
          });
        } else {
          // repositions itself
          Animated.spring(
            pan,
            { toValue: { x: 0, y: 0 }, useNativeDriver: false }
          ).start();
        }
      }
    }
  });

  const swipeRight = async () => {
    setTodaySwiped(prevCount => prevCount + 1);
    // Run function when swiped right
    if (vocab.level === "unorganized") {
      try {
        await updateLevel(vocab.word, vocab.hanja, vocab.def, "good");
        console.log('Level updated successfully from "unorganized" to "good!');
      } catch (error) {
        console.error('Error updating level:', error);
        return; // Stop execution if there's an error
      }
    } else if (vocab.level === "mid") {
      try {
        await updateLevel(vocab.word, vocab.hanja, vocab.def, "good");
        console.log('Level updated successfully from "mid" to "good"!');
      } catch (error) {
        console.error('Error updating level:', error);
        return; // Stop execution if there's an error
      }
    } else if (vocab.level === "bad") {
      try {
        await updateLevel(vocab.word, vocab.hanja, vocab.def, "mid");
        console.log('Level updated successfully from "bad" to "mid"!');
      } catch (error) {
        console.error('Error updating level:', error);
        return; // Stop execution if there's an error
      }
    } else if (vocab.level === "good") {
      console.log('Level is already "good", no update needed.');
    }
  };

  const swipeLeft = async () => {
    setTodaySwiped(prevCount => prevCount + 1);
    // Run function when swiped left
    if (vocab.level === "unorganized") {
      try {
        await updateLevel(vocab.word, vocab.hanja, vocab.def, "bad");
        console.log('Level updated successfully from "unorganized" to "bad"!');
      } catch (error) {
        console.error('Error updating level:', error);
        return; // Stop execution if there's an error
      }
    } else if (vocab.level === "mid") {
      try {
        await updateLevel(vocab.word, vocab.hanja, vocab.def, "bad");
        console.log('Level updated successfully from "mid" to "bad"!');
      } catch (error) {
        console.error('Error updating level:', error);
        return; // Stop execution if there's an error
      }
    } else if (vocab.level === "good") {
      try {
        await updateLevel(vocab.word, vocab.hanja, vocab.def, "mid");
        console.log('Level updated successfully from "good" to "mid"!');
      } catch (error) {
        console.error('Error updating level:', error);
        return; // Stop execution if there's an error
      }
    } else if (vocab.level === "bad") {
      console.log('Level is already "bad", no update needed.');
  }
};


  // what happens when card is tapped
  const flipCard = () => {
    setIsFlipped(!isFlipped);
    // change rotateX value from 0 - 180 over 0.5 seconds
    Animated.timing(flipAnimation, {
      toValue: isFlipped ? 0 : 180,
      duration: 500,
      useNativeDriver: false,
    }).start();
  };
  
  // helpful variables for interpolation and styling of objects
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

  const renderedHanja = useMemo(() => (
    vocab.hanja.split('').map((word, index) => (
      /[\u4e00-\u9fff]+/.test(word) 
        ? <View key={index} style={styles.individualHanja}>
            <Hanja hanja={word} />
          </View>
        : <View key={index}></View>
    ))
  ), [vocab.hanja]);

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={flipCard}>
        {/* frontside of flashcard */}
        <Animated.View
          style={[styles.card, frontAnimatedStyle]}
          {...panResponder.panHandlers}
        >
          <Text style={[styles.frontText]}>{vocab.word}</Text>
        </Animated.View>
        
        {/* backside of flashcard */}
        <Animated.View
          style={[styles.card, styles.flipCardBack, backAnimatedStyle]}
          {...panResponder.panHandlers}
        >
          <Text style={styles.backText}>{vocab.def}</Text>
          <Text style={styles.origin}>{vocab.hanja}</Text>

          <View style={styles.hanjaContainer}>
            {renderedHanja}
          </View>

        </Animated.View>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#ebf4f6'
  },
  card: {
    top: 10,
    borderWidth: 0.5,
    width: 380,
    height: 570,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'white',
    backfaceVisibility: 'hidden',
    paddingBottom: 200
  },
  frontText: {
    position: 'absolute',
    fontSize: 25,
    top: 250,
    fontFamily: 'serif'
  },
  backText: {
    position: 'absolute',
    fontSize: 25,
    top: 30
  },
  origin: {
    position: 'absolute',
    fontSize: 20,
    top: 65
  },
  flipCardBack: {
    position: 'absolute',
    top: 10,
  },

  hanjaContainer: {
    flex: 1,
    flexDirection: 'row',
    position: 'absolute',
    width: "90%",
    height: "110%",
    top: 120,
    borderWidth: 0.5,
    padding: 5,
    borderRadius: 10,
    justifyContent: 'space-between'
  },

  individualHanja: {
    flex: 1,
  }
});

export default Flashcard;
