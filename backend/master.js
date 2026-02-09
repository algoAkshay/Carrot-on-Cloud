import "dotenv/config";
import express from "express";
import  cors from "cors";
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
    let { contestId, userList } = req.body;


    userList = userList.map(u => u.trim());



    try {
        const data = await queryContestResults(contestId, userList);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: "Internal server error" });
    }

    console.log("Response Sent!!!!!");
});



app.listen(3000);
