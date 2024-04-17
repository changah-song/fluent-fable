import * as SQLite from 'expo-sqlite';
import React, { useEffect } from 'react';

// const db = SQLite.openDatabase('vocab.db');

class DatabaseHelper {
  // Function to create tables
    static createTable() {
        db.transaction(tx => {
            tx.executeSql(
                'CREATE TABLE IF NOT EXISTS vocab (id INTEGER PRIMARY KEY AUTOINCREMENT, word TEXT, hanja TEXT, definition TEXT, level ENUM(\'easy\', \'medium\', \'hard\', \'unorganized\'))'
            );
        });
    }

    // Function to insert data
    static insertData(word, hanja=null, definition, level) {
        db.transaction(tx => {
            tx.executeSql('INSERT INTO vocab (word, hanja, definition, level) VALUES (?, ?, ?, ?)'
            , [word, hanja, definition, level]);
        });
    }

    // Function to fetch all data
    static getAllData(callback) {
            db.transaction(tx => {
                tx.executeSql('SELECT * FROM vocab', [], (_, { rows }) => {
                    callback(rows._array);
                });
            });
    }
  
  // Add other operations as per your requirements
}

export default DatabaseHelper;
