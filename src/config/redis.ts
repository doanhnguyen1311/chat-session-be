import Redis from "ioredis";
import { env } from "./env";

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3
});

redis.on("error", (error) => {
  console.error("Redis error:", error);
});
