import { useState, useEffect } from 'react';
import axios from 'axios';
import 'react-xml-parser';

const hanjaRelated = ({ query }) => {
    // list of array [korean, definition, hanja]
    const [content, setContent] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);

    const url = `https://koreanhanja.app/`;

    const fetchData = async () => {
        try {
            let result = [];
            const response = await axios.put(`https://koreanhanja.app/${encodeURIComponent(query)}`);
            // Extract HTML content from the response
            const htmlContent = response.data;

            // Parse HTML content using DOMParser
            var ReactXmlParser = require('react-xml-parser');
            const htmlDocument = new ReactXmlParser().parseFromString(htmlContent);
            
            // Find all tables in the HTML document
            const rows = htmlDocument.getElementsByTagName('tr');

            rows.forEach(row => {
                const temp = [];
                // access the hanja
                const hanjaPart = row.getElementsByTagName('td')[0].getElementsByTagName('a')[0].value;
                // access the korean and definition
                const korDefPart = row.getElementsByTagName('td');
                korDefPart.forEach(cell => {
                    // Access the content of the cell
                    temp.push(cell.value.trim())
                });
                temp.push(hanjaPart)
                result.push(temp.slice(1))
            });
            
            setContent(result);
            console.log('hmmm', query, result);

        } catch(error) {
            console.error("Error fetching data:", error)
        }
    }

    useEffect(() => {
        fetchData();
    }, [query]);

    return content;
}

export default hanjaRelated