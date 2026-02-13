import { eq, desc, sql, and, lt, or, inArray } from "drizzle-orm";
import { db } from "../db/connection.js";
import { posts, postAudiences, reactions } from "../db/schema/posts.js";
import { users, profiles } from "../db/schema/users.js";
import { follows } from "../db/schema/follows.js";
import { circles, circleMembers } from "../db/schema/circles.js";
import { notifications } from "../db/schema/notifications.js";
import { config } from "../config.js";
import { resolveCircleMembers } from "./circles.js";
import { attachMediaToPost, getMediaByPost } from "./media.js";
import type { CreatePostInput } from "@fediplus/shared";

// ── Helpers ──

function parsePostJson(post: typeof posts.$inferSelect) {
  return {
    ...post,
    hashtags: JSON.parse(post.hashtags) as string[],
    mentions: JSON.parse(post.mentions) as string[],
    editHistory: JSON.parse(post.editHistory) as { content: string; editedAt: string }[],
  };
}

function buildAuthor(row: {
  post: typeof posts.$inferSelect;
  authorUsername: string;
  authorDisplayName: string;
  authorAvatarUrl: string | null;
  authorActorUri: string;
}) {
  return {
    id: row.post.authorId,
    username: row.authorUsername,
    displayName: row.authorDisplayName,
    avatarUrl: row.authorAvatarUrl,
    actorUri: row.authorActorUri,
  };
}

