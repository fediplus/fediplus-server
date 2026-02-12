import { eq, and, desc, sql, lt } from "drizzle-orm";
import { generateKeyPairSync } from "node:crypto";
import { db } from "../db/connection.js";
import { communities, communityMembers } from "../db/schema/communities.js";
import { posts } from "../db/schema/posts.js";
import { users, profiles } from "../db/schema/users.js";
import { config } from "../config.js";

interface CreateCommunityInput {
  name: string;
  slug: string;
  description?: string;
  visibility?: "public" | "private";
  postApproval?: boolean;
}

interface UpdateCommunityInput {
  name?: string;
  description?: string;
  visibility?: "public" | "private";
  postApproval?: boolean;
}

export async function createCommunity(
  userId: string,
  input: CreateCommunityInput
) {
  const existing = await db.query.communities.findFirst({
    where: eq(communities.slug, input.slug),
  });
  if (existing) {
    throw Object.assign(new Error("Community slug already taken"), {
      statusCode: 409,
    });
  }

  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  const baseUri = `${config.publicUrl}/communities/${input.slug}`;

  const [community] = await db
    .insert(communities)
    .values({
      name: input.name,
      slug: input.slug,
      description: input.description ?? "",
      visibility: input.visibility ?? "public",
      postApproval: input.postApproval ?? false,
      actorUri: baseUri,
      inboxUri: `${baseUri}/inbox`,
      outboxUri: `${baseUri}/outbox`,
      followersUri: `${baseUri}/followers`,
      publicKey,
      privateKey,
      createdById: userId,
    })
    .returning();

  // Creator becomes owner
  await db.insert(communityMembers).values({
    communityId: community.id,
    userId,
    role: "owner",
    approved: true,
  });

  return community;
}

export async function getCommunity(slug: string) {
  const community = await db.query.communities.findFirst({
    where: eq(communities.slug, slug),
  });
  if (!community) return null;

  const [memberCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(communityMembers)
    .where(
      and(
        eq(communityMembers.communityId, community.id),
        eq(communityMembers.approved, true)
      )
    );

  return { ...community, memberCount: memberCount.count };
}

export async function listCommunities(cursor?: string, limit = 20) {
  const conditions = [eq(communities.visibility, "public")];
  if (cursor) {
    conditions.push(lt(communities.createdAt, new Date(cursor)));
  }

  const result = await db
    .select()
    .from(communities)
    .where(and(...conditions))
    .orderBy(desc(communities.createdAt))
    .limit(limit + 1);

  const hasMore = result.length > limit;
  const items = result.slice(0, limit);

  // Get member counts
  const withCounts = await Promise.all(
    items.map(async (c) => {
      const [mc] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(communityMembers)
        .where(
          and(
            eq(communityMembers.communityId, c.id),
            eq(communityMembers.approved, true)
          )
        );
      return { ...c, memberCount: mc.count };
    })
  );

  return {
    items: withCounts,
    cursor: hasMore ? items[items.length - 1].createdAt.toISOString() : null,
  };
}

export async function getUserCommunities(userId: string) {
  const memberships = await db
    .select({
      community: communities,
      role: communityMembers.role,
    })
    .from(communityMembers)
    .innerJoin(communities, eq(communityMembers.communityId, communities.id))
    .where(
      and(eq(communityMembers.userId, userId), eq(communityMembers.approved, true))
    )
    .orderBy(communities.name);

  return memberships.map((m) => ({ ...m.community, role: m.role }));
}

export async function updateCommunity(
  slug: string,
  userId: string,
  input: UpdateCommunityInput
) {
  const community = await db.query.communities.findFirst({
    where: eq(communities.slug, slug),
  });
  if (!community) return null;

  const membership = await db.query.communityMembers.findFirst({
    where: and(
      eq(communityMembers.communityId, community.id),
      eq(communityMembers.userId, userId)
    ),
  });
  if (!membership || (membership.role !== "owner" && membership.role !== "moderator")) {
    throw Object.assign(new Error("Not authorized"), { statusCode: 403 });
  }

  const values: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) values.name = input.name;
  if (input.description !== undefined) values.description = input.description;
  if (input.visibility !== undefined) values.visibility = input.visibility;
  if (input.postApproval !== undefined) values.postApproval = input.postApproval;

  const [updated] = await db
    .update(communities)
    .set(values)
    .where(eq(communities.id, community.id))
    .returning();

  return updated;
}

export async function deleteCommunity(slug: string, userId: string) {
  const community = await db.query.communities.findFirst({
    where: eq(communities.slug, slug),
  });
  if (!community) return false;

  const membership = await db.query.communityMembers.findFirst({
    where: and(
      eq(communityMembers.communityId, community.id),
      eq(communityMembers.userId, userId)
    ),
  });
  if (!membership || membership.role !== "owner") {
    throw Object.assign(new Error("Only owner can delete"), { statusCode: 403 });
  }

  await db.delete(communities).where(eq(communities.id, community.id));
  return true;
}

