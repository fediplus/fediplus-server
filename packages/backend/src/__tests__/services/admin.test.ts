import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { makeUser, makePost } from "../helpers/fixtures.js";

// ── Mocks ──────────────────────────────────────────────────────

const returningFn = vi.fn();
const selectFn = vi.fn();
const insertFn = vi.fn();
const updateFn = vi.fn();
const deleteFn = vi.fn();

/** Chain proxy that resolves with given data when awaited */
function resolving(data: unknown) {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === "returning") return returningFn;
        if (prop === "then")
          return (r: (v: unknown) => void) => r(data);
        return vi.fn(() => proxy);
      },
    }
  );
  return proxy;
}

/** Default chain proxy — resolves to undefined */
function chain() {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === "returning") return returningFn;
        if (prop === "then")
          return (r: (v: unknown) => void) => r(undefined);
        return vi.fn(() => chain());
      },
    }
  );
  return proxy;
}

vi.mock("../../db/connection.js", () => ({
  db: {
    query: { users: { findFirst: vi.fn() } },
    select: (...args: unknown[]) => {
      const r = selectFn(...args);
      return r ?? chain();
    },
    insert: (...args: unknown[]) => {
      insertFn(...args);
      return chain();
    },
    update: (...args: unknown[]) => {
      updateFn(...args);
      return chain();
    },
    delete: (...args: unknown[]) => {
      deleteFn(...args);
      return chain();
    },
  },
}));

vi.mock("../../config.js", () => ({
  config: {
    publicUrl: "https://fediplus.test",
    jwt: { secret: "test-secret-key-for-vitest", expiry: "7d" },
    domain: "fediplus.test",
  },
}));

// ── Import services AFTER mocks ────────────────────────────────

const {
  createReport,
  getReport,
  listReports,
  suspendUser,
  unsuspendUser,
  silenceUser,
  unsilenceUser,
  disableUser,
  enableUser,
  updateUserRole,
  updateUserPermissions,
  updateAdminNote,
  sensitizeUser,
  issueWarning,
  getWarnings,
  deletePostByAdmin,
  markPostSensitive,
  createDomainBlock,
  removeDomainBlock,
  listDomainBlocks,
  createIpBlock,
  removeIpBlock,
  getSetting,
  getPublicSettings,
  upsertSetting,
  adminSearchUsers,
  adminGetUser,
  getDashboardMetrics,
  createAuditLog,
  getAuditLogs,
} = await import("../../services/admin.js");

// ── Tests ───────────────────────────────────────────────────────

const modId = randomUUID();
const reporterId = randomUUID();
const targetUserId = randomUUID();
const reportId = randomUUID();
const postId = randomUUID();

describe("Admin Service — Reports", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should create a report for a user target", async () => {
    const newReport = {
      id: reportId,
      reporterId,
      targetType: "user" as const,
      targetId: targetUserId,
      targetAccountId: targetUserId,
      type: "spam" as const,
      comment: "Spammy user",
      status: "open" as const,
      assignedModId: null,
      resolvedAt: null,
      resolvedById: null,
      resolutionNote: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    returningFn.mockResolvedValueOnce([newReport]);

    const result = await createReport(reporterId, {
      targetType: "user",
      targetId: targetUserId,
      type: "spam",
      comment: "Spammy user",
    });

    expect(result).toBeDefined();
    expect(result.reporterId).toBe(reporterId);
    expect(insertFn).toHaveBeenCalled();
  });

  it("should create a report for a post target", async () => {
    const authorId = randomUUID();
    selectFn.mockReturnValueOnce(resolving([{ authorId }]));
    const newReport = {
      id: randomUUID(),
      reporterId,
      targetType: "post" as const,
      targetId: postId,
      targetAccountId: authorId,
      type: "harassment" as const,
      comment: "",
      status: "open" as const,
      assignedModId: null,
      resolvedAt: null,
      resolvedById: null,
      resolutionNote: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    returningFn.mockResolvedValueOnce([newReport]);

    const result = await createReport(reporterId, {
      targetType: "post",
      targetId: postId,
      type: "harassment",
    });

    expect(result).toBeDefined();
  });

  it("should get a specific report by id", async () => {
    const report = {
      id: reportId,
      reporterId,
      targetType: "user" as const,
      targetId: targetUserId,
      status: "open" as const,
      createdAt: new Date(),
    };
    selectFn.mockReturnValueOnce(resolving([report]));

    const result = await getReport(reportId);
    expect(result).toBeDefined();
  });

  it("should return null for non-existent report", async () => {
    selectFn.mockReturnValueOnce(resolving([]));

    const result = await getReport(randomUUID());
    expect(result).toBeNull();
  });

  it("should list reports with status filter", async () => {
    const items = [
      { id: randomUUID(), status: "open", createdAt: new Date() },
    ];
    selectFn.mockReturnValueOnce(resolving(items));

    const result = await listReports({ status: "open" });
    expect(result).toHaveProperty("items");
    expect(result).toHaveProperty("nextCursor");
  });
});

