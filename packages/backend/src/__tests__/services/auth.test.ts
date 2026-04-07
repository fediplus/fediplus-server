import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { makeUser } from "../helpers/fixtures.js";

// ── Mocks ──────────────────────────────────────────────────────

// Mock db module — must be before service import
const findFirstFn = vi.fn();
const returningFn = vi.fn();
const chainProxy = () =>
  new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === "returning") return returningFn;
        if (prop === "then")
          return (r: (v: unknown) => void) => r(undefined);
        return vi.fn(() => chainProxy());
      },
    }
  );

vi.mock("../../db/connection.js", () => ({
  db: {
    query: {
      users: { findFirst: findFirstFn },
      emailTokens: { findFirst: findFirstFn },
    },
    select: vi.fn(() => chainProxy()),
    insert: vi.fn(() => chainProxy()),
    update: vi.fn(() => chainProxy()),
    delete: vi.fn(() => chainProxy()),
  },
}));

vi.mock("../../services/email.js", () => ({
  sendVerificationEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));

vi.mock("../../config.js", () => ({
  config: {
    publicUrl: "https://fediplus.test",
    jwt: { secret: "test-secret-key-for-vitest", expiry: "7d" },
    domain: "fediplus.test",
  },
}));

vi.mock("@fediplus/shared", () => ({
  DEFAULT_CIRCLES_PERSON: [
    { name: "Friends", color: "#4285f4" },
    { name: "Family", color: "#0f9d58" },
    { name: "Acquaintances", color: "#f4b400" },
    { name: "Following", color: "#db4437" },
  ],
  DEFAULT_CIRCLES_BUSINESS: [
    { name: "Following", color: "#db4437" },
    { name: "Customers", color: "#4285f4" },
    { name: "VIPs", color: "#f4b400" },
    { name: "Team Members", color: "#0f9d58" },
  ],
}));

// Mock bcrypt
vi.mock("bcrypt", () => ({
  default: {
    hash: vi.fn(async () => "$2b$12$mockedhash"),
    compare: vi.fn(async (_plain: string, _hash: string) => true),
  },
}));

// Mock crypto.generateKeyPairSync to avoid slow RSA generation in tests
vi.mock("node:crypto", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    generateKeyPairSync: vi.fn(() => ({
      publicKey: "-----BEGIN PUBLIC KEY-----\nTEST\n-----END PUBLIC KEY-----",
      privateKey:
        "-----BEGIN PRIVATE KEY-----\nTEST\n-----END PRIVATE KEY-----",
    })),
  };
});

// ── Import services AFTER mocks ────────────────────────────────

const { registerUser, loginUser, verifyEmail, resetPassword, requestPasswordReset } =
  await import("../../services/auth.js");
const { generateToken, authMiddleware } = await import(
  "../../middleware/auth.js"
);
const bcrypt = (await import("bcrypt")).default;

// ── Tests ───────────────────────────────────────────────────────

describe("Auth — generateToken / verify round-trip", () => {
  it("should produce a valid JWT that decodes to the original payload", async () => {
    const jwt = await import("jsonwebtoken");
    const payload = { userId: randomUUID(), username: "alice" };

    const token = generateToken(payload);
    expect(token).toBeTypeOf("string");

    const decoded = jwt.default.verify(token, "test-secret-key-for-vitest") as Record<string, unknown>;
    expect(decoded.userId).toBe(payload.userId);
    expect(decoded.username).toBe(payload.username);
  });

  it("should reject an expired token", async () => {
    const jwt = await import("jsonwebtoken");
    const token = jwt.default.sign(
      { userId: "x", username: "x" },
      "test-secret-key-for-vitest",
      { expiresIn: "0s" }
    );

    expect(() => jwt.default.verify(token, "test-secret-key-for-vitest")).toThrow();
  });
});

describe("Auth — authMiddleware", () => {
  function mockReqReply(authHeader?: string) {
    const request = { headers: { authorization: authHeader } } as any;
    const reply = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    } as any;
    return { request, reply };
  }

  it("should reject requests without Authorization header", async () => {
    const { request, reply } = mockReqReply();
    await authMiddleware(request, reply);
    expect(reply.status).toHaveBeenCalledWith(401);
  });

  it("should reject non-Bearer tokens", async () => {
    const { request, reply } = mockReqReply("Basic abc123");
    await authMiddleware(request, reply);
    expect(reply.status).toHaveBeenCalledWith(401);
  });

  it("should reject invalid JWT", async () => {
    const { request, reply } = mockReqReply("Bearer invalid.token.here");
    await authMiddleware(request, reply);
    expect(reply.status).toHaveBeenCalledWith(401);
  });

  it("should set request.user for a valid token", async () => {
    const payload = { userId: randomUUID(), username: "bob" };
    const token = generateToken(payload);
    const { request, reply } = mockReqReply(`Bearer ${token}`);

    await authMiddleware(request, reply);

    expect(request.user).toBeDefined();
    expect(request.user.userId).toBe(payload.userId);
    expect(request.user.username).toBe(payload.username);
  });
});

