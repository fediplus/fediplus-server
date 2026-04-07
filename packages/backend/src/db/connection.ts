import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import IORedis from "ioredis";
import * as schema from "./schema/index.js";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://fediplus:fediplus@localhost:5432/fediplus";

const client = postgres(connectionString);

export const db = drizzle(client, { schema });
export type Database = typeof db;

// ── Redis (shared instance for caching + general use) ──

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
export const redis = new IORedis(redisUrl, { maxRetriesPerRequest: null });
