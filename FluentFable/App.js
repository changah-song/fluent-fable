import Homescreen from './screens/Homescreen';
import Flashcard from './screens/Flashcard';

import { FontAwesome5 } from '@expo/vector-icons';

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

const Tab = createBottomTabNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Tab.Navigator 
        screenOptions={({ route }) => ({
          tabBarIcon: ({ focused, color, size }) => {
            let iconName;
            if (route.name === 'Read') {
              iconName = 'book';
            } else if (route.name === 'Learn') {
              iconName = 'graduation-cap';
            }
            return <FontAwesome5 name={iconName} size={size} color={color} />;
          },
        })}>
        <Tab.Screen name="Read" component={Homescreen} />
        <Tab.Screen name="Learn" component={Flashcard} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}