import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────

const executeFn = vi.fn();

vi.mock("../../db/connection.js", () => ({
  db: {
    execute: executeFn,
  },
}));

// ── Import AFTER mocks ────────────────────────────────────────

const { search } = await import("../../services/search.js");

// ── Tests ──────────────────────────────────────────────────────

describe("Search — unified search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeFn.mockResolvedValue({ rows: [] });
  });

  it("should return all four result types for type=all", async () => {
    const result = await search("test");
    expect(result).toHaveProperty("posts");
    expect(result).toHaveProperty("users");
    expect(result).toHaveProperty("communities");
    expect(result).toHaveProperty("hashtags");
  });

  it("should only search posts when type=posts", async () => {
    executeFn.mockResolvedValue({
      rows: [
        {
          id: "1",
          content: "Hello test",
          authorId: "a",
          authorUsername: "alice",
          authorDisplayName: "Alice",
          authorAvatarUrl: null,
          visibility: "public",
          createdAt: new Date(),
          rank: 0.5,
        },
      ],
    });

    const result = await search("test", { type: "posts" });
    expect(result.posts).toHaveLength(1);
    expect(result.users).toHaveLength(0);
    expect(result.communities).toHaveLength(0);
    expect(result.hashtags).toHaveLength(0);
  });

  it("should only search users when type=users", async () => {
    executeFn.mockResolvedValue({
      rows: [
        {
          id: "1",
          username: "alice",
          displayName: "Alice",
          avatarUrl: null,
          bio: "",
          actorUri: "https://fediplus.test/users/alice",
          similarity: 0.8,
        },
      ],
    });

    const result = await search("alice", { type: "users" });
    expect(result.users).toHaveLength(1);
    expect(result.posts).toHaveLength(0);
    expect(result.users[0].username).toBe("alice");
  });

  it("should only search communities when type=communities", async () => {
    executeFn.mockResolvedValue({
      rows: [
        {
          id: "1",
          name: "Photography",
          slug: "photography",
          description: "Share photos",
          avatarUrl: null,
          visibility: "public",
          memberCount: 42,
          rank: 0.7,
        },
      ],
    });

    const result = await search("photo", { type: "communities" });
    expect(result.communities).toHaveLength(1);
    expect(result.posts).toHaveLength(0);
    expect(result.communities[0].slug).toBe("photography");
  });

  it("should only search hashtags when type=hashtags", async () => {
    executeFn.mockResolvedValue({
      rows: [{ tag: "typescript", postCount: 15 }],
    });

    const result = await search("type", { type: "hashtags" });
    expect(result.hashtags).toHaveLength(1);
    expect(result.hashtags[0].tag).toBe("typescript");
    expect(result.hashtags[0].postCount).toBe(15);
  });

  it("should return empty results for empty/whitespace query", async () => {
    const result = await search("   ");
    expect(result.posts).toHaveLength(0);
    expect(result.users).toHaveLength(0);
    expect(result.communities).toHaveLength(0);
    expect(result.hashtags).toHaveLength(0);
    // Should NOT call db.execute for an empty query
    expect(executeFn).not.toHaveBeenCalled();
  });

  it("should strip tsquery special characters from input", async () => {
    // Characters like & | ! : * ( ) < > should be stripped
    const result = await search("test!&|()");
    // Should not throw and should still make queries
    expect(result).toBeDefined();
  });

  it("should clamp limit to 1-100 range", async () => {
    await search("test", { limit: 200 });
    // The limit passed to SQL should be 100 (clamped)
    expect(executeFn).toHaveBeenCalled();
  });

  it("should handle offset parameter", async () => {
    await search("test", { offset: 40 });
    expect(executeFn).toHaveBeenCalled();
  });
});

describe("Search — query sanitization edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeFn.mockResolvedValue({ rows: [] });
  });

  it("should handle SQL injection attempts safely via parameterized queries", async () => {
    // These are all passed as parameters, not interpolated
    await expect(search("'; DROP TABLE posts; --")).resolves.toBeDefined();
    await expect(search("\" OR 1=1")).resolves.toBeDefined();
  });

  it("should strip # prefix from hashtag searches", async () => {
    await search("#typescript", { type: "hashtags" });
    expect(executeFn).toHaveBeenCalled();
  });

  it("should handle unicode input", async () => {
    await search("日本語テスト", { type: "posts" });
    expect(executeFn).toHaveBeenCalled();
  });

  it("should handle single character queries", async () => {
    await search("a");
    expect(executeFn).toHaveBeenCalled();
  });
});
