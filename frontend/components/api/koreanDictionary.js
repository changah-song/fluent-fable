// API documentation: https://krdict.korean.go.kr/openApi/openApiInfo
import { StyleSheet, Text, View } from 'react-native';
import { useState, useEffect } from 'react';
import axios from 'axios';
import 'react-xml-parser';
import {KOREAN_DICTIONARY_CLIENT_ID} from '@env'

const koreanDictionary = ( {query} ) => {
    const [dictionaryData, setDictionaryData] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);

    const client_id = KOREAN_DICTIONARY_CLIENT_ID;
    const api_url = `https://krdict.korean.go.kr/api/search`;

    //currenly only acccepts array of strings so it has to pass through the stemwordlist
    const fetchData = async () => {
        setIsLoading(true);
        try {
            const results = await Promise.all(
                query.map(async (q) => {
                    const options = {
                        method: 'GET',
                        url: api_url,
                        params: {
                            key: client_id,
                            q: q,
                            sort: 'popular',
                            translated: 'y',
                            trans_lang: '1',
                        }
                    };
                    const response = await axios.request(options);
                    if (!response.data) {
                        throw new Error("Empty response data");
                    }
                    var XMLParser = require('react-xml-parser');
                    var xml = new XMLParser().parseFromString(response.data);
                    
                    const items = xml.getElementsByTagName('item');
                    const extractedData = items.map(item => {
                        const word = item.getElementsByTagName('word')[0].value;
                        const origin = item.getElementsByTagName('origin')[0]?.value || 'N/A'; // Use 'N/A' if origin is not available
                        const transWord = item.getElementsByTagName('trans_word')[0]?.value.slice(0, -2) || 'N/A'; // Use 'N/A' if translation word is not available
                        
                        return { word, origin, transWord };
                    });

                    console.log("EXTRACT-=------!!", extractedData);
                    // maybe i can use the raw xml data to get both hanja and def...
                    // console.log('ORIGIN:', xml.getElementsByTagName('origin'));
                    // console.log('DEFF: ', xml.getElementsByTagName('trans_word'));
                    const translations = xml.getElementsByTagName('trans_word').slice(0, 3).map(dict => dict.value.slice(0, -2));
                    // console.log("result", translations)
                    return extractedData;
                })
            );
            setDictionaryData(results);
        } catch (error) {
            console.log('Error finding definitions:', error.message);
            setError(error.message);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [query]);
    
    console.log(dictionaryData)
    return { dictionaryData };
}

export default koreanDictionary

const styles = StyleSheet.create({})