async function getPostCounts(postId: string) {
  const [reactionCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(reactions)
    .where(eq(reactions.postId, postId));

  const [commentCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(posts)
    .where(and(eq(posts.replyToId, postId), sql`${posts.reshareOfId} IS NULL`));

  const [reshareCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(posts)
    .where(eq(posts.reshareOfId, postId));

  return {
    reactionCount: reactionCount.count,
    commentCount: commentCount.count,
    reshareCount: reshareCount.count,
  };
}

async function hasUserReacted(postId: string, userId: string) {
  const reaction = await db.query.reactions.findFirst({
    where: and(eq(reactions.postId, postId), eq(reactions.userId, userId)),
  });
  return !!reaction;
}

async function enrichPost(
  row: {
    post: typeof posts.$inferSelect;
    authorUsername: string;
    authorDisplayName: string;
    authorAvatarUrl: string | null;
    authorActorUri: string;
  },
  currentUserId: string
) {
  const counts = await getPostCounts(row.post.id);
  const userReacted = await hasUserReacted(row.post.id, currentUserId);
  const postMedia = await getMediaByPost(row.post.id);
  return {
    ...parsePostJson(row.post),
    author: buildAuthor(row),
    media: postMedia.map((m) => ({
      id: m.id,
      url: m.url,
      thumbnailUrl: m.thumbnailUrl,
      blurhash: m.blurhash,
      width: m.width,
      height: m.height,
      mimeType: m.mimeType,
      altText: m.altText,
      type: m.type,
    })),
    ...counts,
    userReacted,
  };
}

// ── Audience ──

async function buildAudienceRecords(
  postId: string,
  authorId: string,
  input: CreatePostInput
) {
  const records: {
    postId: string;
    targetType: "circle" | "user" | "public" | "followers";
    targetId: string | null;
    field: "to" | "cc" | "bto" | "bcc";
  }[] = [];

  switch (input.visibility) {
    case "public":
      records.push({ postId, targetType: "public", targetId: null, field: "to" });
      records.push({ postId, targetType: "followers", targetId: null, field: "cc" });
      break;
    case "followers":
      records.push({ postId, targetType: "followers", targetId: null, field: "to" });
      break;
    case "circles":
      if (input.circleIds && input.circleIds.length > 0) {
        const memberUris = await resolveCircleMembers(input.circleIds, authorId);
        for (const uri of memberUris) {
          records.push({ postId, targetType: "user", targetId: uri, field: "to" });
        }
      }
      break;
    case "direct":
      break;
  }

  return records;
}

// ── Create ──

export async function createPost(authorId: string, input: CreatePostInput) {
  const hashtags = extractHashtags(input.content);
  const mentions = extractMentions(input.content);

  const [post] = await db
    .insert(posts)
    .values({
      authorId,
      content: input.content,
      visibility: input.visibility,
      replyToId: input.replyToId ?? null,
      hashtags: JSON.stringify(hashtags),
      mentions: JSON.stringify(mentions),
      sensitive: input.sensitive,
      spoilerText: input.spoilerText ?? null,
    })
    .returning();

  const apId = `${config.publicUrl}/posts/${post.id}`;
  await db.update(posts).set({ apId }).where(eq(posts.id, post.id));

  const audienceRecords = await buildAudienceRecords(post.id, authorId, input);
  if (audienceRecords.length > 0) {
    await db.insert(postAudiences).values(audienceRecords);
  }

  // Attach media
  if (input.mediaIds && input.mediaIds.length > 0) {
    await attachMediaToPost(input.mediaIds, post.id);
  }

  // Notify parent post author on comment
  if (input.replyToId) {
    const parent = await db.query.posts.findFirst({
      where: eq(posts.id, input.replyToId),
    });
    if (parent && parent.authorId !== authorId) {
      await db.insert(notifications).values({
        userId: parent.authorId,
        type: "comment",
        actorId: authorId,
        targetId: parent.id,
        targetType: "post",
      });
    }
  }

  return { ...post, apId, hashtags, mentions };
}

// ── Reshare ──

export async function resharePost(userId: string, postId: string) {
  const original = await db.query.posts.findFirst({
    where: eq(posts.id, postId),
  });
  if (!original) return null;

  // Prevent duplicate reshares
  const existing = await db.query.posts.findFirst({
    where: and(eq(posts.authorId, userId), eq(posts.reshareOfId, postId)),
  });
  if (existing) return existing;

  const [reshare] = await db
    .insert(posts)
    .values({
      authorId: userId,
      content: "",
      visibility: "public",
      reshareOfId: postId,
      hashtags: "[]",
      mentions: "[]",
    })
    .returning();

  const apId = `${config.publicUrl}/posts/${reshare.id}`;
  await db.update(posts).set({ apId }).where(eq(posts.id, reshare.id));

  // Notify original author
  if (original.authorId !== userId) {
    await db.insert(notifications).values({
      userId: original.authorId,
      type: "reshare",
      actorId: userId,
      targetId: original.id,
      targetType: "post",
    });
  }

  return { ...reshare, apId };
}

export async function unresharePost(userId: string, postId: string) {
  await db
    .delete(posts)
    .where(and(eq(posts.authorId, userId), eq(posts.reshareOfId, postId)));
}

// ── Edit ──

export async function editPost(
  postId: string,
  authorId: string,
  newContent: string
) {
  const post = await db.query.posts.findFirst({
    where: and(eq(posts.id, postId), eq(posts.authorId, authorId)),
  });
  if (!post) return null;

  const history = JSON.parse(post.editHistory) as { content: string; editedAt: string }[];
  history.push({ content: post.content, editedAt: new Date().toISOString() });

  const hashtags = extractHashtags(newContent);
  const mentions = extractMentions(newContent);

  const [updated] = await db
    .update(posts)
    .set({
      content: newContent,
      hashtags: JSON.stringify(hashtags),
      mentions: JSON.stringify(mentions),
      editHistory: JSON.stringify(history),
      updatedAt: new Date(),
    })
    .where(eq(posts.id, postId))
    .returning();

  return parsePostJson(updated);
}

// ── Read ──

export async function getPost(postId: string, currentUserId?: string) {
  const result = await db
    .select({
      post: posts,
      authorUsername: users.username,
      authorDisplayName: profiles.displayName,
      authorAvatarUrl: profiles.avatarUrl,
      authorActorUri: users.actorUri,
    })
    .from(posts)
    .innerJoin(users, eq(posts.authorId, users.id))
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(posts.id, postId))
    .limit(1);

  if (result.length === 0) return null;

  const row = result[0];
  const counts = await getPostCounts(postId);
  const userReacted = currentUserId
    ? await hasUserReacted(postId, currentUserId)
    : false;

  return {
    ...parsePostJson(row.post),
    author: buildAuthor(row),
    ...counts,
    userReacted,
  };
}

// ── Stream ──

export async function getStream(
  userId: string,
  options: { cursor?: string; limit?: number; circleId?: string } = {}
) {
  const { cursor, limit = 20, circleId } = options;

  // If filtering by circle, only show posts from circle members
  if (circleId) {
    return getCircleStream(userId, circleId, cursor, limit);
  }

  // Home stream: own posts + posts from followed users (public/followers visibility)
  const followedIds = await db
    .select({ id: follows.followingId })
    .from(follows)
    .where(and(eq(follows.followerId, userId), eq(follows.status, "accepted")));

  const authorIds = [userId, ...followedIds.map((f) => f.id)];

  const conditions = [
    inArray(posts.authorId, authorIds),
    or(
      eq(posts.visibility, "public"),
      eq(posts.visibility, "followers"),
      eq(posts.authorId, userId) // always see own posts regardless of visibility
    )!,
    sql`${posts.replyToId} IS NULL`, // top-level posts only
  ];

  if (cursor) {
    conditions.push(lt(posts.createdAt, new Date(cursor)));
  }

  const result = await db
    .select({
      post: posts,
      authorUsername: users.username,
      authorDisplayName: profiles.displayName,
      authorAvatarUrl: profiles.avatarUrl,
      authorActorUri: users.actorUri,
    })
    .from(posts)
    .innerJoin(users, eq(posts.authorId, users.id))
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .where(and(...conditions))
    .orderBy(desc(posts.createdAt))
    .limit(limit + 1);

  return paginateResults(result, limit, userId);
}

async function getCircleStream(
  userId: string,
  circleId: string,
  cursor: string | undefined,
  limit: number
) {
  // Get member IDs from circle
  const members = await db
    .select({ memberId: circleMembers.memberId })
    .from(circleMembers)
    .innerJoin(circles, eq(circleMembers.circleId, circles.id))
    .where(and(eq(circleMembers.circleId, circleId), eq(circles.userId, userId)));

  const memberIds = members.map((m) => m.memberId);
  if (memberIds.length === 0) {
    return { items: [], cursor: null };
  }

  const conditions = [
    inArray(posts.authorId, memberIds),
    or(eq(posts.visibility, "public"), eq(posts.visibility, "followers"))!,
    sql`${posts.replyToId} IS NULL`,
  ];

  if (cursor) {
    conditions.push(lt(posts.createdAt, new Date(cursor)));
  }

  const result = await db
    .select({
      post: posts,
      authorUsername: users.username,
      authorDisplayName: profiles.displayName,
      authorAvatarUrl: profiles.avatarUrl,
      authorActorUri: users.actorUri,
    })
    .from(posts)
    .innerJoin(users, eq(posts.authorId, users.id))
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .where(and(...conditions))
    .orderBy(desc(posts.createdAt))
    .limit(limit + 1);

  return paginateResults(result, limit, userId);
}

// ── Hashtag Stream ──

export async function getHashtagStream(
  hashtag: string,
  currentUserId: string,
  cursor?: string,
  limit = 20
) {
  const tag = hashtag.toLowerCase();
  const conditions = [
    eq(posts.visibility, "public"),
    sql`${posts.hashtags}::text LIKE ${"%" + JSON.stringify(tag).slice(1, -1) + "%"}`,
    sql`${posts.replyToId} IS NULL`,
  ];

  if (cursor) {
    conditions.push(lt(posts.createdAt, new Date(cursor)));
  }

  const result = await db
    .select({
      post: posts,
      authorUsername: users.username,
      authorDisplayName: profiles.displayName,
      authorAvatarUrl: profiles.avatarUrl,
      authorActorUri: users.actorUri,
    })
    .from(posts)
    .innerJoin(users, eq(posts.authorId, users.id))
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .where(and(...conditions))
    .orderBy(desc(posts.createdAt))
    .limit(limit + 1);

  return paginateResults(result, limit, currentUserId);
}

// ── Comments (threaded) ──

export async function getComments(
  postId: string,
  currentUserId: string,
  cursor?: string,
  limit = 50
) {
  const conditions = [
    eq(posts.replyToId, postId),
    sql`${posts.reshareOfId} IS NULL`,
  ];

  if (cursor) {
    conditions.push(lt(posts.createdAt, new Date(cursor)));
  }

  const result = await db
    .select({
      post: posts,
      authorUsername: users.username,
      authorDisplayName: profiles.displayName,
      authorAvatarUrl: profiles.avatarUrl,
      authorActorUri: users.actorUri,
    })
    .from(posts)
    .innerJoin(users, eq(posts.authorId, users.id))
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .where(and(...conditions))
    .orderBy(posts.createdAt) // oldest first for comments
    .limit(limit + 1);

  const hasMore = result.length > limit;
  const items = result.slice(0, limit);
  const enriched = await Promise.all(
    items.map((row) => enrichPost(row, currentUserId))
  );

  return {
    items: enriched,
    cursor: hasMore
      ? items[items.length - 1].post.createdAt.toISOString()
      : null,
  };
}

// ── User Posts ──

export async function getUserPosts(
  authorUsername: string,
  currentUserId: string,
  cursor?: string,
  limit = 20
) {
  const conditions = [
    eq(users.username, authorUsername),
    sql`${posts.replyToId} IS NULL`,
    sql`${posts.reshareOfId} IS NULL`,
  ];

  if (cursor) {
    conditions.push(lt(posts.createdAt, new Date(cursor)));
  }

  const result = await db
    .select({
      post: posts,
      authorUsername: users.username,
      authorDisplayName: profiles.displayName,
      authorAvatarUrl: profiles.avatarUrl,
      authorActorUri: users.actorUri,
    })
    .from(posts)
    .innerJoin(users, eq(posts.authorId, users.id))
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .where(and(...conditions))
    .orderBy(desc(posts.createdAt))
    .limit(limit + 1);

  return paginateResults(result, limit, currentUserId);
}

// ── Reactions ──

export async function addReaction(postId: string, userId: string) {
  const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) });
  if (!post) return null;

  const existing = await db.query.reactions.findFirst({
    where: and(eq(reactions.postId, postId), eq(reactions.userId, userId)),
  });
  if (existing) return existing;

  const [reaction] = await db
    .insert(reactions)
    .values({ postId, userId, type: "+1" })
    .returning();

  // Notify post author
  if (post.authorId !== userId) {
    await db.insert(notifications).values({
      userId: post.authorId,
      type: "reaction",
      actorId: userId,
      targetId: postId,
      targetType: "post",
    });
  }

  return reaction;
}

