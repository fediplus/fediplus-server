import { eq, sql } from "drizzle-orm";
import { db } from "../db/connection.js";
import { users, profiles } from "../db/schema/users.js";
import { follows } from "../db/schema/follows.js";
import { posts } from "../db/schema/posts.js";
import type { UpdateProfileInput } from "@fediplus/shared";

export async function getUserByUsername(username: string) {
  const user = await db.query.users.findFirst({
    where: eq(users.username, username),
  });
  if (!user) return null;

  const profile = await db.query.profiles.findFirst({
    where: eq(profiles.userId, user.id),
  });

  const [followersCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(follows)
    .where(
      sql`${follows.followingId} = ${user.id} AND ${follows.status} = 'accepted'`
    );

  const [followingCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(follows)
    .where(
      sql`${follows.followerId} = ${user.id} AND ${follows.status} = 'accepted'`
    );

  const [postsCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(posts)
    .where(eq(posts.authorId, user.id));

  return {
    id: user.id,
    username: user.username,
    actorType: user.actorType,
    actorUri: user.actorUri,
    profile: profile
      ? {
          ...profile,
          fields: JSON.parse(profile.fields),
        }
      : null,
    followersCount: followersCount.count,
    followingCount: followingCount.count,
    postsCount: postsCount.count,
  };
}

export async function getUserById(id: string) {
  const user = await db.query.users.findFirst({
    where: eq(users.id, id),
  });
  return user ?? null;
}

export async function updateProfile(userId: string, input: UpdateProfileInput) {
  const values: Record<string, unknown> = { updatedAt: new Date() };

  if (input.displayName !== undefined) values.displayName = input.displayName;
  if (input.bio !== undefined) values.bio = input.bio;
  if (input.location !== undefined) values.location = input.location;
  if (input.website !== undefined)
    values.website = input.website || null;
  if (input.fields !== undefined)
    values.fields = JSON.stringify(input.fields);

  const [updated] = await db
    .update(profiles)
    .set(values)
    .where(eq(profiles.userId, userId))
    .returning();

  return {
    ...updated,
    fields: JSON.parse(updated.fields),
  };
}
