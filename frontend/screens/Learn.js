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

import { Text, View } from 'react-native'
import React , { useState, useEffect } from 'react'
import ActivityChecker from '../components/Learn/ActivityChecker';
import ProgressBar from '../components/Learn/ProgressBar';

const Learn = () => {

    return (
        <View>
            <ActivityChecker />
            <ProgressBar />
        </View>
    )

};  

export default Learn