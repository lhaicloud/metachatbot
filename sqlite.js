import sqlite3 from 'sqlite3';

// Open the SQLite database
const db = new sqlite3.Database('userSessions.sqlite', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to SQLite database.');
    }
});

// Create the table if it doesn't exist
db.run(`
    CREATE TABLE IF NOT EXISTS usersessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userid INTEGER NOT NULL UNIQUE,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        privacyPolicySeen BOOLEAN DEFAULT 0,
        privacyPolicyAgree BOOLEAN DEFAULT 0
    )
`, (err) => {
    if (err) {
        console.error('Error creating table:', err.message);
    }
});

// Create the table if it doesn't exist
db.run(`
    CREATE TABLE IF NOT EXISTS useraccounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userid INTEGER NOT NULL,
        cfcodeno TEXT NOT NULL UNIQUE,
        cfrotcode TEXT NOT NULL,
        cfacctno TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
`, (err) => {
    if (err) {
        console.error('Error creating table:', err.message);
    }
});

// Insert a user session
export function insertUserSession(userid) {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO usersessions (userid) VALUES (?)`,
            [userid],
            function (err) {
                if (err) {
                    console.error("Error inserting user:", err.message);
                    reject(err);
                } else {
                    resolve();
                }
            }
        );
    });
}

// Check if a user exists
export function getUserWithAccounts(userid) {
    return new Promise((resolve, reject) => {
        db.get(`SELECT * FROM usersessions WHERE userid = ?`, [userid], (err, row) => {
            if (err) {
                console.error('Error checking user:', err.message);
                reject(err);
            } else if (!row) {
                // If user doesn't exist, resolve with null
                resolve(null);
            }else {
                // Fetch user accounts associated with the user
                db.all(`SELECT * FROM useraccounts WHERE userid = ?`, [userid], (err, accountsRows) => {
                    if (err) {
                        console.error('Error fetching user accounts:', err.message);
                        reject(err);
                    } else {
                        // Combine user data with accounts data
                        const userWithAccounts = {
                            ...row, // User data
                            accounts: accountsRows // User's associated accounts
                        };
                        resolve(userWithAccounts);
                    }
                });
            }
        });
    });
}


// Fetch all user sessions
export function getAllSessions(callback) {
    db.all(`SELECT * FROM usersessions`, [], (err, rows) => {
        if (err) {
            console.error('Error fetching sessions:', err.message);
            callback([]);
        } else {
            callback(rows);
        }
    });
}

// Update `privacyPolicySeen`
export function markPrivacyPolicySeen(userid, privacyPolicySeen = 1) {
    db.run(
        `UPDATE usersessions SET privacyPolicySeen = ? WHERE userid = ?`,
        [privacyPolicySeen,userid],
        (err) => {
            if (err) {
                console.error('Error updating privacy policy:', err.message);
            } else {
                console.log(`User ${userid} marked as having seen the privacy policy.`);
            }
        }
    );
}


export function markPrivacyPolicyAgree(userid, privacyPolicyAgree = 1) {
    return new Promise((resolve,reject) => {
        db.run(
            `UPDATE usersessions SET privacyPolicyAgree = ? WHERE userid = ?`,
            [privacyPolicyAgree,userid],
            (err) => {
                if (err) {
                    console.error('Error updating privacy policy:', err.message);
                    reject(err);
                } else {
                    console.log(`User ${userid} marked as agreed the privacy policy.`);
                    resolve();
                }
            }
        );
    })
    
}

// Delete a user session
export function deleteUserSession(userid) {
    db.run(`DELETE FROM usersessions WHERE userid = ?`, [userid], (err) => {
        if (err) {
            console.error('Error deleting user session:', err.message);
        } else {
            console.log(`User ${userid} deleted.`);
        }
    });
}

// drop table
export function deleteTable(tableName) {
    db.run(`DROP TABLE IF EXISTS ${tableName}`, (err) => {
        if (err) {
            console.error(`Error deleting table ${tableName}:`, err.message);
        } else {
            console.log(`Table ${tableName} deleted successfully.`);
        }
    });
}

// Insert a user session
export function saveAccount(userid,account) {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO useraccounts (userid,cfcodeno,cfrotcode,cfacctno) VALUES (?,?,?,?)`,
            [userid,account.cfcodeno,account.cfrotcode,account.cfacctno],
            function (err) {
                if (err) {
                    console.error("Error inserting user:", err.message);
                    reject(err);
                } else {
                    resolve();
                }
            }
        );
    });
}