describe("Admin Service — User Moderation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should suspend a user", async () => {
    const user = makeUser({ id: targetUserId, status: "suspended" });
    returningFn.mockResolvedValueOnce([user]);
    returningFn.mockResolvedValueOnce([{ id: randomUUID() }]);

    const result = await suspendUser(targetUserId, modId, "Violation");
    expect(result.status).toBe("suspended");
  });

  it("should unsuspend a user", async () => {
    const user = makeUser({ id: targetUserId, status: "active" });
    returningFn.mockResolvedValueOnce([user]);
    returningFn.mockResolvedValueOnce([{ id: randomUUID() }]);

    const result = await unsuspendUser(targetUserId, modId);
    expect(result.status).toBe("active");
  });

  it("should silence a user", async () => {
    const user = makeUser({ id: targetUserId, silenced: true });
    returningFn.mockResolvedValueOnce([user]);
    returningFn.mockResolvedValueOnce([{ id: randomUUID() }]);

    const result = await silenceUser(targetUserId, modId);
    expect(result.silenced).toBe(true);
  });

  it("should unsilence a user", async () => {
    const user = makeUser({ id: targetUserId, silenced: false });
    returningFn.mockResolvedValueOnce([user]);
    returningFn.mockResolvedValueOnce([{ id: randomUUID() }]);

    const result = await unsilenceUser(targetUserId, modId);
    expect(result.silenced).toBe(false);
  });

  it("should disable a user", async () => {
    const user = makeUser({ id: targetUserId, status: "disabled" });
    returningFn.mockResolvedValueOnce([user]);
    returningFn.mockResolvedValueOnce([{ id: randomUUID() }]);

    const result = await disableUser(targetUserId, modId);
    expect(result.status).toBe("disabled");
  });

  it("should enable a user", async () => {
    const user = makeUser({ id: targetUserId, status: "active" });
    returningFn.mockResolvedValueOnce([user]);
    returningFn.mockResolvedValueOnce([{ id: randomUUID() }]);

    const result = await enableUser(targetUserId, modId);
    expect(result.status).toBe("active");
  });

  it("should update user role", async () => {
    selectFn.mockReturnValueOnce(resolving([{ role: "user" }]));
    returningFn.mockResolvedValueOnce([makeUser({ role: "moderator" })]);
    returningFn.mockResolvedValueOnce([{ id: randomUUID() }]);

    const result = await updateUserRole(targetUserId, modId, "moderator");
    expect(result.role).toBe("moderator");
  });

  it("should update user permissions", async () => {
    const existingPerms = {
      can_post: true,
      can_comment: true,
      can_follow: true,
      can_react: true,
      can_upload: true,
      can_message: true,
      can_report: true,
      can_create_communities: true,
    };
    selectFn.mockReturnValueOnce(resolving([{ permissions: existingPerms }]));

    const updated = makeUser({
      permissions: { ...existingPerms, can_post: false },
    });
    returningFn.mockResolvedValueOnce([updated]);
    returningFn.mockResolvedValueOnce([{ id: randomUUID() }]);

    const result = await updateUserPermissions(targetUserId, modId, {
      can_post: false,
    });
    expect((result.permissions as Record<string, boolean>).can_post).toBe(
      false
    );
  });

  it("should update admin note", async () => {
    const user = makeUser({ adminNote: "Troublemaker" });
    returningFn.mockResolvedValueOnce([user]);
    returningFn.mockResolvedValueOnce([{ id: randomUUID() }]);

    const result = await updateAdminNote(targetUserId, modId, "Troublemaker");
    expect(result.adminNote).toBe("Troublemaker");
  });

  it("should sensitize a user", async () => {
    const user = makeUser({ sensitized: true });
    returningFn.mockResolvedValueOnce([user]);
    returningFn.mockResolvedValueOnce([{ id: randomUUID() }]);

    const result = await sensitizeUser(targetUserId, modId, true);
    expect(result.sensitized).toBe(true);
  });
});

