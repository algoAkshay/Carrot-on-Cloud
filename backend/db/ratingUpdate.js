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
    console.log("data mil gaya");

    const userList = res.data.result;

    let cnt=0;
    userList.forEach(user => {
        cnt++;
        pool.execute(
            "INSERT INTO carrot.ratingtable (handle, rating) values (?,?) on duplicate key update rating=values(rating)",
            [user.handle,user.rating]
        )
    });
    console.log(`${cnt} row update hua`);
}

await getData();


