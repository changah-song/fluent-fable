import { StyleSheet, Text, View } from 'react-native';
import { useState, useEffect } from 'react';
import axios from 'axios';
import { CHATGPT_API_KEY } from '@env';


const callGPT = ( {query} ) => {
  const [data, setData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  
  const options = {
    method: 'POST',
    url: 'https://chatgpt-api8.p.rapidapi.com/',
    headers: {
      'content-type': 'application/json',
      'X-RapidAPI-Key': CHATGPT_API_KEY,
      'X-RapidAPI-Host': 'chatgpt-api8.p.rapidapi.com'
    },
    data: [
      {
        content: query,
        role: 'user'
      }
    ]
  };  

  const fetchData = async () => {    
    setIsLoading(true);
    try {
      const response = await axios.request(options)
      console.log(response.data["text"])
      setData(response.data["text"])
    } catch(error) {
      console.error(error)
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);
  
  return { data };
}

export default callGPT

const styles = StyleSheet.create({})