describe("Admin Service — Warnings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should issue a warning", async () => {
    const warning = {
      id: randomUUID(),
      targetAccountId: targetUserId,
      action: "warn" as const,
      text: "Cut it out",
      reportId: null,
      createdByModId: modId,
      createdAt: new Date(),
    };
    returningFn.mockResolvedValueOnce([warning]);
    returningFn.mockResolvedValueOnce([{ id: randomUUID() }]);

    const result = await issueWarning(
      targetUserId,
      modId,
      "warn",
      "Cut it out"
    );
    expect(result.action).toBe("warn");
    expect(result.text).toBe("Cut it out");
  });

  it("should get warnings for a user", async () => {
    selectFn.mockReturnValueOnce(
      resolving([{ id: randomUUID(), action: "warn" }])
    );

    const result = await getWarnings(targetUserId);
    expect(result).toBeDefined();
  });
});

describe("Admin Service — Content Moderation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should delete a post by admin", async () => {
    const post = makePost({ id: postId });
    selectFn.mockReturnValueOnce(resolving([post]));
    returningFn.mockResolvedValueOnce([{ id: randomUUID() }]);

    await deletePostByAdmin(postId, modId);
    expect(deleteFn).toHaveBeenCalled();
  });

  it("should throw on deleting non-existent post", async () => {
    selectFn.mockReturnValueOnce(resolving([]));

    await expect(deletePostByAdmin(randomUUID(), modId)).rejects.toThrow(
      "Post not found"
    );
  });

  it("should mark a post as sensitive", async () => {
    const post = makePost({ sensitive: true });
    returningFn.mockResolvedValueOnce([post]);
    returningFn.mockResolvedValueOnce([{ id: randomUUID() }]);

    const result = await markPostSensitive(postId, modId);
    expect(result.sensitive).toBe(true);
  });
});

describe("Admin Service — Domain Blocks", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should create a domain block", async () => {
    const block = {
      id: randomUUID(),
      domain: "evil.example",
      severity: "suspend" as const,
      publicComment: null,
      privateComment: null,
      rejectMedia: false,
      rejectReports: false,
      obfuscate: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    returningFn.mockResolvedValueOnce([block]);
    returningFn.mockResolvedValueOnce([{ id: randomUUID() }]);

    const result = await createDomainBlock(modId, {
      domain: "evil.example",
      severity: "suspend",
    });
    expect(result.domain).toBe("evil.example");
    expect(result.severity).toBe("suspend");
  });

  it("should remove a domain block", async () => {
    selectFn.mockReturnValueOnce(resolving([{ domain: "evil.example" }]));
    returningFn.mockResolvedValueOnce([{ id: randomUUID() }]);

    await removeDomainBlock(randomUUID(), modId);
    expect(deleteFn).toHaveBeenCalled();
  });

  it("should throw when removing non-existent domain block", async () => {
    selectFn.mockReturnValueOnce(resolving([]));

    await expect(removeDomainBlock(randomUUID(), modId)).rejects.toThrow(
      "Domain block not found"
    );
  });

  it("should list domain blocks", async () => {
    selectFn.mockReturnValueOnce(
      resolving([
        { id: randomUUID(), domain: "spam.test", createdAt: new Date() },
      ])
    );

    const result = await listDomainBlocks({});
    expect(result).toHaveProperty("items");
  });
});

describe("Admin Service — IP Blocks", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should create an IP block", async () => {
    const block = {
      id: randomUUID(),
      ip: "192.168.1.0/24",
      severity: "sign_up_block" as const,
      comment: null,
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    returningFn.mockResolvedValueOnce([block]);
    returningFn.mockResolvedValueOnce([{ id: randomUUID() }]);

    const result = await createIpBlock(modId, {
      ip: "192.168.1.0/24",
      severity: "sign_up_block",
    });
    expect(result.ip).toBe("192.168.1.0/24");
  });

  it("should remove an IP block", async () => {
    selectFn.mockReturnValueOnce(resolving([{ ip: "192.168.1.0/24" }]));
    returningFn.mockResolvedValueOnce([{ id: randomUUID() }]);

    await removeIpBlock(randomUUID(), modId);
    expect(deleteFn).toHaveBeenCalled();
  });
});

