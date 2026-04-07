import { eq, and, desc, lt, sql, notInArray } from "drizzle-orm";
import { db } from "../db/connection.js";
import { notifications } from "../db/schema/notifications.js";
import { users, profiles } from "../db/schema/users.js";
import { blocks } from "../db/schema/follows.js";
import { cached, invalidate, CacheKeys, CacheTTL } from "./cache.js";

// ── Block list (bidirectional) for filtering ──

async function getBlockedIds(userId: string): Promise<string[]> {
  return cached(CacheKeys.blockedIds(userId), CacheTTL.blockedIds, async () => {
    const rows = await db
      .select({ blockerId: blocks.blockerId, blockedId: blocks.blockedId })
      .from(blocks)
      .where(
        sql`${blocks.blockerId} = ${userId} OR ${blocks.blockedId} = ${userId}`
      );
    const ids = new Set<string>();
    for (const r of rows) {
      if (r.blockerId !== userId) ids.add(r.blockerId);
      if (r.blockedId !== userId) ids.add(r.blockedId);
    }
    return [...ids];
  });
}

export async function getNotifications(
  userId: string,
  cursor?: string,
  limit = 30
) {
  const conditions = [eq(notifications.userId, userId)];
  if (cursor) {
    conditions.push(lt(notifications.createdAt, new Date(cursor)));
  }

  // Filter out notifications from blocked users
  const blockedIds = await getBlockedIds(userId);
  if (blockedIds.length > 0) {
    conditions.push(notInArray(notifications.actorId, blockedIds));
  }

  const result = await db
    .select({
      notification: notifications,
      actorUsername: users.username,
      actorDisplayName: profiles.displayName,
      actorAvatarUrl: profiles.avatarUrl,
    })
    .from(notifications)
    .innerJoin(users, eq(notifications.actorId, users.id))
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt))
    .limit(limit + 1);

  const hasMore = result.length > limit;
  const items = result.slice(0, limit).map((row) => ({
    ...row.notification,
    actor: {
      username: row.actorUsername,
      displayName: row.actorDisplayName,
      avatarUrl: row.actorAvatarUrl,
    },
  }));

  return {
    items,
    cursor: hasMore
      ? result[limit - 1].notification.createdAt.toISOString()
      : null,
  };
}

export async function markNotificationRead(id: string, userId: string) {
  await db
    .update(notifications)
    .set({ read: true })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
}

export async function markAllRead(userId: string) {
  await db
    .update(notifications)
    .set({ read: true })
    .where(and(eq(notifications.userId, userId), eq(notifications.read, false)));
}

export async function getUnreadCount(userId: string): Promise<number> {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(
      and(eq(notifications.userId, userId), eq(notifications.read, false))
    );
  return result.count;
}
