import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

// Create a MySQL pool (better for performance)
const pool = mysql.createPool({
  host: process.env.SERVER2_HOST,      // Change to your MySQL host
  user: process.env.SERVER2_USER,           // Your MySQL username
  password: process.env.SERVER2_PASSWORD, // Your MySQL password
  database: process.env.SERVER2_DATABASE_NAME, // Your database name
  waitForConnections: true,
  connectionLimit: 10,    // Max connections in pool
  queueLimit: 0
});

const server1 = mysql.createPool({
  host: process.env.SERVER1_HOST,      // Change to your MySQL host
  user: process.env.SERVER1_USER,           // Your MySQL username
  password: process.env.SERVER1_PASSWORD, // Your MySQL password
  database: process.env.SERVER1_DATABASE_NAME, // Your database name
  waitForConnections: true,
  connectionLimit: 10,    // Max connections in pool
  queueLimit: 0
});

// Test connection
(async () => {
    try {
      const server1_connection = await server1.getConnection();
      console.log('MySQL connection established successfully [server1]');
      server1_connection.release();
    } catch (error) {
      console.error('Failed to connect to MySQL [server1]:', error.message);
    }
})();
(async () => {
    try {
      const connection = await pool.getConnection();
      console.log('MySQL connection established successfully [server2]');
      connection.release();
    } catch (error) {
      console.error('Failed to connect to MySQL [server2]:', error.message);
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

// get balance

export async function getUnpaidBill(cfcodeno) {
  try {
    const now = new Date();
    const startYear = now.getFullYear() - 8;
    const startDate = `${startYear}-01-01`;
    const endDate = now.toISOString().slice(0, 10); // YYYY-MM-DD

    const [rows] = await server1.query(`
      SELECT 
        billing1.cfbillmo,
        billing1.nfeuse,
        billing1.nfbillamt,
        billing1.dfread,
        billing1.cfcodeno,
        billing1.idbilling1,
        billing1.dfdue,
        billing1.cfinvrem
      FROM billing1
      LEFT JOIN payment1
        ON payment1.dfread = billing1.dfread
        AND payment1.cfcodeno = billing1.cfcodeno
      WHERE billing1.cfcodeno = ?
        AND billing1.dfread BETWEEN ? AND ?
        AND billing1.cfinvrem != '8'
        AND (
          payment1.nfamtpaid IS NULL
          OR (
            COALESCE(payment1.nfamtpaid, 0) +
            COALESCE(payment1.nftax1, 0) +
            COALESCE(payment1.nftax2, 0) +
            COALESCE(payment1.nftax3, 0) +
            COALESCE(payment1.nftax4, 0) +
            COALESCE(payment1.nftax5, 0) +
            COALESCE(payment1.nftax6, 0)
          ) = 0
        )
      ORDER BY billing1.dfread DESC
    `, [cfcodeno, startDate, endDate]);

    return rows;
  } catch (err) {
    console.error('Fetch Error:', err);
    return null;
  }
}

export async function getPayments(cfcodeno){
     try {
      const [rows] = await server1.query(`
        SELECT cfcodeno,dfread,dfpaid,cfreferenc,COALESCE(nfamtpaid, 0) + COALESCE(nftax1, 0) + COALESCE(nftax2, 0) +
COALESCE(nftax3, 0) + COALESCE(nftax4, 0) + COALESCE(nftax5, 0) + COALESCE(nftax6, 0) AS total_paid 
FROM payment1 where cfcodeno = ? order by idpayment1 desc limit 3`,[cfcodeno]);
      return rows;
    } catch (err) {
      console.error('Fetch Error:', err);
      return null;
    }
}

export async function validateAccountNumber(accountNumber){
    try {
        const [row] = await server1.query(`SELECT * FROM master WHERE CONCAT(cfrotcode,cfacctno) = ? limit 1`,[accountNumber]);
        return row;
    } catch (error) {
        console.error('Fetch Error:', err);
        return false;
    }
}