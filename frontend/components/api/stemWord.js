import { StyleSheet } from 'react-native';
import { useState, useEffect } from 'react';
import axios from 'axios';

const stemWord = ( {query} ) => {
    const [stemWord, setStemWord] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
  
    const api_url = `http://127.0.0.1:8000/okt_morphs`;

    const options = {
        method: 'GET',
        url: api_url,
        params: {
            text: query
        }  
    };

    const fetchMorphs = async () => {
      setIsLoading(true);
      try {
        const response = await axios.request(options);

        if (!response.data) {
            throw new Error("Empty response data");
        }

        console.log(response.data)

        setStemWord(response.data.result);
        setIsLoading(false);
      } catch (error) {
        console.error('Error fetching morphs:', error);
        setError(error.message);
        setIsLoading(false);
      }
    }

    useEffect(() => {
        fetchMorphs();
    }, [query]);

    return { stemWord };
}

export default stemWord

const styles = StyleSheet.create({})