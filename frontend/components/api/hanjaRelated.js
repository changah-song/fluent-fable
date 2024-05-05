import { useState, useEffect } from 'react';
import axios from 'axios';

const hanjaRelated = ( {hanja} ) => {
    const [content, setContent] = useState("");
    const url = `https://koreanhanja.app/`;

    const options = {
        method: 'get',
        url: url,
        params: {
            text: query
        }
    };

    const fetchData = async () => {
        try {
            const response = await axios.request(options);
            if (!response.data) {
                throw new Error("Empty response data");
            }
            console.log(response);
            setContent(response);
        } catch(error) {
            console.error("Error fetching hanja data:", error)
        }
    }

    useEffect(() => {
        fetchData();
    }, [hanja]);

    return content;
}

export default hanjaRelated