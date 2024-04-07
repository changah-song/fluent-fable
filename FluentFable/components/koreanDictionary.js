// API documentation: https://krdict.korean.go.kr/openApi/openApiInfo

import { StyleSheet, Text, View } from 'react-native';
import { useState, useEffect } from 'react';
import axios from 'axios';
import 'react-xml-parser';

const koreanDictionary = ( {query} ) => {
    const [data, setData] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);

    const client_id = '7E27A81804E9FC81111869F31589A71C';
    const api_url = `https://krdict.korean.go.kr/api/search`;

    const options = {
        method: 'GET',
        url: api_url,
        params: {
            key: client_id,
            q: query,
            sort: 'popular',
            translated: 'y',
            trans_lang: '1',
        }
    };

    const fetchData = async () => {    
        setIsLoading(true);
        try {
            const response = await axios.request(options)

            if (!response.data) {
                throw new Error("Empty response data");
            }

            var XMLParser = require('react-xml-parser');
            var xml = new XMLParser().parseFromString(response.data);
            const translations = xml.getElementsByTagName('trans_word').slice(0,3).map(dict => dict.value.slice(0,-2));
            console.log(translations)

            setData(translations);
        } catch(error) {
            console.log("ERRORORERERR")
            setError(error.message);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [query]);
  
  return { data };
}

export default koreanDictionary

const styles = StyleSheet.create({})