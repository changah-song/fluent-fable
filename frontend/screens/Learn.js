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
import { Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'; // Import useFocusEffect

import ActivityChecker from '../components/Learn/ActivityChecker';
import ProgressBar from '../components/Learn/ProgressBar';
import Flashcard from '../components/Learn/Flashcard';

import { viewData } from '../components/Database';

const Learn = () => {

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
    }, []);
  
    useFocusEffect(
      React.useCallback(() => {
        fetchWords(); // Fetch data whenever screen is focused
      }, [])
    );

    console.log("current words in list:", words);

    return (
        <View>
            <ActivityChecker />
            <ProgressBar data={words.slice(1)} />
            <Flashcard data={words.slice(1)} />
        </View>
    )

};  

export default Learn