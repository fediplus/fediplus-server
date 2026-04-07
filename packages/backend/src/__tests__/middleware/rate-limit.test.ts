import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────

const multiFn = {
  zremrangebyscore: vi.fn().mockReturnThis(),
  zadd: vi.fn().mockReturnThis(),
  zcard: vi.fn().mockReturnThis(),
  expire: vi.fn().mockReturnThis(),
  exec: vi.fn().mockResolvedValue([
    [null, 0], // zremrangebyscore
    [null, 1], // zadd
    [null, 1], // zcard — within limit
    [null, 1], // expire
  ]),
};

vi.mock("ioredis", () => ({
  default: vi.fn().mockImplementation(() => ({
    multi: vi.fn(() => multiFn),
  })),
}));

vi.mock("../../config.js", () => ({
  config: {
    publicUrl: "https://fediplus.test",
    jwt: { secret: "test-secret-key-for-vitest", expiry: "7d" },
    domain: "fediplus.test",
    redis: { url: "redis://localhost:6379" },
  },
}));

vi.mock("@fediplus/shared", () => ({
  RATE_LIMITS: {
    guest: { perMinute: 60, perHour: 700 },
    user: { perMinute: 120, perHour: 3000 },
    auth: { perMinute: 10, perHour: 50 },
    uploads: { perDay: 50 },
    reports: { perDay: 15, perMonth: 200 },
  },
}));

// ── Import AFTER mocks ──────────────────────────────────────────

const { rateLimitMiddleware } = await import(
  "../../middleware/rate-limit.js"
);

// ── Tests ───────────────────────────────────────────────────────

describe("Rate Limit Middleware", () => {
  let mockRequest: Record<string, unknown>;
  let mockReply: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    multiFn.exec.mockResolvedValue([
      [null, 0],
      [null, 1],
      [null, 1],
      [null, 1],
    ]);
    mockRequest = {
      ip: "127.0.0.1",
      user: undefined,
      headers: {},
      routeOptions: { url: "/api/v1/test" },
    };
    mockReply = {
      header: vi.fn(() => mockReply),
      status: vi.fn(() => mockReply),
      send: vi.fn(() => mockReply),
    };
  });

  it("should allow requests within the limit", async () => {
    const middleware = rateLimitMiddleware();
    await middleware(mockRequest as any, mockReply as any);

    expect(mockReply.status).not.toHaveBeenCalled();
  });

  it("should block requests exceeding the limit", async () => {
    multiFn.exec.mockResolvedValueOnce([
      [null, 0],
      [null, 1],
      [null, 999], // zcard well above limit
      [null, 1],
    ]);

    const middleware = rateLimitMiddleware({
      max: 10,
      windowMs: 60000,
      keyPrefix: "test",
    });
    await middleware(mockRequest as any, mockReply as any);

    expect(mockReply.status).toHaveBeenCalledWith(429);
    expect(mockReply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Too many requests" })
    );
  });

  it("should set rate limit headers", async () => {
    multiFn.exec.mockResolvedValueOnce([
      [null, 0],
      [null, 1],
      [null, 5],
      [null, 1],
    ]);

    const middleware = rateLimitMiddleware({
      max: 60,
      windowMs: 60000,
    });
    await middleware(mockRequest as any, mockReply as any);

    expect(mockReply.header).toHaveBeenCalledWith("X-RateLimit-Limit", 60);
    expect(mockReply.header).toHaveBeenCalledWith(
      "X-RateLimit-Remaining",
      55
    );
  });

  it("should use user ID as key when authenticated", async () => {
    (mockRequest as any).user = { userId: "user-123" };

    const middleware = rateLimitMiddleware();
    await middleware(mockRequest as any, mockReply as any);

    // Authenticated users use the higher user limit (120/min)
    expect(mockReply.status).not.toHaveBeenCalled();
  });

  it("should use X-Forwarded-For IP when present", async () => {
    (mockRequest as any).headers = {
      "x-forwarded-for": "10.0.0.1, 192.168.1.1",
    };

    const middleware = rateLimitMiddleware();
    await middleware(mockRequest as any, mockReply as any);

    expect(mockReply.status).not.toHaveBeenCalled();
  });

  it("should set Retry-After header on 429", async () => {
    multiFn.exec.mockResolvedValueOnce([
      [null, 0],
      [null, 1],
      [null, 200],
      [null, 1],
    ]);

    const middleware = rateLimitMiddleware({
      max: 10,
      windowMs: 60000,
    });
    await middleware(mockRequest as any, mockReply as any);

    expect(mockReply.header).toHaveBeenCalledWith("Retry-After", 60);
  });
});
