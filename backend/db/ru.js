import pool from "./mysql.js";
import axios from "axios";

const BATCH_SIZE = 5000;
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 2000; // ms

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchUserData(retries = RETRY_ATTEMPTS) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            console.log(`Fetching data from Codeforces API (attempt ${attempt}/${retries})...`);

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

            if (res.data.status !== "OK") {
                throw new Error(`API returned status: ${res.data.status}`);
            }

            console.log(`✓ Successfully fetched ${res.data.result.length} users`);
            return res.data.result;

        } catch (error) {
            console.error(`✗ Attempt ${attempt} failed:`, error.message);

            if (attempt === retries) {
                throw new Error(`Failed to fetch data after ${retries} attempts: ${error.message}`);
            }

            await sleep(RETRY_DELAY * attempt);
        }
    }
}

async function insertBatch(batch, batchNum, totalBatches) {
    try {
        const values = batch.map(u => [u.handle, u.rating]);

        await pool.query(
            `INSERT INTO ratingtable (handle, rating)
             VALUES ?
             ON DUPLICATE KEY UPDATE rating = VALUES(rating)`,
            [values]
        );

        return true;
    } catch (error) {
        console.error(`✗ Batch ${batchNum}/${totalBatches} failed:`, error.message);
        throw error;
    }
}

async function importData() {

    try {
        // Fetch data
        const userList = await fetchUserData();

        if (!userList || userList.length === 0) {
            console.log("No users to import");
            return;
        }

        // Process in batches
        const totalBatches = Math.ceil(userList.length / BATCH_SIZE);
        let processedCount = 0;

        console.log(`\nStarting import: ${userList.length} users in ${totalBatches} batches\n`);

        for (let i = 0; i < userList.length; i += BATCH_SIZE) {
            const batch = userList.slice(i, i + BATCH_SIZE);
            const batchNum = Math.floor(i / BATCH_SIZE) + 1;

            await insertBatch(batch, batchNum, totalBatches);

            processedCount += batch.length;
            const percentage = ((processedCount / userList.length) * 100).toFixed(1);
            console.log(`✓ Batch ${batchNum}/${totalBatches}: ${processedCount}/${userList.length} (${percentage}%)`);

            // Small delay between batches to avoid overwhelming the DB
            if (i + BATCH_SIZE < userList.length) {
                await sleep(100);
            }
        }

        console.log(`\n✓ Import completed successfully: ${processedCount} users processed`);

    } catch (error) {
        console.error("\n✗ Import failed:", error.message);
        process.exit(1);

    } finally {
        // Ensure pool closes
        try {
            await pool.end();
            console.log("Database connection closed");
        } catch (error) {
            console.error("Error closing database:", error.message);
        }
    }
}

// Run the import
await importData();
process.exit(0);