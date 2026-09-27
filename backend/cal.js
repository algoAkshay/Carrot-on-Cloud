import FFTConv from './conv.js';
import binarySearch from './binsearch.js';
import pool from './db/mysql.js';

/**
 * Rating calculation code adapted from TLE at
 * https://github.com/cheran-senthil/TLE/blob/master/tle/util/ranklist/rating_calculator.py
 * originally developed by algmyr (https://github.com/algmyr) based on code by Mike Mirzayanov at
 * https://codeforces.com/contest/1/submission/13861109.
 *
 * The algorithm uses convolution via FFT for fast calculation.
 *
 * Calculation of performance, which is the rating at which delta is zero, written with the help
 * of ffao (https://codeforces.com/profile/ffao).
 */

const PRINT_PERFORMANCE = false;
const DEFAULT_RATING = 1400;
let codeforcesRatingsPromise = null;

export class Contestant {
    constructor(handle, points, penalty, rating) {
        this.handle = handle;
        this.points = points;
        this.penalty = penalty;
        this.rating = rating;
        this.effectiveRating = rating == null ? DEFAULT_RATING : rating;

        this.rank = null;
        this.delta = null;
        this.performance = null;
    }
}

export class PredictResult {
    constructor(handle, rating, delta, performance) {
        this.handle = handle;
        this.rating = rating;
        this.delta = delta;
        this.performance = performance;
    }

    get effectiveRating() {
        return this.rating == null ? DEFAULT_RATING : this.rating;
    }
}

export const MAX_RATING_LIMIT = 6000;
export const MIN_RATING_LIMIT = -500;
const RATING_RANGE_LEN = MAX_RATING_LIMIT - MIN_RATING_LIMIT;
const ELO_OFFSET = RATING_RANGE_LEN;
const RATING_OFFSET = -MIN_RATING_LIMIT;

// The probability of contestant with rating x winning versus contestant with rating y
// is given by ELO_WIN_PROB[y - x + ELO_OFFSET].
const ELO_WIN_PROB = new Array(2 * RATING_RANGE_LEN + 1);

for (let i = -RATING_RANGE_LEN; i <= RATING_RANGE_LEN; i++) {
    ELO_WIN_PROB[i + ELO_OFFSET] = 1 / (1 + Math.pow(10, i / 400));
}

const fftConv = new FFTConv(
    ELO_WIN_PROB.length + RATING_RANGE_LEN - 1
);

export class RatingCalculator {
    constructor(contestants) {
        this.contestants = contestants;
        this.seed = null;
        this.adjustment = null;
    }

    calculateDeltas(calcPerfs = false) {
        const startTime = performance.now();

        this.calcSeed();
        this.reassignRanks();
        this.calcDeltas();
        this.adjustDeltas();

        if (calcPerfs) {
            this.calcPerfs();
        }

        const endTime = performance.now();

        if (PRINT_PERFORMANCE) {
            console.info(
                `Deltas calculated in ${endTime - startTime}ms.`
            );
        }
    }

    calcSeed() {
        const counts = new Array(RATING_RANGE_LEN).fill(0);

        for (const c of this.contestants) {
            counts[c.effectiveRating + RATING_OFFSET] += 1;
        }

        // Expected rank for a contestant x is 1 + sum of ELO win probabilities
        // of every other contestant versus x.
        //
        // seed[r] is the expected rank of a contestant with rating r, who did
        // not participate in the contest, if he had participated.
        this.seed = fftConv.convolve(
            ELO_WIN_PROB,
            counts
        );

        for (let i = 0; i < this.seed.length; i++) {
            this.seed[i] += 1;
        }
    }

    getSeed(r, exclude) {
        // Expected rank assuming a contestant's rating were r,
        // excluding the contestant's original rating contribution.
        return (
            this.seed[r + ELO_OFFSET + RATING_OFFSET]
            - ELO_WIN_PROB[r - exclude + ELO_OFFSET]
        );
    }

