import { eq, and, sql } from "drizzle-orm";
import { db } from "../db/connection.js";
import { follows, blocks } from "../db/schema/follows.js";
import { users, profiles } from "../db/schema/users.js";
import { notifications } from "../db/schema/notifications.js";
import { sendEvent } from "../realtime/sse.js";

export async function followUser(followerId: string, followingId: string) {
  if (followerId === followingId) {
    throw Object.assign(new Error("Cannot follow yourself"), {
      statusCode: 400,
    });
  }

  const isBlocked = await db.query.blocks.findFirst({
    where: and(
      eq(blocks.blockerId, followingId),
      eq(blocks.blockedId, followerId)
    ),
  });
  if (isBlocked) {
    throw Object.assign(new Error("Cannot follow this user"), {
      statusCode: 403,
    });
  }

  const existing = await db.query.follows.findFirst({
    where: and(
      eq(follows.followerId, followerId),
      eq(follows.followingId, followingId)
    ),
  });
  if (existing) return existing;

  // Auto-accept for now (local follows); remote follows go through Accept flow
  const [follow] = await db
    .insert(follows)
    .values({
      followerId,
      followingId,
      status: "accepted",
    })
    .returning();

  await db.insert(notifications).values({
    userId: followingId,
    type: "follow",
    actorId: followerId,
  });

  sendEvent(followingId, "notification", {
    type: "follow",
    actorId: followerId,
  });

  return follow;
}

export async function unfollowUser(followerId: string, followingId: string) {
  await db
    .delete(follows)
    .where(
      and(
        eq(follows.followerId, followerId),
        eq(follows.followingId, followingId)
      )
    );
}

export async function getFollowers(userId: string) {
  return db
    .select({
      id: users.id,
      username: users.username,
      displayName: profiles.displayName,
      avatarUrl: profiles.avatarUrl,
      actorUri: users.actorUri,
    })
    .from(follows)
    .innerJoin(users, eq(follows.followerId, users.id))
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .where(
      and(eq(follows.followingId, userId), eq(follows.status, "accepted"))
    );
}

export async function getFollowing(userId: string) {
  return db
    .select({
      id: users.id,
      username: users.username,
      displayName: profiles.displayName,
      avatarUrl: profiles.avatarUrl,
      actorUri: users.actorUri,
    })
    .from(follows)
    .innerJoin(users, eq(follows.followingId, users.id))
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .where(
      and(eq(follows.followerId, userId), eq(follows.status, "accepted"))
    );
}

export async function blockUser(blockerId: string, blockedId: string) {
  if (blockerId === blockedId) {
    throw Object.assign(new Error("Cannot block yourself"), {
      statusCode: 400,
    });
  }

  const existing = await db.query.blocks.findFirst({
    where: and(eq(blocks.blockerId, blockerId), eq(blocks.blockedId, blockedId)),
  });
  if (existing) return existing;

  // Remove any existing follow relationships in both directions
  await db
    .delete(follows)
    .where(
      and(eq(follows.followerId, blockerId), eq(follows.followingId, blockedId))
    );
  await db
    .delete(follows)
    .where(
      and(eq(follows.followerId, blockedId), eq(follows.followingId, blockerId))
    );

  const [block] = await db
    .insert(blocks)
    .values({ blockerId, blockedId })
    .returning();

  return block;
}

export async function unblockUser(blockerId: string, blockedId: string) {
  await db
    .delete(blocks)
    .where(
      and(eq(blocks.blockerId, blockerId), eq(blocks.blockedId, blockedId))
    );
}

export async function getBlocked(userId: string) {
  return db
    .select({
      id: users.id,
      username: users.username,
      displayName: profiles.displayName,
      avatarUrl: profiles.avatarUrl,
    })
    .from(blocks)
    .innerJoin(users, eq(blocks.blockedId, users.id))
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(blocks.blockerId, userId));
}
