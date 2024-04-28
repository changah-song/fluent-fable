import React, { createContext, useContext, useState } from 'react';

// create new 'map'/context
const AppContext = createContext();

// creating copoies of 'map'/context
export const AppProvider = ({ children }) => {
    // initialize it to be dictionary status first
    const [transNotDict, setTransNotDict] = useState(true); // Default status is 'translator'
    
    // simply passing the status variable onto children tags
    return (
      <AppContext.Provider value={{ transNotDict, setTransNotDict }}>
        {children}
      </AppContext.Provider>
    );
  
};

// custom hook to access context
export const useAppContext = () => useContext(AppContext);