describe("Auth — registerUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no existing user
    findFirstFn.mockResolvedValue(undefined);
    returningFn.mockResolvedValue([makeUser()]);
  });

  it("should hash the password with bcrypt", async () => {
    await registerUser({
      username: "newuser",
      email: "new@example.com",
      password: "secureP@ss1",
    });

    expect(bcrypt.hash).toHaveBeenCalledWith("secureP@ss1", 12);
  });

  it("should reject duplicate username", async () => {
    findFirstFn.mockResolvedValueOnce(makeUser({ username: "taken" }));

    await expect(
      registerUser({
        username: "taken",
        email: "fresh@example.com",
        password: "secureP@ss1",
      })
    ).rejects.toThrow("Username already taken");
  });

  it("should reject duplicate email", async () => {
    findFirstFn
      .mockResolvedValueOnce(undefined) // username check passes
      .mockResolvedValueOnce(makeUser({ email: "dup@example.com" })); // email check fails

    await expect(
      registerUser({
        username: "unique",
        email: "dup@example.com",
        password: "secureP@ss1",
      })
    ).rejects.toThrow("Email already registered");
  });

  it("should return a verification message on success", async () => {
    const result = await registerUser({
      username: "alice",
      email: "alice@example.com",
      password: "secureP@ss1",
    });

    expect(result.message).toContain("verify");
  });
});

describe("Auth — loginUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return a token for valid credentials", async () => {
    const user = makeUser({ emailVerified: true });
    findFirstFn.mockResolvedValue(user);
    (bcrypt.compare as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const result = await loginUser({
      email: user.email as string,
      password: "correct",
    });

    expect(result.token).toBeTypeOf("string");
    expect(result.user.id).toBe(user.id);
  });

  it("should reject wrong password", async () => {
    findFirstFn.mockResolvedValue(makeUser());
    (bcrypt.compare as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    await expect(
      loginUser({ email: "a@b.com", password: "wrong" })
    ).rejects.toThrow("Invalid email or password");
  });

  it("should reject non-existent email", async () => {
    findFirstFn.mockResolvedValue(undefined);

    await expect(
      loginUser({ email: "ghost@b.com", password: "any" })
    ).rejects.toThrow("Invalid email or password");
  });

  it("should reject unverified email", async () => {
    findFirstFn.mockResolvedValue(makeUser({ emailVerified: false }));
    (bcrypt.compare as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    await expect(
      loginUser({ email: "a@b.com", password: "correct" })
    ).rejects.toThrow("verify your email");
  });
});

describe("Auth — verifyEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should verify email when token is valid", async () => {
    findFirstFn.mockResolvedValue({
      id: randomUUID(),
      userId: randomUUID(),
      tokenHash: "somehash",
      type: "verification",
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await verifyEmail("valid-token");
    expect(result.message).toContain("verified");
  });

  it("should reject expired token", async () => {
    findFirstFn.mockResolvedValue({
      id: randomUUID(),
      userId: randomUUID(),
      tokenHash: "somehash",
      type: "verification",
      expiresAt: new Date(Date.now() - 60_000), // expired
    });

    await expect(verifyEmail("expired")).rejects.toThrow(
      "Invalid or expired"
    );
  });

  it("should reject unknown token", async () => {
    findFirstFn.mockResolvedValue(undefined);
    await expect(verifyEmail("bogus")).rejects.toThrow(
      "Invalid or expired"
    );
  });
});

describe("Auth — requestPasswordReset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return a generic message even when email does not exist", async () => {
    findFirstFn.mockResolvedValue(undefined);

    const result = await requestPasswordReset("nobody@example.com");
    expect(result.message).toContain("If an account exists");
  });

  it("should return the same message for existing email", async () => {
    findFirstFn.mockResolvedValue(makeUser());

    const result = await requestPasswordReset("user@example.com");
    expect(result.message).toContain("If an account exists");
  });
});

describe("Auth — resetPassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should reset password with valid token", async () => {
    findFirstFn.mockResolvedValue({
      id: randomUUID(),
      userId: randomUUID(),
      tokenHash: "somehash",
      type: "reset",
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await resetPassword("valid-token", "newSecureP@ss1");
    expect(result.message).toContain("reset successfully");
  });

  it("should reject expired reset token", async () => {
    findFirstFn.mockResolvedValue({
      id: randomUUID(),
      userId: randomUUID(),
      tokenHash: "somehash",
      type: "reset",
      expiresAt: new Date(Date.now() - 60_000),
    });

    await expect(
      resetPassword("expired", "newP@ss1")
    ).rejects.toThrow("Invalid or expired");
  });
});
