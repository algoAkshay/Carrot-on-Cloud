import "dotenv/config";
import mysql from "mysql2/promise";

console.log("✅ MySQL connected to DB:", conn.config.database);

const pool = mysql.createPool({
    host: process.env.DB_HOST,          // your database host
    user: process.env.DB_USER,          // use your actual username
    password: process.env.DB_PASSWORD,  // Use your actual password
    database: process.env.DB_NAME,      // your database name
    port: Number(process.env.DB_PORT),  // your database port
});


try{
    const conn = await pool.getConnection();
    console.log("✅ MySQL connected to DB:", conn.config.database);
    conn.release();
}catch (e){
    console.log(e);
}


export default pool;
