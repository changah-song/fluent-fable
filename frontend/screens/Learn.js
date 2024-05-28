// Variables needed: LEARNED, day, 

// TrackProgress.js
    // use LEARNED variable

// ProgressBar.js
    // need database
        // count of every 'level' attribute of data elements

// Flashcard.js
    // need database
    // HanjaDetails.js
    // update LEARNED variable

    // logic: if swiped right, move onto next color, swipe left stays same color
    //        show green after 1 week
    //        show yellow after 3 days
    //        show red after 1 day

import React , { useState, useEffect } from 'react'
import { Text, View, StyleSheet } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'; // Import useFocusEffect

import ActivityChecker from '../components/Learn/ActivityChecker';
import ProgressBar from '../components/Learn/ProgressBar';
import Flashcard from '../components/Learn/Flashcard';
import Overview from '../components/Learn/Overview';

import { viewData } from '../components/Database';

const Learn = () => {
    const [todaySwiped, setTodaySwiped] = useState(0);
    // load in Data from database
    const [words, setWords] = useState([]);
    const fetchWords = () => {
      viewData()
        .then(data => {
          setWords(data);
        })
        .catch(error => {
          console.error('Error fetching data:', error);
        });
    };

    useEffect(() => {
      fetchWords();
    }, [todaySwiped]);
  
    useFocusEffect(
      React.useCallback(() => {
        fetchWords(); // Fetch data whenever screen is focused
      }, [])
    );

    console.log("current words in list:", words.slice(1));

    return (
        <View>
          <View style={styles.progressSection}>
            <Text style={styles.title}>Flashcards</Text>
            <ProgressBar data={words.slice(1)} />
            <Overview />
          </View>
            {words.slice(1).map((vocab, index) => {
              return (
                <View key={index}>
                  <Flashcard vocab={vocab} todaySwiped={todaySwiped} setTodaySwiped={setTodaySwiped}/>
                </View>
              )
            })}
        </View>
    )

};  

const styles = StyleSheet.create({
  progressSection: {
    backgroundColor: '#6e7b8b',
    marginBottom: 10,
    borderBottomRightRadius: 10,
    borderBottomLeftRadius: 10
  },
  title: {
    position: 'absolute',
    top: 45,
    left: 12,
    fontSize: 25,
    fontFamily: 'Roboto',
    color: '#ebf4f6'
  }
})


export default Learn