describe("Admin Service — Settings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should get a setting by key", async () => {
    selectFn.mockReturnValueOnce(
      resolving([{ key: "instance.name", value: "Fedi+" }])
    );

    const result = await getSetting("instance.name");
    expect(result).toBeDefined();
    expect(result!.key).toBe("instance.name");
  });

  it("should return null for non-existent setting", async () => {
    selectFn.mockReturnValueOnce(resolving([]));

    const result = await getSetting("nonexistent");
    expect(result).toBeNull();
  });

  it("should get all public settings", async () => {
    selectFn.mockReturnValueOnce(
      resolving([{ key: "instance.name", isPublic: true }])
    );

    const result = await getPublicSettings();
    expect(result).toBeDefined();
  });

  it("should create a new setting when key does not exist", async () => {
    selectFn.mockReturnValueOnce(resolving([]));
    const setting = {
      id: randomUUID(),
      key: "new.setting",
      value: "hello",
      type: "string",
      isPublic: false,
    };
    returningFn.mockResolvedValueOnce([setting]);
    returningFn.mockResolvedValueOnce([{ id: randomUUID() }]);

    const result = await upsertSetting(modId, "new.setting", "hello");
    expect(result.key).toBe("new.setting");
  });
});

describe("Admin Service — Audit Log", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should create an audit log entry", async () => {
    const entry = {
      id: randomUUID(),
      actorId: modId,
      action: "suspend" as const,
      targetType: "user",
      targetId: targetUserId,
      metadata: {},
      createdAt: new Date(),
    };
    returningFn.mockResolvedValueOnce([entry]);

    const result = await createAuditLog(
      modId,
      "suspend",
      "user",
      targetUserId
    );
    expect(result.action).toBe("suspend");
  });

  it("should list audit logs", async () => {
    selectFn.mockReturnValueOnce(
      resolving([
        { id: randomUUID(), action: "suspend", createdAt: new Date() },
      ])
    );

    const result = await getAuditLogs({});
    expect(result).toHaveProperty("items");
  });
});

describe("Admin Service — User Search", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should search users with query", async () => {
    const user = makeUser();
    selectFn.mockReturnValueOnce(
      resolving([{ ...user, displayName: "Alice", avatarUrl: null }])
    );

    const result = await adminSearchUsers({ q: "alice" });
    expect(result).toHaveProperty("items");
  });

  it("should filter users by role", async () => {
    selectFn.mockReturnValueOnce(resolving([]));

    const result = await adminSearchUsers({ role: "admin" });
    expect(result.items).toEqual([]);
  });

  it("should get admin user detail", async () => {
    const user = makeUser();
    selectFn.mockReturnValueOnce(
      resolving([
        {
          ...user,
          displayName: "Alice",
          bio: "",
          avatarUrl: null,
          coverUrl: null,
        },
      ])
    );

    const result = await adminGetUser(user.id);
    expect(result).toBeDefined();
    expect(result!.id).toBe(user.id);
  });

  it("should return null for non-existent admin user", async () => {
    selectFn.mockReturnValueOnce(resolving([]));

    const result = await adminGetUser(randomUUID());
    expect(result).toBeNull();
  });
});

describe("Admin Service — Dashboard Metrics", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should return dashboard metrics", async () => {
    selectFn
      .mockReturnValueOnce(
        resolving([
          {
            total: 100,
            active: 80,
            suspended: 5,
            newToday: 3,
            newThisWeek: 10,
          },
        ])
      )
      .mockReturnValueOnce(resolving([{ total: 500 }]))
      .mockReturnValueOnce(
        resolving([{ total: 20, pending: 5, resolved: 15 }])
      )
      .mockReturnValueOnce(resolving([{ total: 3 }]));

    const result = await getDashboardMetrics();
    expect(result.totalUsers).toBe(100);
    expect(result.activeUsers).toBe(80);
    expect(result.totalPosts).toBe(500);
    expect(result.pendingReports).toBe(5);
    expect(result.blockedDomains).toBe(3);
  });
});
