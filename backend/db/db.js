import pool from "./mysql.js";
import getDateForContest from "../cal.js";
import redis from "./redis.js";

async function sleep(ms){
    return new Promise(resolve => setTimeout(resolve,ms));
}

export async function pushContestData(contestId){

    const contestData = await getDateForContest(contestId);

    const sql = `
        INSERT INTO contest_results
            (contest_id, handle, performance, delta, rating)
        VALUES ?
        ON DUPLICATE KEY UPDATE performance = VALUES(performance),
                                delta       = VALUES(delta),
                                rating      = VALUES(rating)
    `;

    const batchSize = 1000;
    const sleepTime = 100;
    let batchNumber = 0;

    for (let i = 0; i < contestData.length; i += batchSize) {
        batchNumber++;
        let batch = []

        batch = contestData.slice(i,Math.min(contestData.length,i+batchSize)).map(user => [contestId,user.handle,user.performance,user.delta,user.rating])
        try {
            console.log(`${batchNumber} insert ho raha hai`);
            await pool.query(sql, [batch]);
        } catch (e) {
            console.log(e);
            console.log(`${batchNumber} dalte waqt error a gaya bhai`);
            break;
        }
        await sleep(sleepTime);
    }
}
// await pushContestData(2176);


async function contestNeedsRefresh(contestId) {

    const [rows] = await pool.execute(
        `
            SELECT MAX(updated_at) AS last_update
            FROM contest_results
            WHERE contest_id = ?
        `,
        [contestId]
    );


    const lastUpdate = rows[0].last_update;
    if (!lastUpdate) {
        return true; // no data → must fetch
    }

    const diffMs = Date.now() - new Date(lastUpdate).getTime();

    const fiveMinutes = 5 * 60 * 1000;
    const tenHours = 10 * 60 * 60 * 1000;

    return fiveMinutes<diffMs  && diffMs <= tenHours;
}


// Do the query
export async function queryContestResults(contestID, userList) {

    if (!userList || userList.length === 0) {
        return [];
    }



    if (await contestNeedsRefresh(contestID)){

        const lockKey = `lock:contest:${contestID}`;
        const sleep = ms => new Promise(r => setTimeout(r, ms));


        const acquired = await redis.set(lockKey, "1", {
            NX: true,
            PX: 2 * 60 * 1000,
        });

        if (acquired) {
            try {
                await pushContestData(contestID);
            } finally {
                await redis.del(lockKey);
            }
        }else {
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
}

