import { createClient, RedisClientType } from "redis";

let client: RedisClientType | null = null;

export async function getRedis(): Promise<RedisClientType> {
  if (client) return client;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL not set. Provide Upstash URL via env/secret.");
  client = createClient({ url });
  client.on("error", (err) => console.error("Redis error:", err));
  await client.connect();
  return client;
}
