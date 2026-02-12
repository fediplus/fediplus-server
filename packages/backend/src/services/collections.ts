import { eq, and, desc, sql, lt } from "drizzle-orm";
import { db } from "../db/connection.js";
import { collections, collectionItems } from "../db/schema/collections.js";
import { posts } from "../db/schema/posts.js";
import { users, profiles } from "../db/schema/users.js";
import { config } from "../config.js";

interface CreateCollectionInput {
  name: string;
  description?: string;
  isPublic?: boolean;
}

interface UpdateCollectionInput {
  name?: string;
  description?: string;
  isPublic?: boolean;
}

export async function createCollection(
  userId: string,
  input: CreateCollectionInput
) {
  const [collection] = await db
    .insert(collections)
    .values({
      userId,
      name: input.name,
      description: input.description ?? "",
      isPublic: input.isPublic ?? true,
    })
    .returning();

  const apId = `${config.publicUrl}/collections/${collection.id}`;
  await db
    .update(collections)
    .set({ apId })
    .where(eq(collections.id, collection.id));

  return { ...collection, apId };
}

export async function getCollection(collectionId: string, currentUserId?: string) {
  const collection = await db.query.collections.findFirst({
    where: eq(collections.id, collectionId),
  });
  if (!collection) return null;

  if (!collection.isPublic && collection.userId !== currentUserId) {
    return null;
  }

  const [itemCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(collectionItems)
    .where(eq(collectionItems.collectionId, collectionId));

  const owner = await db
    .select({
      username: users.username,
      displayName: profiles.displayName,
      avatarUrl: profiles.avatarUrl,
    })
    .from(users)
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(users.id, collection.userId))
    .limit(1);

  return {
    ...collection,
    itemCount: itemCount.count,
    owner: owner[0] ?? null,
  };
}

export async function getUserCollections(
  username: string,
  currentUserId?: string
) {
  const user = await db.query.users.findFirst({
    where: eq(users.username, username),
  });
  if (!user) return [];

  const conditions = [eq(collections.userId, user.id)];
  if (user.id !== currentUserId) {
    conditions.push(eq(collections.isPublic, true));
  }

  const result = await db
    .select()
    .from(collections)
    .where(and(...conditions))
    .orderBy(desc(collections.createdAt));

  return Promise.all(
    result.map(async (c) => {
      const [itemCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(collectionItems)
        .where(eq(collectionItems.collectionId, c.id));
      return { ...c, itemCount: itemCount.count };
    })
  );
}

export async function updateCollection(
  collectionId: string,
  userId: string,
  input: UpdateCollectionInput
) {
  const collection = await db.query.collections.findFirst({
    where: and(eq(collections.id, collectionId), eq(collections.userId, userId)),
  });
  if (!collection) return null;

  const values: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) values.name = input.name;
  if (input.description !== undefined) values.description = input.description;
  if (input.isPublic !== undefined) values.isPublic = input.isPublic;

  const [updated] = await db
    .update(collections)
    .set(values)
    .where(eq(collections.id, collectionId))
    .returning();

  return updated;
}

export async function deleteCollection(collectionId: string, userId: string) {
  const collection = await db.query.collections.findFirst({
    where: and(eq(collections.id, collectionId), eq(collections.userId, userId)),
  });
  if (!collection) return false;

  await db.delete(collections).where(eq(collections.id, collectionId));
  return true;
}

export async function addItem(
  collectionId: string,
  userId: string,
  postId: string
) {
  const collection = await db.query.collections.findFirst({
    where: and(eq(collections.id, collectionId), eq(collections.userId, userId)),
  });
  if (!collection) return null;

  const existing = await db.query.collectionItems.findFirst({
    where: and(
      eq(collectionItems.collectionId, collectionId),
      eq(collectionItems.postId, postId)
    ),
  });
  if (existing) return existing;

  // Get next position
  const [maxPos] = await db
    .select({ max: sql<number>`coalesce(max(${collectionItems.position}), -1)::int` })
    .from(collectionItems)
    .where(eq(collectionItems.collectionId, collectionId));

  const [item] = await db
    .insert(collectionItems)
    .values({
      collectionId,
      postId,
      position: maxPos.max + 1,
    })
    .returning();

  return item;
}

export async function removeItem(
  collectionId: string,
  userId: string,
  postId: string
) {
  const collection = await db.query.collections.findFirst({
    where: and(eq(collections.id, collectionId), eq(collections.userId, userId)),
  });
  if (!collection) return false;

  await db
    .delete(collectionItems)
    .where(
      and(
        eq(collectionItems.collectionId, collectionId),
        eq(collectionItems.postId, postId)
      )
    );
  return true;
}

export async function getCollectionItems(
  collectionId: string,
  currentUserId?: string,
  cursor?: string,
  limit = 20
) {
  const collection = await db.query.collections.findFirst({
    where: eq(collections.id, collectionId),
  });
  if (!collection) return null;

  if (!collection.isPublic && collection.userId !== currentUserId) {
    return null;
  }

  const conditions = [eq(collectionItems.collectionId, collectionId)];
  if (cursor) {
    conditions.push(lt(collectionItems.addedAt, new Date(cursor)));
  }

  const result = await db
    .select({
      item: collectionItems,
      post: posts,
      authorUsername: users.username,
      authorDisplayName: profiles.displayName,
      authorAvatarUrl: profiles.avatarUrl,
      authorActorUri: users.actorUri,
    })
    .from(collectionItems)
    .innerJoin(posts, eq(collectionItems.postId, posts.id))
    .innerJoin(users, eq(posts.authorId, users.id))
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .where(and(...conditions))
    .orderBy(collectionItems.position)
    .limit(limit + 1);

  const hasMore = result.length > limit;
  const items = result.slice(0, limit).map((row) => ({
    ...row.item,
    post: {
      ...row.post,
      hashtags: JSON.parse(row.post.hashtags),
      mentions: JSON.parse(row.post.mentions),
      author: {
        id: row.post.authorId,
        username: row.authorUsername,
        displayName: row.authorDisplayName,
        avatarUrl: row.authorAvatarUrl,
        actorUri: row.authorActorUri,
      },
    },
  }));

  return {
    items,
    cursor: hasMore
      ? result[limit - 1].item.addedAt.toISOString()
      : null,
  };
}