export async function removeReaction(postId: string, userId: string) {
  await db
    .delete(reactions)
    .where(and(eq(reactions.postId, postId), eq(reactions.userId, userId)));
}

// ── Delete ──

export async function deletePost(postId: string, authorId: string) {
  const post = await db.query.posts.findFirst({
    where: and(eq(posts.id, postId), eq(posts.authorId, authorId)),
  });
  if (!post) return false;

  await db.delete(posts).where(eq(posts.id, postId));
  return true;
}

// ── Pagination Helper ──

async function paginateResults(
  result: {
    post: typeof posts.$inferSelect;
    authorUsername: string;
    authorDisplayName: string;
    authorAvatarUrl: string | null;
    authorActorUri: string;
  }[],
  limit: number,
  currentUserId: string
) {
  const hasMore = result.length > limit;
  const items = result.slice(0, limit);
  const enriched = await Promise.all(
    items.map((row) => enrichPost(row, currentUserId))
  );

  return {
    items: enriched,
    cursor: hasMore
      ? items[items.length - 1].post.createdAt.toISOString()
      : null,
  };
}

// ── Extraction ──

function extractHashtags(content: string): string[] {
  const matches = content.match(/#(\w+)/g);
  return matches ? matches.map((m) => m.slice(1).toLowerCase()) : [];
}

function extractMentions(content: string): string[] {
  const matches = content.match(/@(\w+(?:@[\w.-]+)?)/g);
  return matches ? matches.map((m) => m.slice(1)) : [];
}
