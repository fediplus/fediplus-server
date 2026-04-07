import { redis } from "../db/connection.js";

/**
 * Generic cache-aside helper.
 * Tries Redis first; on miss calls `fetchFn`, caches the result, and returns it.
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  fetchFn: () => Promise<T>
): Promise<T> {
  const raw = await redis.get(key);
  if (raw !== null) {
    return JSON.parse(raw) as T;
  }
  const data = await fetchFn();
  await redis.set(key, JSON.stringify(data), "EX", ttlSeconds);
  return data;
}

/** Delete a single cache key */
export async function invalidate(key: string): Promise<void> {
  await redis.del(key);
}

/** Delete all keys matching a pattern (SCAN-based, safe for production) */
export async function invalidatePattern(pattern: string): Promise<void> {
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
    cursor = next;
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } while (cursor !== "0");
}

// ── Key builders ──

export const CacheKeys = {
  postCounts: (postId: string) => `post:counts:${postId}`,
  userProfile: (userId: string) => `user:profile:${userId}`,
  followerIds: (userId: string) => `user:followers:${userId}`,
  unreadCount: (userId: string) => `notif:unread:${userId}`,
  blockedIds: (userId: string) => `user:blocked:${userId}`,
} as const;

// ── TTLs (seconds) ──

export const CacheTTL = {
  postCounts: 60,        // 1 min — counts change on reactions/comments
  userProfile: 300,      // 5 min — profile data changes rarely
  followerIds: 120,      // 2 min — follow list changes on follow/unfollow
  unreadCount: 30,       // 30s — changes on every notification
  blockedIds: 120,       // 2 min — block list changes on block/unblock
} as const;
