import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { makePost } from "../helpers/fixtures.js";

// ── Mocks ──────────────────────────────────────────────────────

const findFirstFn = vi.fn();
const selectFn = vi.fn();
const insertFn = vi.fn();
const updateFn = vi.fn();
const deleteFn = vi.fn();
const returningFn = vi.fn();

function chainProxy(resolvedValue: unknown = []) {
  const proxy: any = new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === "returning") return returningFn;
        if (prop === "then")
          return (r: (v: unknown) => void) => r(resolvedValue);
        return vi.fn(() => proxy);
      },
    }
  );
  return proxy;
}

vi.mock("../../db/connection.js", () => ({
  db: {
    query: {
      posts: { findFirst: findFirstFn },
      reactions: { findFirst: vi.fn() },
    },
    select: selectFn,
    insert: insertFn,
    update: updateFn,
    delete: deleteFn,
  },
  redis: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
    del: vi.fn().mockResolvedValue(1),
    scan: vi.fn().mockResolvedValue(["0", []]),
  },
}));

vi.mock("../../config.js", () => ({
  config: {
    publicUrl: "https://fediplus.test",
    domain: "fediplus.test",
  },
}));

vi.mock("../../realtime/sse.js", () => ({
  sendEvent: vi.fn(),
  broadcastToUsers: vi.fn(),
}));

vi.mock("../../services/circles.js", () => ({
  resolveCircleMembers: vi.fn(async () => []),
}));

vi.mock("../../services/media.js", () => ({
  attachMediaToPost: vi.fn(),
  getMediaByPost: vi.fn(async () => []),
}));

// Cache mock: returns pre-configured values for blocked keys,
// delegates to the real fetch function for everything else
const cachedOverrides = new Map<string, unknown>();

vi.mock("../../services/cache.js", () => ({
  cached: vi.fn(async (key: string, _ttl: number, fn: () => Promise<unknown>) => {
    if (cachedOverrides.has(key)) return cachedOverrides.get(key);
    return fn();
  }),
  invalidate: vi.fn(async () => {}),
  invalidatePattern: vi.fn(async () => {}),
  CacheKeys: {
    postCounts: (id: string) => `post:counts:${id}`,
    followerIds: (id: string) => `user:followers:${id}`,
    blockedIds: (id: string) => `user:blocked:${id}`,
  },
  CacheTTL: { postCounts: 60, followerIds: 120, blockedIds: 120 },
}));

/** Set blocked IDs that getBlockedIds will return for a user */
function setBlockedIds(userId: string, blockedIds: string[]) {
  cachedOverrides.set(`user:blocked:${userId}`, blockedIds);
}

/** Set cached follower IDs */
function setFollowerIds(userId: string, followerIds: string[]) {
  cachedOverrides.set(`user:followers:${userId}`, followerIds);
}

// ── Import AFTER mocks ────────────────────────────────────────

const {
  getPost,
  addReaction,
  resharePost,
  getStream,
  getHashtagStream,
  getComments,
  getUserPosts,
} = await import("../../services/posts.js");

// ── Tests ──────────────────────────────────────────────────────

describe("Block enforcement — getPost", () => {
  const currentUserId = randomUUID();
  const blockedUserId = randomUUID();

  beforeEach(() => {
    vi.clearAllMocks();
    cachedOverrides.clear();
  });

  it("should return null when post author is blocked by viewer", async () => {
    const post = makePost({ authorId: blockedUserId });
    setBlockedIds(currentUserId, [blockedUserId]);

    const postRow = {
      post,
      authorUsername: "blockeduser",
      authorDisplayName: "Blocked",
      authorAvatarUrl: null,
      authorActorUri: "https://fediplus.test/users/blockeduser",
    };
    selectFn.mockReturnValueOnce(chainProxy([postRow]));

    const result = await getPost(post.id, currentUserId);
    expect(result).toBeNull();
  });

  it("should return post when no block relationship exists", async () => {
    const authorId = randomUUID();
    const post = makePost({ authorId });
    setBlockedIds(currentUserId, []);

    const postRow = {
      post,
      authorUsername: "normaluser",
      authorDisplayName: "Normal",
      authorAvatarUrl: null,
      authorActorUri: "https://fediplus.test/users/normaluser",
    };
    selectFn.mockReturnValueOnce(chainProxy([postRow]));
    // getPostCounts: 3 count queries
    selectFn.mockReturnValueOnce(chainProxy([{ count: 0 }]));
    selectFn.mockReturnValueOnce(chainProxy([{ count: 0 }]));
    selectFn.mockReturnValueOnce(chainProxy([{ count: 0 }]));
    // hasUserReacted
    selectFn.mockReturnValueOnce(chainProxy([]));

    const result = await getPost(post.id, currentUserId);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(post.id);
  });
});

