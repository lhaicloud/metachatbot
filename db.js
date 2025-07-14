import mysql from 'mysql2/promise';

// Create a MySQL pool (better for performance)
const pool = mysql.createPool({
  host: '10.2.2.1',      // Change to your MySQL host
  user: 'root',           // Your MySQL username
  password: 'casurecoapp8080', // Your MySQL password
  database: 'e_services', // Your database name
  waitForConnections: true,
  connectionLimit: 10,    // Max connections in pool
  queueLimit: 0
});

// Test connection
(async () => {
    try {
      const connection = await pool.getConnection();
      console.log('MySQL connection established successfully.');
      connection.release();
    } catch (error) {
      console.error('Failed to connect to MySQL:', error.message);
    }
})();

// READ (Fetch all users)
export async function getUsers() {
    try {
      const [rows] = await pool.query('SELECT * FROM usersessions');
      return rows;
    } catch (err) {
      console.error('Fetch Error:', err);
    }
}


export async function insertUserSession(userid) {
    try {
        const [result] = await pool.execute(
            `INSERT INTO usersessions (userid) VALUES (?)`,
            [userid]
        );
        console.log('User session inserted with ID:', result.insertId);
        return result.insertId;
    } catch (err) {
        console.error('Error inserting user session:', err.message);
        throw err;
    }
}

export async function getUserWithAccounts(userid) {
    try {
        // Check if user exists
        const [userRows] = await pool.execute(
            `SELECT * FROM usersessions WHERE userid = ?`,
            [userid]
        );

        if (userRows.length === 0) {
            console.log('No user found with the given ID.');
            return null; // User does not exist
        }

        const user = userRows[0];

        // Fetch user accounts
        const [accountsRows] = await pool.execute(
            `SELECT * FROM useraccounts WHERE userid = ?`,
            [userid]
        );

        // Combine user data with accounts
        const userWithAccounts = {
            ...user,
            accounts: accountsRows
        };

        return userWithAccounts;
    } catch (err) {
        console.error('Error fetching user with accounts:', err.message);
        throw err;
    }
}

export async function markPrivacyPolicySeen(userid, privacyPolicySeen = 1) {
    try {
        const [result] = await pool.execute(
            `UPDATE usersessions SET privacyPolicySeen = ? WHERE userid = ?`,
            [privacyPolicySeen, userid]
        );

        if (result.affectedRows > 0) {
            console.log(`User ${userid} marked as having seen the privacy policy.`);
        } else {
            console.log(`No user found with ID ${userid}.`);
        }
    } catch (err) {
        console.error('Error updating privacy policy:', err.message);
        throw err;
    }
}

export async function markPrivacyPolicyAgree(userid, privacyPolicyAgree = 1) {
    try {
        const [result] = await pool.execute(
            `UPDATE usersessions SET privacyPolicyAgree = ? WHERE userid = ?`,
            [privacyPolicyAgree, userid]
        );

        if (result.affectedRows > 0) {
            console.log(`User ${userid} marked as agreed to the privacy policy.`);
            return true;
        } else {
            console.log(`No user found with ID ${userid}.`);
            return false;
        }
    } catch (err) {
        console.error('Error updating privacy policy agreement:', err.message);
        throw err;
    }
}

export async function saveAccount(userid, account) {
    try {
        const [result] = await pool.execute(
            `INSERT INTO useraccounts (userid, cfcodeno, cfrotcode, cfacctno) VALUES (?, ?, ?, ?)`,
            [userid, account.cfcodeno, account.cfrotcode, account.cfacctno]
        );

        if (result.affectedRows > 0) {
            console.log(`Account saved successfully for user ID ${userid}.`);
            return true;
        } else {
            console.log(`Failed to save account for user ID ${userid}.`);
            return false;
        }
    } catch (err) {
        console.error('Error inserting account:', err.message);
        throw err;
    }
}
export async function removeAccount(userid, account) {
    try {
        const [result] = await pool.execute(
            `DELETE FROM useraccounts WHERE userid = ? AND cfcodeno = ?`,
            [userid, account.cfcodeno]
        );

        if (result.affectedRows > 0) {
            console.log(`Account removed successfully for user ID ${userid}.`);
            return true;
        } else {
            console.log(`No matching account found to remove for user ID ${userid}.`);
            return false;
        }
    } catch (err) {
        console.error('Error deleting account:', err.message);
        throw err;
    }
}