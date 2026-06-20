import "dotenv/config";
import express from "express";
import cors from "cors";
import {queryContestResults} from "./db/db.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
    res.status(200).json({
        status: "ok",
        message: "Server is working"
    });
});

app.post("/contest", async (req, res) => {

    console.log("Request Received");

    try {
        let { contestId, userList } = req.body;
        contestId = Number(contestId);

        if (!Number.isInteger(contestId) || contestId <= 0 || !Array.isArray(userList)) {
            return res.status(400).json({ error: "Invalid contestId or userList" });
        }

        userList = userList
            .map(u => String(u).trim())
            .filter(Boolean);

        const data = await queryContestResults(contestId, userList);
        res.json(data);
    } catch (error) {
        console.log("FULL ERROR:", error);
        res.status(500).json({ error: "Internal server error" });
    }

    console.log("Response Sent!!!!!");
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
