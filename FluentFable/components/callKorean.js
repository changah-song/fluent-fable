// can only be added once a package name has been created...
// using temporary package name for now

import { StyleSheet, Text, View } from 'react-native';
import { useState, useEffect } from 'react';
import axios from 'axios';

const callKorean = () => {
    const [data, setData] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);

    const client_id = 'BvsrSmyS8eyHgdT1_1NB';
    const client_secret = 'IJoqQ1Sf0A';
    const api_url = `https://openapi.naver.com/v1/search/news?query=%EC%A3%BC%EC%8B%9D&display=10&start=1&sort=sim`;

    const options = {
        url: api_url,
        headers: {'X-Naver-Client-Id': client_id, 'X-Naver-Client-Secret': client_secret}
    }

    const fetchData = async () => {    
        setIsLoading(true);
        try {
            const response = await axios.request(options)
            console.log(response.data.items[1].originallink)
            setData(response.data);
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

export default callKorean

const styles = StyleSheet.create({})