describe("Block enforcement — addReaction", () => {
  const userId = randomUUID();
  const blockedAuthorId = randomUUID();

  beforeEach(() => {
    vi.clearAllMocks();
    cachedOverrides.clear();
  });

  it("should return null when reacting to post by blocked user", async () => {
    const post = makePost({ authorId: blockedAuthorId });
    findFirstFn.mockResolvedValueOnce(post);
    setBlockedIds(userId, [blockedAuthorId]);

    const result = await addReaction(post.id, userId);
    expect(result).toBeNull();
    expect(insertFn).not.toHaveBeenCalled();
  });
});

describe("Block enforcement — resharePost", () => {
  const userId = randomUUID();
  const blockedAuthorId = randomUUID();

  beforeEach(() => {
    vi.clearAllMocks();
    cachedOverrides.clear();
  });

  it("should return null when resharing post by blocked user", async () => {
    const original = makePost({ authorId: blockedAuthorId });
    findFirstFn.mockResolvedValueOnce(original);
    setBlockedIds(userId, [blockedAuthorId]);

    const result = await resharePost(userId, original.id);
    expect(result).toBeNull();
    expect(insertFn).not.toHaveBeenCalled();
  });
});

describe("Block enforcement — getStream", () => {
  const userId = randomUUID();
  const blockedUserId = randomUUID();
  const friendUserId = randomUUID();

  beforeEach(() => {
    vi.clearAllMocks();
    cachedOverrides.clear();
  });

  it("should exclude blocked user posts from home stream", async () => {
    setBlockedIds(userId, [blockedUserId]);

    // All db.select() calls return empty chains
    selectFn.mockReturnValue(chainProxy([]));

    const result = await getStream(userId);
    expect(selectFn).toHaveBeenCalled();
    expect(result.items).toEqual([]);
  });
});

describe("Block enforcement — getHashtagStream", () => {
  const userId = randomUUID();

  beforeEach(() => {
    vi.clearAllMocks();
    cachedOverrides.clear();
  });

  it("should add notInArray condition when user has blocked users", async () => {
    const blockedId = randomUUID();
    setBlockedIds(userId, [blockedId]);

    // Hashtag stream query
    selectFn.mockReturnValueOnce(chainProxy([]));

    const result = await getHashtagStream("test", userId);
    expect(result.items).toEqual([]);
    expect(result.cursor).toBeNull();
  });
});

describe("Block enforcement — getComments", () => {
  const userId = randomUUID();
  const postId = randomUUID();

  beforeEach(() => {
    vi.clearAllMocks();
    cachedOverrides.clear();
  });

  it("should filter blocked users from comments", async () => {
    const blockedId = randomUUID();
    setBlockedIds(userId, [blockedId]);

    // Comments query
    selectFn.mockReturnValueOnce(chainProxy([]));

    const result = await getComments(postId, userId);
    expect(result.items).toEqual([]);
  });
});

describe("Block enforcement — getUserPosts", () => {
  const userId = randomUUID();

  beforeEach(() => {
    vi.clearAllMocks();
    cachedOverrides.clear();
  });

  it("should filter blocked users from user posts", async () => {
    const blockedId = randomUUID();
    setBlockedIds(userId, [blockedId]);

    // User posts query
    selectFn.mockReturnValueOnce(chainProxy([]));

    const result = await getUserPosts("someuser", userId);
    expect(result.items).toEqual([]);
  });
});
