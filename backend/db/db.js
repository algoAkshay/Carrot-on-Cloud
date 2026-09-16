import pool from "./mysql.js";
import getDateForContest, { getContestDataWithMetadata } from "../cal.js";
import redis from "./redis.js";

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function pushContestData(contestId) {
    const { contestData, contest } = await getContestDataWithMetadata(contestId);
    const contestIsFinished = contest?.phase === "FINISHED";

    const sql = `
        INSERT INTO contest_results
            (contest_id, handle, performance, delta, rating, is_final)
        VALUES ?
        ON DUPLICATE KEY UPDATE
            performance = VALUES(performance),
            delta       = VALUES(delta),
            rating      = VALUES(rating),
            is_final    = 0
    `;

    const batchSize = 1000;
    const sleepTime = 100;
    let batchNumber = 0;

    for (let i = 0; i < contestData.length; i += batchSize) {
        batchNumber++;

        const batch = contestData
            .slice(i, Math.min(contestData.length, i + batchSize))
            .map(user => [
                contestId,
                user.handle,
                user.performance,
                user.delta,
                user.rating,
                0
            ]);

        try {
            console.log(`Inserting batch ${batchNumber}...`);
            await pool.query(sql, [batch]);
        } catch (e) {
            console.log(e);
            console.log(`Error inserting batch ${batchNumber}`);
            throw e;
        }

        await sleep(sleepTime);
    }

    // Mark the contest as final only after every batch was inserted successfully.
    if (contestIsFinished) {
        await pool.execute(
            `
                UPDATE contest_results
                SET is_final = 1
                WHERE contest_id = ?
            `,
            [contestId]
        );
    }
}

async function contestNeedsRefresh(contestId) {
    const [rows] = await pool.execute(
        `
            SELECT
                MAX(updated_at) AS last_update,
                MIN(is_final) AS is_final
            FROM contest_results
            WHERE contest_id = ?
        `,
        [contestId]
    );

    const lastUpdate = rows[0].last_update;
    const isFinal = Boolean(rows[0].is_final);

    // No cached result exists yet.
    if (!lastUpdate) {
        return true;
    }

    // Once a final snapshot has been stored, reuse it permanently.
    if (isFinal) {
        return false;
    }

    // While the contest is ongoing / not finalized,
    // refresh cached results every 5 minutes.
    const diffMs = Date.now() - new Date(lastUpdate).getTime();
    const fiveMinutes = 5 * 60 * 1000;

    return diffMs > fiveMinutes;
}

function isDbConnectionError(error) {
    return [
        "ECONNREFUSED",
        "ETIMEDOUT",
        "ENOTFOUND",
        "EHOSTUNREACH"
    ].includes(error?.code);
}

function filterContestData(contestId, contestData, userList) {
    const requestedUsers = new Set(userList);

    return contestData
        .filter(user => requestedUsers.has(user.handle))
        .map(user => ({
            contest_id: contestId,
            handle: user.handle,
            performance: user.performance,
            delta: user.delta,
            rating: user.rating
        }));
}

async function queryContestResultsWithoutDb(contestID, userList) {
    const contestData = await getDateForContest(contestID);
    return filterContestData(contestID, contestData, userList);
}

export async function queryContestResults(contestID, userList) {
    if (!userList || userList.length === 0) {
        return [];
    }

    try {
        if (await contestNeedsRefresh(contestID)) {
            const lockKey = `lock:contest:${contestID}`;

            const acquired = await redis.set(lockKey, "1", {
                NX: true,
                PX: 2 * 60 * 1000,
            });

            if (acquired) {
                try {
                    await pushContestData(contestID);
                } catch (error) {
                    console.log("Error pushing contest data:", error);
                    throw error;
                } finally {
                    await redis.del(lockKey);
                }
            } else {
                while ((await redis.get(lockKey)) === "1") {
                    await sleep(1000);
                }
            }
        }

        const placeholders = userList.map(() => "?").join(",");

        const sql = `
            SELECT *
            FROM contest_results
            WHERE contest_id = ?
              AND handle IN (${placeholders})
        `;

        const [rows] = await pool.execute(sql, [
            contestID,
            ...userList
        ]);

        return rows;
    } catch (error) {
        if (isDbConnectionError(error)) {
            console.log(
                "MySQL unavailable, calculating contest data without DB cache:",
                error.code
            );

            return await queryContestResultsWithoutDb(
                contestID,
                userList
            );
        }

        console.log("Query error:", error);
        throw error;
    }
}
