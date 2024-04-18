import * as SQLite from 'expo-sqlite';

const db = SQLite.openDatabase('a.db');

export const createTable = () => {
  return new Promise ((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        'CREATE TABLE IF NOT EXISTS vocab (id INTEGER PRIMARY KEY AUTOINCREMENT, kor_word TEXT, kor_hanja TEXT, kor_def TEXT, kor_level TEXT)',
        [],
        () => {
          console.log("Table created successfully!");
          resolve();
        },
        (_, error) => {
          console.log("Error creating table: ", error);
          reject(error);
        }
      );
    });
  });
};

export const insertData = (word, hanja, definition, level) => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        'INSERT INTO vocab (word, hanja, definition, kor_level) VALUES (?, ?, ?, ?)',
        [word, hanja, definition, level],
        () => {
            console.log('Data inserted successfully!');
            resolve();
        },
        (_, error) => {
            console.error('Error inserting data:', error);
            reject(error);
        }
      );
    });
  });
};


export const getTableSchema = () => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
          `PRAGMA table_info(vocab)`,
          [],
          (_, result) => {
              // Log the schema information to the console
              console.log(`Schema information for vocab table:`);
              console.log(result.rows._array);
              resolve(result.rows._array);
          },
          (_, error) => {
              console.error(`Error retrieving schema for vocab table:`, error);
              reject(error);
          }
      );
    });
  });
};

export const deleteAllDataFromTable = () => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
          `DELETE FROM vocab`,
          [],
          () => {
              console.log(`All data deleted from vocab table`);
              resolve();
          },
          (_, error) => {
              console.error(`Error deleting data from vocab table:`, error);
              reject(error);
          }
      );
    });
  });
};

export const viewData = () => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        'SELECT * FROM vocab',
        [],
        (_, result) => {
            const data = result.rows._array; // Extracting data from result
            console.log("Data fetched successfully.");
            console.log(data);
            resolve(data); // Calling the callback with the retrieved data
        },
        (_, error) => {
            console.error('Error fetching data:', error);
            reject(error);
        }
      );
    });
  });
};