import "dotenv/config";
import { createClient } from "redis";

const client = createClient({
    username: process.env.REDIS_USERNAME,
    password: process.env.REDIS_PASSWORD,
    socket: {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT
    }
});

let redisAvailable = false;

client.on("ready", () => {
    redisAvailable = true;
    console.log("✅ Redis connected");
});

client.on("error", (error) => {
    redisAvailable = false;
    console.error("Redis Client Error:", error.message);
});

client.on("end", () => {
    redisAvailable = false;
    console.log("Redis connection closed");
});

try {
    await client.connect();
} catch (error) {
    redisAvailable = false;
    console.error("Redis unavailable:", error.message);
}

export function isRedisAvailable() {
    return redisAvailable && client.isReady;
}

export default client;
