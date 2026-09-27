# 🥕 Carrot on Cloud

**Carrot on Cloud** is a server-side Codeforces rating prediction system that moves contest-data processing and rating calculation away from individual browsers and into a shared backend service.

A Chrome extension integrates directly with Codeforces standings pages and displays predicted **rating changes** and **performance ratings**, while the backend handles contest data retrieval, computation, caching, persistence, and concurrency control.

---

## 🚀 Why Carrot on Cloud?

Traditional client-side rating predictors require every browser to independently:

- fetch contest standings,
- obtain participant ratings,
- run the complete rating calculation,
- and repeat the same work whenever the page is refreshed.

Carrot on Cloud uses a centralized architecture instead.

```text
Codeforces Standings Page
          │
          ▼
   Chrome Extension
          │
          ▼
     Express API
          │
          ▼
   Cached result available?
      │            │
     Yes           No
      │            │
      │       Redis lock
      │            │
      │      Codeforces API
      │            │
      │     Rating calculation
      │            │
      │       MySQL storage
      │            │
      └────────────┘
            │
            ▼
   Performance + Delta
```

Once a contest snapshot has been calculated, subsequent users can reuse the stored result instead of repeating the complete computation.

---

## ✨ Key Features

### Server-Side Rating Prediction

Contest standings are processed on the backend instead of inside every user's browser.

The backend calculates:

- predicted rating delta,
- performance rating,
- participant rank,
- and contest-level rating adjustments.

The calculation engine uses an FFT-based implementation adapted from existing Codeforces rating-prediction work.

---

### Chrome Extension Integration

The Manifest V3 Chrome extension integrates directly with Codeforces contest standings.

It:

- detects the current contest,
- extracts handles visible on the standings page,
- requests calculated results from the backend,
- adds **Performance** and **Delta** columns,
- and applies Codeforces-style rating colors.

This keeps the frontend lightweight while leaving data processing to the backend.

---

## 🧠 Rating Calculation

The rating-calculation implementation is adapted from the algorithm used by **TLE** and related Codeforces rating-prediction implementations.

The system estimates the expected rank of participants using Elo-style win probabilities.

For two competitors with ratings `x` and `y`, the expected win probability is derived from:

```text
P(x beats y) = 1 / (1 + 10^((y - x) / 400))
```

Calculating this independently for every pair of participants would be expensive for large contests.

The implementation instead models the rating distribution as a discrete signal and uses **Fast Fourier Transform based convolution** to efficiently calculate expected-rank information across the rating range.

The calculated expected ranks are then used to derive:

- predicted deltas,
- rating adjustments,
- and performance ratings.

### Attribution

The underlying rating-calculation technique was **not designed from scratch for this project**.

The implementation is adapted from:

