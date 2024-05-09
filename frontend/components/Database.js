import * as SQLite from 'expo-sqlite';

// need to change so that i don't have to change db everytime i change table layout...
const db = SQLite.openDatabase('temp.db');

export const createTable = () => {
  return new Promise ((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `CREATE TABLE 
          IF NOT EXISTS vocab (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            word TEXT, 
            hanja TEXT, 
            def TEXT, 
            level TEXT)`,
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
        'INSERT INTO vocab (word, hanja, def, level) VALUES (?, ?, ?, ?)',
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

export const updateLevel = (word, hanja, definition, newLevel) => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        'UPDATE vocab SET level = ? WHERE word = ? AND hanja = ? AND def = ?',
        [newLevel, word, hanja, definition],
        () => {
          console.log('Level updated successfully!');
          resolve();
        },
        (_, error) => {
          console.log('Error updating level:', error);
          reject(error);
        }
      )
    })
  })
}

export const removeData = (word, hanja, definition) => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        'DELETE FROM vocab WHERE word = ? AND hanja = ? AND def = ?',
        [word, hanja, definition],
        (_, result) => {
          console.log(`'${word}' with hanja '${hanja}' and definition '${definition}' removed successfully.`);
          resolve(result);
        },
        (_, error) => {
          console.error(`Error removing word '${word}' with hanja '${hanja}' and definition '${definition}':`, error);
          reject(error);
        }
      );
    });
  });
};

export const wordExists = (word) => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        'SELECT COUNT(*) AS count FROM vocab WHERE word = ?',
        [word],
        (_, result) => {
          const {count} = result.rows.item(0); // Extract count from result
          resolve(count > 0); // Resolve true if count > 0, false otherwise
        },
        (_, error) => {
          console.error('Error checking if word exists:', error);
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