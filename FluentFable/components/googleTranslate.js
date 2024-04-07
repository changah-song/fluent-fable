import { StyleSheet, Text, View } from 'react-native';
import { useState, useEffect } from 'react';
import axios from 'axios';

const googleTranslate = ( {query} ) => {
  const [data, setData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  
  const options = {
    method: 'POST',
    url: 'https://google-translator9.p.rapidapi.com/v2',
    headers: {
        'content-type': 'application/json',
        'X-RapidAPI-Key': 'c3bdcf3abdmsh01914843bcb0a61p12cd8djsnebf90ffde381',
        'X-RapidAPI-Host': 'google-translator9.p.rapidapi.com'
    },
    data: {
        q: query,
        source: 'ko',
        target: 'en-US',
        format: 'text'
    }
  };  

  const fetchData = async () => {    
    setIsLoading(true);
    try {
      const response = await axios.request(options);
      console.log(response.data.data.translations[0].translatedText);
      setData(response.data.data.translations[0].translatedText);
    } catch(error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [query]);
  
  return { data };
}

export default googleTranslate

const styles = StyleSheet.create({})