export async function joinCommunity(slug: string, userId: string) {
  const community = await db.query.communities.findFirst({
    where: eq(communities.slug, slug),
  });
  if (!community) return null;

  const existing = await db.query.communityMembers.findFirst({
    where: and(
      eq(communityMembers.communityId, community.id),
      eq(communityMembers.userId, userId)
    ),
  });
  if (existing) return existing;

  const needsApproval = community.visibility === "private";

  const [member] = await db
    .insert(communityMembers)
    .values({
      communityId: community.id,
      userId,
      role: "member",
      approved: !needsApproval,
    })
    .returning();

  return member;
}

export async function leaveCommunity(slug: string, userId: string) {
  const community = await db.query.communities.findFirst({
    where: eq(communities.slug, slug),
  });
  if (!community) return false;

  // Owners can't leave (must transfer ownership or delete)
  const membership = await db.query.communityMembers.findFirst({
    where: and(
      eq(communityMembers.communityId, community.id),
      eq(communityMembers.userId, userId)
    ),
  });
  if (!membership) return false;
  if (membership.role === "owner") {
    throw Object.assign(new Error("Owner cannot leave. Transfer ownership or delete the community."), {
      statusCode: 400,
    });
  }

  await db
    .delete(communityMembers)
    .where(eq(communityMembers.id, membership.id));
  return true;
}

export async function approveMember(
  slug: string,
  memberId: string,
  moderatorId: string
) {
  const community = await db.query.communities.findFirst({
    where: eq(communities.slug, slug),
  });
  if (!community) return null;

  const modMembership = await db.query.communityMembers.findFirst({
    where: and(
      eq(communityMembers.communityId, community.id),
      eq(communityMembers.userId, moderatorId)
    ),
  });
  if (!modMembership || modMembership.role === "member") {
    throw Object.assign(new Error("Not authorized"), { statusCode: 403 });
  }

  const [updated] = await db
    .update(communityMembers)
    .set({ approved: true })
    .where(
      and(
        eq(communityMembers.communityId, community.id),
        eq(communityMembers.userId, memberId)
      )
    )
    .returning();

  return updated;
}

export async function setMemberRole(
  slug: string,
  memberId: string,
  role: "moderator" | "member",
  ownerId: string
) {
  const community = await db.query.communities.findFirst({
    where: eq(communities.slug, slug),
  });
  if (!community) return null;

  const ownerMembership = await db.query.communityMembers.findFirst({
    where: and(
      eq(communityMembers.communityId, community.id),
      eq(communityMembers.userId, ownerId)
    ),
  });
  if (!ownerMembership || ownerMembership.role !== "owner") {
    throw Object.assign(new Error("Only owner can change roles"), {
      statusCode: 403,
    });
  }

  const [updated] = await db
    .update(communityMembers)
    .set({ role })
    .where(
      and(
        eq(communityMembers.communityId, community.id),
        eq(communityMembers.userId, memberId)
      )
    )
    .returning();

  return updated;
}

export async function getCommunityMembers(slug: string) {
  const community = await db.query.communities.findFirst({
    where: eq(communities.slug, slug),
  });
  if (!community) return null;

  return db
    .select({
      id: users.id,
      username: users.username,
      displayName: profiles.displayName,
      avatarUrl: profiles.avatarUrl,
      role: communityMembers.role,
      approved: communityMembers.approved,
      joinedAt: communityMembers.joinedAt,
    })
    .from(communityMembers)
    .innerJoin(users, eq(communityMembers.userId, users.id))
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(communityMembers.communityId, community.id))
    .orderBy(communityMembers.joinedAt);
}

export async function getCommunityPosts(
  slug: string,
  currentUserId: string,
  cursor?: string,
  limit = 20
) {
  const community = await db.query.communities.findFirst({
    where: eq(communities.slug, slug),
  });
  if (!community) return null;

  // For private communities, check membership
  if (community.visibility === "private") {
    const membership = await db.query.communityMembers.findFirst({
      where: and(
        eq(communityMembers.communityId, community.id),
        eq(communityMembers.userId, currentUserId),
        eq(communityMembers.approved, true)
      ),
    });
    if (!membership) {
      throw Object.assign(new Error("Not a member of this community"), {
        statusCode: 403,
      });
    }
  }

  // Community posts: posts by community members tagged to this community
  // For now, we use a convention: posts with hashtag matching the community slug
  const memberIds = await db
    .select({ userId: communityMembers.userId })
    .from(communityMembers)
    .where(
      and(
        eq(communityMembers.communityId, community.id),
        eq(communityMembers.approved, true)
      )
    );

  const ids = memberIds.map((m) => m.userId);
  if (ids.length === 0) return { items: [], cursor: null };

  const conditions = [
    sql`${posts.authorId} IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`,
    eq(posts.visibility, "public"),
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

  const hasMore = result.length > limit;
  const items = result.slice(0, limit).map((row) => ({
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
  }));

  return {
    items,
    cursor: hasMore
      ? result[limit - 1].post.createdAt.toISOString()
      : null,
  };
}
