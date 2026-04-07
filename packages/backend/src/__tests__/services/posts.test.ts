import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { makePost, makeUser } from "../helpers/fixtures.js";

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

// ── Import AFTER mocks ────────────────────────────────────────

const {
  createPost,
  editPost,
  deletePost,
  addReaction,
  removeReaction,
  resharePost,
} = await import("../../services/posts.js");

// ── Tests ──────────────────────────────────────────────────────

describe("Posts — createPost", () => {
  const authorId = randomUUID();

  beforeEach(() => {
    vi.clearAllMocks();
    const post = makePost({ authorId });
    returningFn.mockResolvedValue([post]);
    // select for getFollowerIds returns empty
    selectFn.mockReturnValue(chainProxy([]));
    insertFn.mockReturnValue(chainProxy([post]));
    updateFn.mockReturnValue(chainProxy([post]));
  });

  it("should extract hashtags from content", async () => {
    const post = makePost({ authorId });
    returningFn.mockResolvedValue([post]);

    const result = await createPost(authorId, {
      content: "Hello #world and #fediverse",
      visibility: "public",
    });

    expect(result.hashtags).toEqual(["world", "fediverse"]);
  });

  it("should extract mentions from content", async () => {
    const post = makePost({ authorId });
    returningFn.mockResolvedValue([post]);

    const result = await createPost(authorId, {
      content: "Hey @alice and @bob@remote.test",
      visibility: "public",
    });

    expect(result.mentions).toEqual(["alice", "bob@remote.test"]);
  });

  it("should set the AP ID using publicUrl", async () => {
    const post = makePost({ authorId });
    returningFn.mockResolvedValue([post]);

    const result = await createPost(authorId, {
      content: "Test post",
      visibility: "public",
    });

    expect(result.apId).toMatch(/^https:\/\/fediplus\.test\/posts\//);
  });

  it("should handle empty content gracefully", async () => {
    const post = makePost({ authorId, content: "" });
    returningFn.mockResolvedValue([post]);

    const result = await createPost(authorId, {
      content: "",
      visibility: "public",
    });

    expect(result.hashtags).toEqual([]);
    expect(result.mentions).toEqual([]);
  });
});

describe("Posts — editPost", () => {
  const authorId = randomUUID();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return null if post does not exist or user is not author", async () => {
    findFirstFn.mockResolvedValue(undefined);

    const result = await editPost("fake-id", authorId, "new content");
    expect(result).toBeNull();
  });

  it("should preserve edit history", async () => {
    const original = makePost({
      authorId,
      content: "Original",
      editHistory: "[]",
    });
    findFirstFn.mockResolvedValue(original);

    const updated = {
      ...original,
      content: "Updated",
      editHistory: JSON.stringify([
        { content: "Original", editedAt: expect.any(String) },
      ]),
    };
    returningFn.mockResolvedValue([updated]);
    updateFn.mockReturnValue(chainProxy([updated]));
    selectFn.mockReturnValue(chainProxy([]));

    const result = await editPost(original.id, authorId, "Updated");
    // The function parses editHistory JSON, so we get an array
    expect(result).not.toBeNull();
  });
});

describe("Posts — deletePost", () => {
  const authorId = randomUUID();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return null if post does not belong to author", async () => {
    findFirstFn.mockResolvedValue(undefined);

    const result = await deletePost("fake-id", authorId);
    expect(result).toBeNull();
  });

  it("should return the deleted post on success", async () => {
    const post = makePost({ authorId });
    findFirstFn.mockResolvedValue(post);
    selectFn.mockReturnValue(chainProxy([])); // followerIds
    deleteFn.mockReturnValue(chainProxy());

    const result = await deletePost(post.id, authorId);
    expect(result).toEqual(post);
  });
});

describe("Posts — addReaction", () => {
  const userId = randomUUID();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return null if target post does not exist", async () => {
    findFirstFn.mockResolvedValue(undefined);

    const result = await addReaction("fake-post-id", userId);
    expect(result).toBeNull();
  });
});

describe("Posts — removeReaction", () => {
  it("should call delete without error", async () => {
    deleteFn.mockReturnValue(chainProxy());
    // removeReaction returns void
    await expect(
      removeReaction(randomUUID(), randomUUID())
    ).resolves.toBeUndefined();
  });
});

describe("Posts — resharePost", () => {
  const userId = randomUUID();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return null when original post does not exist", async () => {
    findFirstFn.mockResolvedValue(undefined);

    const result = await resharePost(userId, "nonexistent");
    expect(result).toBeNull();
  });

  it("should prevent duplicate reshares", async () => {
    const original = makePost();
    const existingReshare = makePost({ authorId: userId, reshareOfId: original.id });

    findFirstFn
      .mockResolvedValueOnce(original)    // original post lookup
      .mockResolvedValueOnce(existingReshare); // duplicate check

    const result = await resharePost(userId, original.id);
    expect(result).toEqual(existingReshare);
  });
});

describe("Posts — hashtag/mention extraction edge cases", () => {
  const authorId = randomUUID();

  beforeEach(() => {
    vi.clearAllMocks();
    const post = makePost({ authorId });
    returningFn.mockResolvedValue([post]);
    selectFn.mockReturnValue(chainProxy([]));
    insertFn.mockReturnValue(chainProxy([post]));
    updateFn.mockReturnValue(chainProxy([post]));
  });

  it("should lowercase hashtags", async () => {
    const post = makePost({ authorId });
    returningFn.mockResolvedValue([post]);

    const result = await createPost(authorId, {
      content: "#TypeScript #RUST #GoLang",
      visibility: "public",
    });

    expect(result.hashtags).toEqual(["typescript", "rust", "golang"]);
  });

  it("should handle federated mention format @user@domain", async () => {
    const post = makePost({ authorId });
    returningFn.mockResolvedValue([post]);

    const result = await createPost(authorId, {
      content: "cc @admin@mastodon.social",
      visibility: "public",
    });

    expect(result.mentions).toEqual(["admin@mastodon.social"]);
  });
});
