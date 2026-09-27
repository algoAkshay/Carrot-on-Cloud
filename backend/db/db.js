import { randomUUID } from "node:crypto";

import pool from "./mysql.js";
import getDateForContest, { getContestDataWithMetadata } from "../cal.js";
import redis, { isRedisAvailable } from "./redis.js";

const RELEASE_LOCK_SCRIPT = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
    else
        return 0
    end
`;

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function pushContestData(contestId) {
    const { contestData, contest } =
        await getContestDataWithMetadata(contestId);

    const contestIsFinished =
        contest?.phase === "FINISHED";

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

    for (
        let i = 0;
        i < contestData.length;
        i += batchSize
    ) {
        batchNumber++;

        const batch = contestData
            .slice(
                i,
                Math.min(
                    contestData.length,
                    i + batchSize
                )
            )
            .map(user => [
                contestId,
                user.handle,
                user.performance,
                user.delta,
                user.rating,
                0
            ]);

        try {
            console.log(
                `Inserting batch ${batchNumber}...`
            );

            await pool.query(
                sql,
                [batch]
            );
        } catch (error) {
            console.log(error);

            console.log(
                `Error inserting batch ${batchNumber}`
            );

            throw error;
        }

        await sleep(sleepTime);
    }

    // Mark the contest final only after all batches were inserted successfully.
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
    const [rows] =
        await pool.execute(
            `
                SELECT
                    MAX(updated_at) AS last_update,
                    MIN(is_final) AS is_final
                FROM contest_results
                WHERE contest_id = ?
            `,
            [contestId]
        );

    const lastUpdate =
        rows[0].last_update;

    const isFinal =
        Boolean(
            rows[0].is_final
        );

    // No cached result exists yet.
    if (!lastUpdate) {
        return true;
    }

    // Once final data is stored, reuse it permanently.
    if (isFinal) {
        return false;
    }

    const diffMs =
        Date.now()
        - new Date(
            lastUpdate
        ).getTime();

    const fiveMinutes =
        5 * 60 * 1000;

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

function filterContestData(
    contestId,
    contestData,
    userList
) {
    const requestedUsers =
        new Set(userList);

    return contestData
        .filter(
            user =>
                requestedUsers.has(
                    user.handle
                )
        )
        .map(user => ({
            contest_id:
                contestId,

            handle:
                user.handle,

            performance:
                user.performance,

            delta:
                user.delta,

            rating:
                user.rating
        }));
}

async function queryContestResultsWithoutDb(
    contestID,
    userList
) {
    const contestData =
        await getDateForContest(
            contestID
        );

    return filterContestData(
        contestID,
        contestData,
        userList
    );
}

async function tryAcquireContestLock(lockKey) {
    if (!isRedisAvailable()) {
        return {
            status: "unavailable",
            owner: null
        };
    }

    const owner =
        randomUUID();

    try {
        const acquired =
            await redis.set(
                lockKey,
                owner,
                {
                    NX: true,
                    PX: 5 * 60 * 1000
                }
            );

        if (!acquired) {
            return {
                status: "busy",
                owner: null
            };
        }

        return {
            status: "acquired",
            owner
        };
    } catch (error) {
        console.error(
            "Redis lock acquisition failed:",
            error.message
        );

        return {
            status: "unavailable",
            owner: null
        };
    }
}

async function releaseContestLock(
    lockKey,
    owner
) {
    if (
        !owner
        || !isRedisAvailable()
    ) {
        return;
    }

    try {
        await redis.eval(
            RELEASE_LOCK_SCRIPT,
            {
                keys: [lockKey],
                arguments: [owner]
            }
        );
    } catch (error) {
        console.error(
            "Redis lock release failed:",
            error.message
        );
    }
}

async function waitForContestLock(
    lockKey
) {
    while (true) {
        // If Redis dies while we're waiting,
        // stop waiting and let the caller recover.
        if (!isRedisAvailable()) {
            return;
        }

        try {
            const exists =
                await redis.exists(
                    lockKey
                );

            if (!exists) {
                return;
            }
        } catch (error) {
            console.error(
                "Redis lock wait failed:",
                error.message
            );

            return;
        }

        await sleep(1000);
    }
}

async function refreshContestIfNeeded(
    contestID
) {
    if (
        !(await contestNeedsRefresh(
            contestID
        ))
    ) {
        return;
    }

    const lockKey =
        `lock:contest:${contestID}`;

    const firstAttempt =
        await tryAcquireContestLock(
            lockKey
        );

    /*
     * Redis unavailable:
     *
     * Continue without distributed locking.
     * Worst case: two requests compute the same contest.
     *
     * Better than making the whole endpoint unavailable.
     */
    if (
        firstAttempt.status
        === "unavailable"
    ) {
        console.log(
            `Redis unavailable; calculating contest ${contestID} without distributed lock`
        );

        await pushContestData(
            contestID
        );

        return;
    }

    /*
     * We acquired the lock.
     */
    if (
        firstAttempt.status
        === "acquired"
    ) {
        try {
            await pushContestData(
                contestID
            );
        } finally {
            await releaseContestLock(
                lockKey,
                firstAttempt.owner
            );
        }

        return;
    }

    /*
     * Another request owns the lock.
     */
    await waitForContestLock(
        lockKey
    );

    /*
     * IMPORTANT:
     *
     * A missing lock does not necessarily mean the
     * first worker successfully stored the result.
     *
     * It could have:
     * - crashed
     * - thrown an error
     * - lost Redis
     * - exceeded the TTL
     *
     * Therefore check MySQL again.
     */
    if (
        !(await contestNeedsRefresh(
            contestID
        ))
    ) {
        return;
    }

    /*
     * Still stale.
     * Try to become the next worker.
     */
    const retryAttempt =
        await tryAcquireContestLock(
            lockKey
        );

    if (
        retryAttempt.status
        === "unavailable"
    ) {
        console.log(
            `Redis unavailable after waiting; recalculating contest ${contestID} without distributed lock`
        );

        await pushContestData(
            contestID
        );

        return;
    }

    if (
        retryAttempt.status
        === "busy"
    ) {
        /*
         * Another worker acquired the lock between
         * our DB check and retry.
         *
         * Wait for it once more.
         */
        await waitForContestLock(
            lockKey
        );

        /*
         * Re-check one last time.
         *
         * If it is STILL stale after another worker
         * was given a chance, calculate directly.
         *
         * This avoids returning empty/stale data if
         * the second worker also fails.
         */
        if (
            await contestNeedsRefresh(
                contestID
            )
        ) {
            console.log(
                `Contest ${contestID} is still stale after waiting; recalculating`
            );

            await pushContestData(
                contestID
            );
        }

        return;
    }

    try {
        await pushContestData(
            contestID
        );
    } finally {
        await releaseContestLock(
            lockKey,
            retryAttempt.owner
        );
    }
}

export async function queryContestResults(
    contestID,
    userList
) {
    if (
        !userList
        || userList.length === 0
    ) {
        return [];
    }

    try {
        await refreshContestIfNeeded(
            contestID
        );

        const placeholders =
            userList
                .map(() => "?")
                .join(",");

        const sql = `
            SELECT *
            FROM contest_results
            WHERE contest_id = ?
              AND handle IN (${placeholders})
        `;

        const [rows] =
            await pool.execute(
                sql,
                [
                    contestID,
                    ...userList
                ]
            );

        return rows;
    } catch (error) {
        if (
            isDbConnectionError(
                error
            )
        ) {
            console.log(
                "MySQL unavailable, calculating contest data without DB cache:",
                error.code
            );

            return await queryContestResultsWithoutDb(
                contestID,
                userList
            );
        }

        console.log(
            "Query error:",
            error
        );

        throw error;
    }
}
