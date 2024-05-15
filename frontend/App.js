import Homescreen from './screens/Homescreen';
import Read from './screens/Read';
import Learn from './screens/Learn';
import Epub from './screens/Epub';
import { createTable, deleteAllDataFromTable, getTableSchema, insertData, viewData } from './components/Database';
import { FontAwesome5 } from '@expo/vector-icons';
import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { TranslatorProvider } from 'react-native-translator';

const Tab = createBottomTabNavigator();

export default function App() {
  useEffect(() => {
    createTable()
      .then(() => deleteAllDataFromTable())
      .then(() => createTable())
      .then(() => getTableSchema())
      .then(() => insertData())
      .then(() => viewData())
      .then(() => {
        console.log('All functions completed.');
      })
      .catch((error) => {
        console.log('Error:', error)
      });
  }, []);

  return (
    <TranslatorProvider>
      <NavigationContainer>
        <Tab.Navigator 
          screenOptions={({ route }) => ({
            tabBarIcon: ({ focused, color, size }) => {
              let iconName;
              if (route.name === 'Epub') {
                iconName = 'book';
              } else if (route.name === 'Learn') {
                iconName = 'graduation-cap';
              }
              return <FontAwesome5 name={iconName} size={size} color={color} />;
            },
          })}>
          <Tab.Screen name="Epub" component={Epub} />
          <Tab.Screen name="Learn" component={Learn} />
        </Tab.Navigator>
      </NavigationContainer>
    </TranslatorProvider>
  );
}