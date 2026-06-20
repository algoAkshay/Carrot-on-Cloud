import pool from "./mysql.js";
import axios from "axios";

async function getData() {

    const res = await axios.get(
        "https://codeforces.com/api/user.ratedList",
        {
            params: {
                activeOnly: false,
                includeRetired: true
            },
            timeout: 30000,
            headers: {
                "User-Agent": "carrot-on-cloud"
            }
        }
    );
    console.log("Rating data fetched successfully");

    const userList = res.data.result;

    const values = userList.map(user => [user.handle, user.rating]);
    await pool.query(
        `INSERT INTO ratingtable (handle, rating)
         VALUES ?
         ON DUPLICATE KEY UPDATE rating = VALUES(rating)`,
        [values]
    );
    console.log(`${values.length} rows updated`);
}

await getData();
await pool.end();