- [TLE](https://github.com/cheran-senthil/TLE)
- work by [algmyr](https://github.com/algmyr)
- Codeforces rating-calculation work by Mike Mirzayanov
- the original [Carrot](https://github.com/meooow25/carrot) project

Carrot on Cloud focuses on building the **server-side architecture around the calculation engine**.

---

## 🎯 Accurate Contest Rating Inputs

Rating prediction depends heavily on using the correct participant ratings.

Carrot on Cloud handles active and completed contests differently.

### During an Active Contest

The backend:

1. fetches the latest standings,
2. keeps normal `CONTESTANT` participants,
3. loads their available ratings,
4. and computes the current prediction.

Practice, virtual, and other non-standard participation types are excluded from the prediction set.

### After a Rated Contest Finishes

For completed rated contests, the backend uses Codeforces' `contest.ratingChanges` data.

This provides:

- the exact users included in the official rating update,
- and each participant's `oldRating`.

Using `oldRating` ensures that historical calculations use the participant's rating **before the contest**, rather than a later rating from another contest.

---

## 🔒 Redis-Based Distributed Locking

Multiple users can open the same standings page at approximately the same time.

Without coordination, each request could independently trigger:

```text
Fetch standings
      ↓
Load ratings
      ↓
Calculate predictions
      ↓
Write thousands of rows
```

Carrot on Cloud prevents redundant recomputation using a **per-contest Redis distributed lock**.

```text
Request A ─┐
Request B ─┼──► lock:contest:<contestId>
Request C ─┘
                  │
            one request wins
                  │
                  ▼
              Calculate
                  │
                  ▼
             Store result
```

The lock is acquired using Redis `SET` with:

- `NX` — acquire only if the lock does not already exist
- `PX` — attach an expiration time

Each lock also receives a unique owner identifier.

Lock release uses an atomic Lua script that deletes the lock only when the stored owner matches the request attempting to release it.

This prevents one worker from accidentally deleting another worker's lock.

---

## 🛡️ Graceful Redis Degradation

Redis is used for coordination rather than as the source of truth for contest results.

If Redis is temporarily unavailable, the application can continue calculating contest data without the distributed lock.

The trade-off is that duplicate computation may occur temporarily, while MySQL remains responsible for persisted contest results.

The application also rechecks stored contest data after waiting on another worker's lock instead of assuming that lock disappearance automatically means the previous calculation completed successfully.

---

## 💾 MySQL Persistence

Calculated contest results are persisted in MySQL.

Each stored record contains:

```text
contest_id
handle
performance
delta
rating
is_final
created_at
updated_at
```

The combination of:

```text
(contest_id, handle)
```

acts as the primary key.

This allows the backend to efficiently update an existing participant result when a contest prediction is refreshed.

---

## ⚡ Batched Database Writes

Large Codeforces contests may contain thousands of participants.

Instead of inserting every result individually, Carrot on Cloud groups calculated results into batches before writing them to MySQL.

Current batch size:

```text
1000 records
```

The backend uses:

```sql
INSERT ... ON DUPLICATE KEY UPDATE
```

so existing participant records can be updated during subsequent contest refreshes.

This significantly reduces the number of database round trips compared with issuing an individual query for every participant.

---

## 🔄 Cache and Refresh Strategy

Carrot on Cloud stores calculated results rather than recomputing them on every request.

### Live Contest

A non-final contest result is reused while the cached snapshot is recent.

After approximately:

```text
5 minutes
```

the next request can trigger a fresh calculation.

### Finished Contest

After a completed contest is successfully processed, its rows are marked:

```text
is_final = 1
```

Final results can then be reused without periodic recalculation.

The high-level lifecycle is:

```text
No cached data
      │
      ▼
Calculate
      │
      ▼
Store in MySQL
      │
      ▼
Recent?
 ┌────┴────┐
 │         │
Yes        No
 │         │
Reuse   Recalculate
           │
           ▼
    Contest finished?
        │       │
       Yes      No
        │       │
     Final    Continue
     cache    refreshing
```

---

## 🧱 Architecture

```text
┌───────────────────────────────────────────────┐
│               Codeforces Website              │
│                                               │
│            Contest Standings Page             │
└──────────────────────┬────────────────────────┘
                       │
                       ▼
┌───────────────────────────────────────────────┐
│          Chrome Extension — Manifest V3       │
│                                               │
│  • Extract contest ID                         │
│  • Extract visible handles                    │
│  • Request predictions                        │
│  • Render Performance + Delta                 │
└──────────────────────┬────────────────────────┘
                       │ HTTP
                       ▼
┌───────────────────────────────────────────────┐
│             Node.js / Express API             │
│                                               │
│       Request orchestration & filtering       │
└───────────────┬─────────────────┬─────────────┘
                │                 │
                ▼                 ▼
       ┌────────────────┐   ┌────────────────┐
       │     Redis      │   │     MySQL      │
       │                │   │                │
       │ Distributed    │   │ Contest result │
       │ contest locks  │   │ persistence    │
       └────────────────┘   └────────────────┘
                │
                ▼
┌───────────────────────────────────────────────┐
│              Codeforces API                   │
│                                               │
│ • contest.standings                           │
│ • contest.ratingChanges                       │
│ • user.ratedList                              │
└──────────────────────┬────────────────────────┘
                       │
                       ▼
┌───────────────────────────────────────────────┐
│          Rating Calculation Engine            │
│                                               │
│ • Elo probability distribution                │
│ • FFT convolution                             │
│ • Expected rank calculation                   │
│ • Delta adjustment                            │
│ • Performance rating calculation              │
└───────────────────────────────────────────────┘
```

---

## 🛠️ Tech Stack

### Backend

- **Node.js**
- **Express.js**
- JavaScript ES Modules
- Codeforces API

### Data Layer

- **MySQL**
- `mysql2`
- **Redis**

### Frontend

- Chrome Extension
- Manifest V3
- Vanilla JavaScript
- HTML / CSS

### Core Concepts

- distributed locking,
- cache invalidation,
- concurrent request coordination,
- batch database operations,
- persistent caching,
- external API integration,
- FFT-based computation,
- graceful dependency degradation.

---

## 📡 Codeforces APIs

Carrot on Cloud uses official Codeforces API endpoints including:

### Contest Standings

```text
contest.standings
```

Used to retrieve participant scores, penalties, participation type, and contest metadata.

### Contest Rating Changes

```text
contest.ratingChanges
```

Used for completed rated contests to obtain the authoritative rated-user set and pre-contest `oldRating`.

### Rated User List

```text
user.ratedList
```

Used as a rating-data source when required.

---

## ⚙️ Backend Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Create a `.env` file containing the required MySQL and Redis configuration.

Example:

```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=carrot

REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_USERNAME=
REDIS_PASSWORD=

PORT=3000
```

Use values appropriate for your environment.

### 3. Initialize MySQL

Create the required tables using:

```text
backend/RES.txt
```

The main tables are:

```text
contest_results
ratingtable
```

### 4. Start the Backend

```bash
node backend/master.js
```

---

## 🧩 Chrome Extension Setup

1. Open:

```text
chrome://extensions/
```

2. Enable **Developer mode**.

3. Select **Load unpacked**.

4. Choose the:

```text
frontend/
```

directory.

5. Configure the backend endpoint in:

```text
frontend/scripts/config.js
```

For local development:

```js
globalThis.CARROT_CONFIG = {
    API_BASE_URL: "http://127.0.0.1:3000"
};
```

For a deployed backend, replace this value with the HTTPS API endpoint.

---

## 🔄 Request Flow

A typical request follows this path:

```text
1. User opens Codeforces standings

2. Extension extracts:
      contestId
      visible handles

3. Extension sends them to Carrot on Cloud

4. Backend checks the cached contest snapshot

5. If the snapshot is current:
      return stored results

6. If recalculation is required:
      attempt Redis contest lock

7. Lock owner:
      fetches Codeforces data
      loads appropriate participant ratings
      performs rating calculation
      batch-writes results to MySQL

8. Other requests reuse the resulting snapshot

9. Backend returns only the requested users

10. Extension adds Performance and Delta
    directly to the standings table
```

---

## 💡 Engineering Decisions

### Why calculate on the server?

The contest-level calculation is shared work.

Performing it centrally allows multiple users requesting the same contest to reuse one stored result instead of independently repeating the full computation.

### Why Redis?

Redis is used for short-lived **coordination**.

Its atomic lock operations allow multiple backend requests or processes to agree on which worker should perform a contest refresh.

### Why MySQL?

Contest predictions are structured data that should survive process restarts.

MySQL provides durable storage and efficient lookups using the contest ID and participant handle.

### Why both Redis and MySQL?

They solve different problems:

```text
Redis
→ temporary coordination

MySQL
→ persistent contest data
```

### Why batch inserts?

Contest calculations can produce thousands of results.

Batching reduces database round trips and allows results to be persisted efficiently.

---

## 📁 Project Structure

```text
Carrot-on-Cloud/
│
├── backend/
│   ├── cal.js
│   ├── conv.js
│   ├── binsearch.js
│   ├── master.js
│   ├── RES.txt
│   │
│   └── db/
│       ├── db.js
│       ├── mysql.js
│       └── redis.js
│
├── frontend/
│   ├── manifest.json
│   │
│   ├── scripts/
│   │   ├── config.js
│   │   ├── content.js
│   │   └── content.css
│   │
│   └── popup/
│
└── README.md
```

---

## 🎯 What This Project Demonstrates

Carrot on Cloud combines several backend and systems concepts in one practical application:

- designing a centralized computation service,
- integrating an external API,
- coordinating concurrent requests,
- implementing distributed locks,
- choosing between ephemeral and persistent storage,
- defining cache-refresh semantics,
- processing large result sets in batches,
- integrating a browser extension with a backend,
- and adapting an algorithm into a larger production-style system.

The focus of the project is not inventing a new rating algorithm, but **engineering a reliable system around an existing rating-calculation technique**.

---

## 🙏 Acknowledgments

The rating-calculation implementation builds on existing open-source Codeforces rating-prediction work.

Special thanks to:

- [Carrot](https://github.com/meooow25/carrot) by **meooow25**
- [TLE](https://github.com/cheran-senthil/TLE)
- [algmyr](https://github.com/algmyr)
- Codeforces and the work of Mike Mirzayanov

---

## 🔗 Links

- **Repository:** https://github.com/algoAkshay/Carrot-on-Cloud
- **Original Carrot:** https://github.com/meooow25/carrot
- **Codeforces:** https://codeforces.com

---

## 📄 License

MIT License.
