import { StyleSheet, Text, View } from 'react-native';
import { useState, useEffect } from 'react';
import axios from 'axios';


const callNews = ( {query} ) => {
    // const [fromDate, setFromDate] = useState(query[0]);
    const [sortBy, setSortBy] = useState('relevance');
    const [data, setData] = useState(null);
    const [country, setCountry] = useState('kr')
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);

    const API_KEY = '7f6c3d9ca2c54b09a98bc0e12661b644';

    const fetchData = async () => {    
        setIsLoading(true);
        const url = `https://newsapi.org/v2/top-headlines?country=kr&category=${query}&apiKey=${API_KEY}`;

        // country=${country}&q=${query}&sortBy=${sortBy}&
        try {
            const response = await axios.get(url)
            console.log(response.data['articles'][5]['description'])
            setData(response.data['articles'][5]['description']);
        } catch(error) {
            console.log("ERRORORERERR")
            setError(error.message);
        } finally {
            setIsLoading(false);
        }
    };  

    useEffect(() => {
        fetchData();
    }, []);
  
  return { data };
}

export default callNews

const styles = StyleSheet.create({})