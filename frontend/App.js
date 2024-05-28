import { Entypo } from '@expo/vector-icons';
import { FontAwesome6 } from '@expo/vector-icons';
import { Foundation } from '@expo/vector-icons';

import Home from './screens/Home';
import Learn from './screens/Learn';
import Read from './screens/Read';

import { createTable, deleteAllDataFromTable, getTableSchema, insertData, viewData } from './components/Database';
import React, { useState, useEffect } from 'react';
import { Text, View, StyleSheet } from 'react-native';

import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { TranslatorProvider } from 'react-native-translator';
import * as DocumentPicker from 'expo-document-picker';

const Tab = createBottomTabNavigator();

export default function App() {
	const [src, setSrc] = useState('');
	const [books, setBooks] = useState([]);

	const addBook = async () => {
		const { assets } = await DocumentPicker.getDocumentAsync({
			copyToCacheDirectory: true,
		});
		if (!assets) return;

		const { uri } = assets[0];
		if (uri) {
			setBooks([...books, { id: books.length.toString(), uri }]);
		}
	};

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
				let IconComponent;

				if (route.name === 'Read') {
					iconName = "book-open";
					IconComponent = FontAwesome6;
				} else if (route.name === 'Learn') {
					iconName = "pencil";
					IconComponent = Foundation;
				} else if (route.name === 'Home') {
					iconName = "home";
					IconComponent = Entypo;
				}
				// Custom icon styles
				const iconStyles = focused ? styles.iconFocused : styles.iconDefault;
				const iconColor = focused ? '#f4a261' : color;
				return (
					<View style={[styles.iconContainer, iconStyles]}>
						<IconComponent name={iconName} color={iconColor} size={26} />
					</View>
				);
				},
				tabBarLabel: ({ focused }) => {
				const labelStyle = focused ? styles.labelFocused : styles.labelDefault;
				return (
					<Text style={[labelStyle, {color: 'white', fontFamily: 'Roboto', fontSize: 12}]}>
						{route.name}
					</Text>
				)
				},
				headerShown: false,
				tabBarActiveTintColor: 'white',
				tabBarInactiveTintColor: '#f1e8e2',
				tabBarStyle: { backgroundColor: '#6e7b8b' },

			})}>
			<Tab.Screen name="Home" >
				{props => <Home {...props} books={books} addBook={addBook} src={src} setSrc={setSrc} />}
			</Tab.Screen>
			<Tab.Screen name="Read" >
				{props => <Read {...props} src={src} />}
			</Tab.Screen>
			<Tab.Screen name="Learn" component={Learn} />
			</Tab.Navigator>
		</NavigationContainer>
		</TranslatorProvider>
	);
}

const styles = StyleSheet.create({
  // styling for icons
  iconContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    top: 5
  },
  iconDefault: {
    widht: 50,
    height: 50,
    borderRadius: 10,
    padding: 5,
  },
  iconFocused: {
    top: -15,
    widht: 50,
    height: 50,
    padding: 10,
    borderRadius: 25,
    backgroundColor: '#ebf4f6',
  },
  // styling for text
  labelDefault: {
    textAlign: 'center',
    marginTop: 5,
  },
  labelFocused: {
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 5, 
  },
});