    reassignRanks() {
        this.contestants.sort(
            (a, b) =>
                a.points !== b.points
                    ? b.points - a.points
                    : a.penalty - b.penalty
        );

        let lastPoints;
        let lastPenalty;
        let rank;

        for (let i = this.contestants.length - 1; i >= 0; i--) {
            const c = this.contestants[i];

            if (
                c.points !== lastPoints
                || c.penalty !== lastPenalty
            ) {
                lastPoints = c.points;
                lastPenalty = c.penalty;
                rank = i + 1;
            }

            c.rank = rank;
        }
    }

    calcDelta(contestant, assumedRating) {
        const c = contestant;

        const seed = this.getSeed(
            assumedRating,
            c.effectiveRating
        );

        const midRank = Math.sqrt(c.rank * seed);

        const needRating = this.rankToRating(
            midRank,
            c.effectiveRating
        );

        return Math.trunc(
            (needRating - assumedRating) / 2
        );
    }

    calcDeltas() {
        for (const c of this.contestants) {
            c.delta = this.calcDelta(
                c,
                c.effectiveRating
            );
        }
    }

    rankToRating(rank, selfRating) {
        return binarySearch(
            2,
            MAX_RATING_LIMIT,
            rating =>
                this.getSeed(
                    rating,
                    selfRating
                ) < rank
        ) - 1;
    }

    adjustDeltas() {
        this.contestants.sort(
            (a, b) =>
                b.effectiveRating - a.effectiveRating
        );

        const n = this.contestants.length;

        {
            const deltaSum =
                this.contestants.reduce(
                    (a, b) => a + b.delta,
                    0
                );

            const inc =
                Math.trunc(-deltaSum / n) - 1;

            this.adjustment = inc;

            for (const c of this.contestants) {
                c.delta += inc;
            }
        }

        {
            const zeroSumCount =
                Math.min(
                    4 * Math.round(Math.sqrt(n)),
                    n
                );

            const deltaSum =
                this.contestants
                    .slice(0, zeroSumCount)
                    .reduce(
                        (a, b) => a + b.delta,
                        0
                    );

            const inc =
                Math.min(
                    Math.max(
                        Math.trunc(
                            -deltaSum / zeroSumCount
                        ),
                        -10
                    ),
                    0
                );

            this.adjustment += inc;

            for (const c of this.contestants) {
                c.delta += inc;
            }
        }
    }

    calcPerfs() {
        // Approximate performance rating where delta becomes zero.
        for (const c of this.contestants) {
            c.performance = binarySearch(
                MIN_RATING_LIMIT,
                MAX_RATING_LIMIT,
                assumedRating =>
                    this.calcDelta(
                        c,
                        assumedRating
                    ) + this.adjustment <= 0
            );
        }
    }
}

function predict(
    contestants,
    calcPerfs = false
) {
    if (contestants.length === 0) {
        return [];
    }

    new RatingCalculator(
        contestants
    ).calculateDeltas(calcPerfs);

    return contestants.map(
        c =>
            new PredictResult(
                c.handle,
                c.rating,
                c.delta,
                c.performance
            )
    );
}

async function loadRatings(contestants) {
    if (contestants.length === 0) {
        return;
    }

    let ratings;

    try {
        const handles =
            contestants.map(
                user => user.handle
            );

        const placeholders =
            handles
                .map(() => "?")
                .join(",");

        const [rows] =
            await pool.execute(
                `SELECT handle, rating
                 FROM ratingtable
                 WHERE handle IN (${placeholders})`,
                handles
            );

        ratings = new Map(
            rows.map(
                row => [
                    row.handle,
                    row.rating
                ]
            )
        );
    } catch (error) {
        console.log(
            "Could not load ratings from MySQL, falling back to Codeforces ratedList:",
            error.code ?? error.message
        );

        ratings =
            await loadCodeforcesRatings();
    }

    for (const user of contestants) {
        const rating =
            ratings.get(user.handle);

        user.rating =
            rating == null
                ? DEFAULT_RATING
                : rating;

        user.effectiveRating =
            user.rating;
    }
}

