import "dotenv/config";
import { createClient } from 'redis';



const client = createClient({
    username: process.env.REDIS_USERNAME,       // your redis username
    password: process.env.REDIS_PASSWORD,       // your redis password
    socket: {
        host: process.env.REDIS_HOST,           // your redis host
        port: process.env.REDIS_PORT    // your redis port
    }
});

client.on('error', err => console.log('Redis Client Error', err));

try {
    await client.connect();
}catch(e) {
    console.log(e);
}
await client.flushAll('SYNC');
console.log("✅ RedIs is connected !!!!")
export  default  client;

