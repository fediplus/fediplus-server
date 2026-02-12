import { eq, desc, sql, and, lt } from "drizzle-orm";
import { db } from "../db/connection.js";
import { posts, postAudiences, reactions } from "../db/schema/posts.js";
import { users, profiles } from "../db/schema/users.js";
import { config } from "../config.js";
import { resolveCircleMembers } from "./circles.js";
import type { CreatePostInput } from "@fediplus/shared";

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

  // Set AP ID
  const apId = `${config.publicUrl}/posts/${post.id}`;
  await db.update(posts).set({ apId }).where(eq(posts.id, post.id));

  // Create audience records
  const audienceRecords = await buildAudienceRecords(
    post.id,
    authorId,
    input
  );
  if (audienceRecords.length > 0) {
    await db.insert(postAudiences).values(audienceRecords);
  }

  return { ...post, apId };
}

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
      records.push({
        postId,
        targetType: "public",
        targetId: null,
        field: "to",
      });
      records.push({
        postId,
        targetType: "followers",
        targetId: null,
        field: "cc",
      });
      break;

    case "followers":
      records.push({
        postId,
        targetType: "followers",
        targetId: null,
        field: "to",
      });
      break;

    case "circles":
      if (input.circleIds && input.circleIds.length > 0) {
        const memberUris = await resolveCircleMembers(
          input.circleIds,
          authorId
        );
        for (const uri of memberUris) {
          records.push({
            postId,
            targetType: "user",
            targetId: uri,
            field: "to",
          });
        }
      }
      break;

    case "direct":
      // Direct messages handled separately
      break;
  }

  return records;
}

export async function getPost(postId: string) {
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

  return {
    ...row.post,
    hashtags: JSON.parse(row.post.hashtags),
    mentions: JSON.parse(row.post.mentions),
    editHistory: JSON.parse(row.post.editHistory),
    author: {
      id: row.post.authorId,
      username: row.authorUsername,
      displayName: row.authorDisplayName,
      avatarUrl: row.authorAvatarUrl,
      actorUri: row.authorActorUri,
    },
    ...counts,
  };
}

export async function getTimeline(
  userId: string,
  cursor?: string,
  limit = 20
) {
  const conditions = [eq(posts.visibility, "public")];
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

  const hasMore = result.length > limit;
  const items = result.slice(0, limit);

  const postsWithCounts = await Promise.all(
    items.map(async (row) => {
      const counts = await getPostCounts(row.post.id);
      const userReacted = await hasUserReacted(row.post.id, userId);
      return {
        ...row.post,
        hashtags: JSON.parse(row.post.hashtags),
        mentions: JSON.parse(row.post.mentions),
        editHistory: JSON.parse(row.post.editHistory),
        author: {
          id: row.post.authorId,
          username: row.authorUsername,
          displayName: row.authorDisplayName,
          avatarUrl: row.authorAvatarUrl,
          actorUri: row.authorActorUri,
        },
        ...counts,
        userReacted,
      };
    })
  );

  return {
    items: postsWithCounts,
    cursor: hasMore
      ? items[items.length - 1].post.createdAt.toISOString()
      : null,
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
    .where(eq(posts.replyToId, postId));

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

export async function addReaction(postId: string, userId: string) {
  const existing = await db.query.reactions.findFirst({
    where: and(eq(reactions.postId, postId), eq(reactions.userId, userId)),
  });
  if (existing) return existing;

  const [reaction] = await db
    .insert(reactions)
    .values({ postId, userId, type: "+1" })
    .returning();

  return reaction;
}

export async function removeReaction(postId: string, userId: string) {
  await db
    .delete(reactions)
    .where(and(eq(reactions.postId, postId), eq(reactions.userId, userId)));
}

export async function deletePost(postId: string, authorId: string) {
  const post = await db.query.posts.findFirst({
    where: and(eq(posts.id, postId), eq(posts.authorId, authorId)),
  });
  if (!post) return false;

  await db.delete(posts).where(eq(posts.id, postId));
  return true;
}

function extractHashtags(content: string): string[] {
  const matches = content.match(/#(\w+)/g);
  return matches ? matches.map((m) => m.slice(1).toLowerCase()) : [];
}

function extractMentions(content: string): string[] {
  const matches = content.match(/@(\w+(?:@[\w.-]+)?)/g);
  return matches ? matches.map((m) => m.slice(1)) : [];
}
