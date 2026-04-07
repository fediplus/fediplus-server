import { sql, or, eq } from "drizzle-orm";
import { db } from "../db/connection.js";
import { blocks } from "../db/schema/follows.js";
import { cached, CacheKeys, CacheTTL } from "./cache.js";

// ── Sanitization ───────────────────────────────────────────────
// Strip tsquery special characters and build a safe query string.

function sanitizeQuery(raw: string): string {
  // Remove characters that break tsquery parsing
  return raw.replace(/[!&|():*<>\\'"]/g, " ").trim();
}

function toTsquery(raw: string): string {
  const clean = sanitizeQuery(raw);
  if (!clean) return "";

  // Split into words, drop empties, join with & (AND) for ranked FTS
  const terms = clean.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return "";

  // Each term gets :* prefix matching so "fed" matches "fediverse"
  return terms.map((t) => `${t}:*`).join(" & ");
}

// Drizzle postgres-js execute returns the row array directly
async function execSql<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  const result = await db.execute(query);
  // postgres-js returns the rows array directly; drizzle may wrap it
  return (Array.isArray(result) ? result : (result as any).rows ?? []) as T[];
}

// ── Result types ───────────────────────────────────────────────

export interface SearchResults {
  posts: PostSearchHit[];
  users: UserSearchHit[];
  communities: CommunitySearchHit[];
  hashtags: HashtagSearchHit[];
}

export interface PostSearchHit {
  id: string;
  content: string;
  authorId: string;
  authorUsername: string;
  authorDisplayName: string;
  authorAvatarUrl: string | null;
  visibility: string;
  createdAt: Date;
  rank: number;
}

export interface UserSearchHit {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string;
  actorUri: string;
  similarity: number;
}

export interface CommunitySearchHit {
  id: string;
  name: string;
  slug: string;
  description: string;
  avatarUrl: string | null;
  visibility: string;
  memberCount: number;
  rank: number;
}

export interface HashtagSearchHit {
  tag: string;
  postCount: number;
}

// ── Unified search ─────────────────────────────────────────────

async function getBlockedIds(userId?: string): Promise<string[]> {
  if (!userId) return [];
  return cached(CacheKeys.blockedIds(userId), CacheTTL.blockedIds, async () => {
    const rows = await db
      .select({ blockerId: blocks.blockerId, blockedId: blocks.blockedId })
      .from(blocks)
      .where(or(eq(blocks.blockerId, userId), eq(blocks.blockedId, userId)));
    const ids = new Set<string>();
    for (const r of rows) {
      if (r.blockerId !== userId) ids.add(r.blockerId);
      if (r.blockedId !== userId) ids.add(r.blockedId);
    }
    return [...ids];
  });
}

export async function search(
  query: string,
  options: {
    type?: "all" | "posts" | "users" | "communities" | "hashtags";
    limit?: number;
    offset?: number;
    currentUserId?: string;
  } = {}
): Promise<SearchResults> {
  const { type = "all", limit = 20, offset = 0, currentUserId } = options;
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const blockedIds = await getBlockedIds(currentUserId);

  const results: SearchResults = {
    posts: [],
    users: [],
    communities: [],
    hashtags: [],
  };

  const searches: Promise<void>[] = [];

  if (type === "all" || type === "posts") {
    searches.push(
      searchPosts(query, safeLimit, offset, blockedIds).then((r) => {
        results.posts = r;
      })
    );
  }

  if (type === "all" || type === "users") {
    searches.push(
      searchUsers(query, safeLimit, offset, blockedIds).then((r) => {
        results.users = r;
      })
    );
  }

  if (type === "all" || type === "communities") {
    searches.push(
      searchCommunities(query, safeLimit, offset).then((r) => {
        results.communities = r;
      })
    );
  }

  if (type === "all" || type === "hashtags") {
    searches.push(
      searchHashtags(query, safeLimit, offset).then((r) => {
        results.hashtags = r;
      })
    );
  }

  await Promise.all(searches);
  return results;
}

// ── Post search ────────────────────────────────────────────────
// Uses the generated tsvector column + ts_rank for relevance ordering.

async function searchPosts(
  query: string,
  limit: number,
  offset: number,
  blockedIds: string[]
): Promise<PostSearchHit[]> {
  const tsq = toTsquery(query);
  if (!tsq) return [];

  const blockClause =
    blockedIds.length > 0
      ? sql`AND p.author_id NOT IN (${sql.join(blockedIds.map((id) => sql`${id}`), sql`, `)})`
      : sql``;

  return execSql<PostSearchHit>(sql`
    SELECT
      p.id,
      p.content,
      p.author_id     AS "authorId",
      u.username       AS "authorUsername",
      pr.display_name  AS "authorDisplayName",
      pr.avatar_url    AS "authorAvatarUrl",
      p.visibility,
      p.created_at     AS "createdAt",
      ts_rank(p.search_tsv, to_tsquery('english', ${tsq})) AS rank
    FROM posts p
    JOIN users u    ON u.id  = p.author_id
    JOIN profiles pr ON pr.user_id = u.id
    WHERE p.search_tsv @@ to_tsquery('english', ${tsq})
      AND p.visibility = 'public'
      AND p.reply_to_id IS NULL
      AND p.reshare_of_id IS NULL
      ${blockClause}
    ORDER BY rank DESC, p.created_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `);
}

// ── User search ────────────────────────────────────────────────
// Combines trigram similarity on username + display_name for fuzzy matching.

async function searchUsers(
  query: string,
  limit: number,
  offset: number,
  blockedIds: string[]
): Promise<UserSearchHit[]> {
  const clean = sanitizeQuery(query);
  if (!clean) return [];

  const blockClause =
    blockedIds.length > 0
      ? sql`AND u.id NOT IN (${sql.join(blockedIds.map((id) => sql`${id}`), sql`, `)})`
      : sql``;

  return execSql<UserSearchHit>(sql`
    SELECT
      u.id,
      u.username,
      pr.display_name AS "displayName",
      pr.avatar_url   AS "avatarUrl",
      pr.bio,
      u.actor_uri     AS "actorUri",
      GREATEST(
        similarity(u.username, ${clean}),
        similarity(pr.display_name, ${clean})
      ) AS similarity
    FROM users u
    JOIN profiles pr ON pr.user_id = u.id
    WHERE (
      u.username     % ${clean}
      OR pr.display_name % ${clean}
    )
      ${blockClause}
    ORDER BY similarity DESC, u.created_at ASC
    LIMIT ${limit}
    OFFSET ${offset}
  `);
}

// ── Community search ───────────────────────────────────────────
// Uses tsvector for content + trigram for name, combined with UNION to get both.

async function searchCommunities(
  query: string,
  limit: number,
  offset: number
): Promise<CommunitySearchHit[]> {
  const tsq = toTsquery(query);
  const clean = sanitizeQuery(query);
  if (!clean) return [];

  // If we have a valid tsquery, use FTS; otherwise fall back to trigram only
  if (tsq) {
    return execSql<CommunitySearchHit>(sql`
      SELECT
        c.id,
        c.name,
        c.slug,
        c.description,
        c.avatar_url   AS "avatarUrl",
        c.visibility,
        (SELECT count(*)::int FROM community_members cm WHERE cm.community_id = c.id) AS "memberCount",
        GREATEST(
          ts_rank(c.search_tsv, to_tsquery('english', ${tsq})),
          similarity(c.name, ${clean})
        ) AS rank
      FROM communities c
      WHERE (
        c.search_tsv @@ to_tsquery('english', ${tsq})
        OR c.name % ${clean}
      )
        AND c.visibility = 'public'
      ORDER BY rank DESC, c.created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `);
  }

  // Trigram-only fallback
  return execSql<CommunitySearchHit>(sql`
    SELECT
      c.id,
      c.name,
      c.slug,
      c.description,
      c.avatar_url   AS "avatarUrl",
      c.visibility,
      (SELECT count(*)::int FROM community_members cm WHERE cm.community_id = c.id) AS "memberCount",
      similarity(c.name, ${clean}) AS rank
    FROM communities c
    WHERE c.name % ${clean}
      AND c.visibility = 'public'
    ORDER BY rank DESC, c.created_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `);
}

// ── Hashtag search ─────────────────────────────────────────────
// Extracts distinct hashtags from the JSON-stored hashtags column,
// ranks by usage count, prefix-matches the query.

async function searchHashtags(
  query: string,
  limit: number,
  offset: number
): Promise<HashtagSearchHit[]> {
  const clean = sanitizeQuery(query).toLowerCase().replace(/^#/, "");
  if (!clean) return [];

  return execSql<HashtagSearchHit>(sql`
    SELECT
      tag,
      count(*) ::int AS "postCount"
    FROM (
      SELECT jsonb_array_elements_text(hashtags::jsonb) AS tag
      FROM posts
      WHERE visibility = 'public'
    ) sub
    WHERE tag LIKE ${clean + "%"}
    GROUP BY tag
    ORDER BY "postCount" DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `);
}
