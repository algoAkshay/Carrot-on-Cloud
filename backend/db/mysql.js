import "dotenv/config";
import mysql from "mysql2/promise";

console.log("DB_HOST:", process.env.DB_HOST);
console.log("DB_USER:", process.env.DB_USER);
console.log("DB_PORT:", process.env.DB_PORT);
console.log("DB_NAME:", process.env.DB_NAME);
console.log("Password exists:", !!process.env.DB_PASSWORD);

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
