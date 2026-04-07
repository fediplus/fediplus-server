import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";

// ── Redis mock ─────────────────────────────────────────────────

const redisMock = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  scan: vi.fn(),
};

vi.mock("../../db/connection.js", () => ({
  db: {},
  redis: redisMock,
}));

// Import after mock
const { cached, invalidate, invalidatePattern, CacheKeys, CacheTTL } =
  await import("../../services/cache.js");

// ── Tests ──────────────────────────────────────────────────────

describe("Cache — cached()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return cached value on hit", async () => {
    redisMock.get.mockResolvedValue(JSON.stringify({ count: 42 }));

    const fetchFn = vi.fn();
    const result = await cached("test:key", 60, fetchFn);

    expect(result).toEqual({ count: 42 });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(redisMock.set).not.toHaveBeenCalled();
  });

  it("should call fetchFn and cache result on miss", async () => {
    redisMock.get.mockResolvedValue(null);
    redisMock.set.mockResolvedValue("OK");
    const data = { count: 7 };
    const fetchFn = vi.fn(async () => data);

    const result = await cached("test:key", 120, fetchFn);

    expect(result).toEqual(data);
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(redisMock.set).toHaveBeenCalledWith(
      "test:key",
      JSON.stringify(data),
      "EX",
      120
    );
  });
});

describe("Cache — invalidate()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should delete the given key", async () => {
    redisMock.del.mockResolvedValue(1);
    await invalidate("post:counts:abc");
    expect(redisMock.del).toHaveBeenCalledWith("post:counts:abc");
  });
});

describe("Cache — invalidatePattern()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should scan and delete matching keys", async () => {
    redisMock.scan
      .mockResolvedValueOnce(["5", ["post:counts:a", "post:counts:b"]])
      .mockResolvedValueOnce(["0", ["post:counts:c"]]);
    redisMock.del.mockResolvedValue(1);

    await invalidatePattern("post:counts:*");

    expect(redisMock.del).toHaveBeenCalledTimes(2);
    expect(redisMock.del).toHaveBeenCalledWith("post:counts:a", "post:counts:b");
    expect(redisMock.del).toHaveBeenCalledWith("post:counts:c");
  });

  it("should handle no matching keys gracefully", async () => {
    redisMock.scan.mockResolvedValue(["0", []]);
    await invalidatePattern("nonexistent:*");
    expect(redisMock.del).not.toHaveBeenCalled();
  });
});

describe("CacheKeys", () => {
  it("should generate correct key formats", () => {
    const id = randomUUID();
    expect(CacheKeys.postCounts(id)).toBe(`post:counts:${id}`);
    expect(CacheKeys.userProfile(id)).toBe(`user:profile:${id}`);
    expect(CacheKeys.followerIds(id)).toBe(`user:followers:${id}`);
    expect(CacheKeys.blockedIds(id)).toBe(`user:blocked:${id}`);
    expect(CacheKeys.unreadCount(id)).toBe(`notif:unread:${id}`);
  });
});

describe("CacheTTL", () => {
  it("should have reasonable TTL values", () => {
    expect(CacheTTL.postCounts).toBe(60);
    expect(CacheTTL.userProfile).toBe(300);
    expect(CacheTTL.followerIds).toBe(120);
    expect(CacheTTL.blockedIds).toBe(120);
    expect(CacheTTL.unreadCount).toBe(30);
  });
});
