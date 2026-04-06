import IORedis from "ioredis";
import { config } from "../config.js";

// BullMQ requires maxRetriesPerRequest to be null
export const redisConnection = new IORedis(config.redis.url, {
  maxRetriesPerRequest: null,
});