/**
 * For finished rated contests, Codeforces exposes the exact users who
 * received rating changes along with their rating before the contest.
 *
 * This solves two problems:
 * 1. We don't accidentally use post-contest/current ratings.
 * 2. We only include users who were actually part of the rated update.
 */
async function loadContestRatingChanges(contestId) {
    try {
        const res = await fetch(
            `https://codeforces.com/api/contest.ratingChanges?contestId=${contestId}`,
            {
                headers: {
                    "User-Agent": "carrot-on-cloud"
                }
            }
        );

        const data = await res.json();

        if (data.status !== "OK") {
            return null;
        }

        return new Map(
            data.result.map(
                change => [
                    change.handle,
                    change.oldRating
                ]
            )
        );
    } catch (error) {
        console.log(
            `Rating changes unavailable for contest ${contestId}:`,
            error.message
        );

        return null;
    }
}

async function loadCodeforcesRatings() {
    codeforcesRatingsPromise ??=
        fetch(
            "https://codeforces.com/api/user.ratedList?activeOnly=false&includeRetired=true",
            {
                headers: {
                    "User-Agent": "carrot-on-cloud"
                }
            }
        ).then(async res => {
            const data = await res.json();

            if (data.status !== "OK") {
                throw new Error(
                    `Codeforces API returned status ${data.status}: ${data.comment ?? "unknown error"}`
                );
            }

            return new Map(
                data.result.map(
                    user => [
                        user.handle,
                        user.rating
                    ]
                )
            );
        });

    return codeforcesRatingsPromise;
}

async function getUser(
    contestID,
    contestants
) {
    const standings =
        await fetch(
            `https://codeforces.com/api/contest.standings?contestId=${contestID}`
        );

    const data =
        await standings.json();

    if (data.status !== "OK") {
        throw new Error(
            `Codeforces API returned status ${data.status}: ${data.comment ?? "unknown error"}`
        );
    }

    const result = data.result;
    const rows = result.rows;

    /**
     * If the contest is finished, try to use Codeforces' authoritative
     * rating-change list.
     *
     * That list contains only users who actually received rating changes
     * and gives us their exact pre-contest rating.
     */
    const historicalRatings =
        result.contest.phase === "FINISHED"
            ? await loadContestRatingChanges(
                contestID
            )
            : null;

    if (
        historicalRatings
        && historicalRatings.size > 0
    ) {
        for (const user of rows) {
            const handle =
                user.party.members[0]?.handle;

            if (
                !handle
                || !historicalRatings.has(handle)
            ) {
                continue;
            }

            contestants.push(
                new Contestant(
                    handle,
                    user.points,
                    user.penalty,
                    historicalRatings.get(
                        handle
                    )
                )
            );
        }
    } else {
        /**
         * During an ongoing contest, ratingChanges is not available yet.
         *
         * Only include normal contestants here. This excludes practice,
         * virtual and out-of-competition submissions.
         */
        for (const user of rows) {
            if (
                user.party.participantType
                !== "CONTESTANT"
            ) {
                continue;
            }

            const handle =
                user.party.members[0]?.handle;

            if (!handle) {
                continue;
            }

            contestants.push(
                new Contestant(
                    handle,
                    user.points,
                    user.penalty
                )
            );
        }

        await loadRatings(contestants);
    }

    return result.contest;
}

// Main function to use when the caller also needs the Codeforces contest phase.
export async function getContestDataWithMetadata(
    contestId
) {
    const contestants = [];

    const contest =
        await getUser(
            contestId,
            contestants
        );

    return {
        contestData:
            predict(
                contestants,
                true
            ),
        contest
    };
}

export default async function getDataForContest(
    contestId
) {
    const { contestData } =
        await getContestDataWithMetadata(
            contestId
        );

    return contestData;
}

// getDataForContest(2191);
