import { StyleSheet, Text, View } from 'react-native'
import { useState, useEffect } from 'react'
import axios from 'axios'


const callGPT = ( {query} ) => {
  const [data, setData] = useState([]);
  
  const options = {
    method: 'POST',
    url: 'https://chatgpt-api8.p.rapidapi.com/',
    headers: {
      'content-type': 'application/json',
      'X-RapidAPI-Key': 'c3bdcf3abdmsh01914843bcb0a61p12cd8djsnebf90ffde381',
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
    try {
      const response = await axios.request(options)
      console.log(response.data["text"])
      setData(response.data["text"])
    } catch(error) {
      console.error(error)
    }
  };

  useEffect(() => {
    fetchData();
  }, []);
  
  return { data };
}

export default callGPT

const styles = StyleSheet.create({})