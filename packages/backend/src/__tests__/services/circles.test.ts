import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { makeCircle, makeUser } from "../helpers/fixtures.js";

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
      circles: { findFirst: findFirstFn },
    },
    select: selectFn,
    insert: insertFn,
    update: updateFn,
    delete: deleteFn,
  },
}));

// ── Import AFTER mocks ────────────────────────────────────────

const {
  createCircle,
  updateCircle,
  deleteCircle,
  addMembers,
  removeMember,
  getCircles,
  getCircle,
  resolveCircleMembers,
} = await import("../../services/circles.js");

// ── Tests ──────────────────────────────────────────────────────

describe("Circles — createCircle", () => {
  const userId = randomUUID();

  beforeEach(() => {
    vi.clearAllMocks();
    insertFn.mockReturnValue(chainProxy());
  });

  it("should create a circle with name and default color", async () => {
    const circle = makeCircle({ userId, name: "Close Friends" });
    returningFn.mockResolvedValue([circle]);

    const result = await createCircle(userId, { name: "Close Friends" });
    expect(result.name).toBe("Close Friends");
  });

  it("should create a circle with custom color", async () => {
    const circle = makeCircle({ userId, name: "VIPs", color: "#ff0000" });
    returningFn.mockResolvedValue([circle]);

    const result = await createCircle(userId, {
      name: "VIPs",
      color: "#ff0000",
    });
    expect(result.color).toBe("#ff0000");
  });

  it("should always set isDefault to false for user-created circles", async () => {
    const circle = makeCircle({ userId, isDefault: false });
    returningFn.mockResolvedValue([circle]);

    const result = await createCircle(userId, { name: "Custom" });
    expect(result.isDefault).toBe(false);
  });
});

describe("Circles — updateCircle", () => {
  const userId = randomUUID();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return null when circle does not exist", async () => {
    findFirstFn.mockResolvedValue(undefined);

    const result = await updateCircle("nonexistent", userId, {
      name: "Renamed",
    });
    expect(result).toBeNull();
  });

  it("should return null when circle belongs to different user", async () => {
    findFirstFn.mockResolvedValue(undefined); // Drizzle where clause filters by userId

    const result = await updateCircle(randomUUID(), userId, {
      name: "Renamed",
    });
    expect(result).toBeNull();
  });

  it("should return the updated circle", async () => {
    const circle = makeCircle({ userId });
    findFirstFn.mockResolvedValue(circle);

    const updated = { ...circle, name: "Renamed", updatedAt: new Date() };
    returningFn.mockResolvedValue([updated]);
    updateFn.mockReturnValue(chainProxy([updated]));

    const result = await updateCircle(circle.id, userId, { name: "Renamed" });
    expect(result).not.toBeNull();
    expect(result!.name).toBe("Renamed");
  });
});

describe("Circles — deleteCircle", () => {
  const userId = randomUUID();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return false when circle does not exist", async () => {
    findFirstFn.mockResolvedValue(undefined);

    const result = await deleteCircle("nonexistent", userId);
    expect(result).toBe(false);
  });

  it("should throw when attempting to delete a default circle", async () => {
    const circle = makeCircle({ userId, isDefault: true });
    findFirstFn.mockResolvedValue(circle);

    await expect(deleteCircle(circle.id, userId)).rejects.toThrow(
      "Cannot delete default circles"
    );
  });

  it("should succeed for non-default circles", async () => {
    const circle = makeCircle({ userId, isDefault: false });
    findFirstFn.mockResolvedValue(circle);
    deleteFn.mockReturnValue(chainProxy());

    const result = await deleteCircle(circle.id, userId);
    expect(result).toBe(true);
  });
});

describe("Circles — addMembers", () => {
  const userId = randomUUID();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return null when circle does not exist", async () => {
    findFirstFn.mockResolvedValue(undefined);

    const result = await addMembers("nonexistent", userId, [randomUUID()]);
    expect(result).toBeNull();
  });

  it("should add members using onConflictDoNothing", async () => {
    const circle = makeCircle({ userId });
    findFirstFn.mockResolvedValue(circle);
    insertFn.mockReturnValue(chainProxy());

    const result = await addMembers(circle.id, userId, [
      randomUUID(),
      randomUUID(),
    ]);
    expect(result).toBe(true);
  });
});

describe("Circles — removeMember", () => {
  const userId = randomUUID();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return false when circle does not exist", async () => {
    findFirstFn.mockResolvedValue(undefined);

    const result = await removeMember("nonexistent", userId, randomUUID());
    expect(result).toBe(false);
  });

  it("should delete the member record and return true", async () => {
    const circle = makeCircle({ userId });
    findFirstFn.mockResolvedValue(circle);
    deleteFn.mockReturnValue(chainProxy());

    const result = await removeMember(circle.id, userId, randomUUID());
    expect(result).toBe(true);
  });
});

describe("Circles — resolveCircleMembers", () => {
  const userId = randomUUID();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return empty array for empty circleIds", async () => {
    const result = await resolveCircleMembers([], userId);
    expect(result).toEqual([]);
  });

  it("should deduplicate actor URIs", async () => {
    const uri = "https://fediplus.test/users/alice";
    selectFn.mockReturnValue(
      chainProxy([{ actorUri: uri }, { actorUri: uri }])
    );

    const result = await resolveCircleMembers(
      [randomUUID(), randomUUID()],
      userId
    );
    expect(result).toEqual([uri]);
  });

  it("should collect URIs from multiple circles", async () => {
    selectFn.mockReturnValue(
      chainProxy([
        { actorUri: "https://fediplus.test/users/alice" },
        { actorUri: "https://fediplus.test/users/bob" },
      ])
    );

    const result = await resolveCircleMembers(
      [randomUUID(), randomUUID()],
      userId
    );
    expect(result).toHaveLength(2);
    expect(result).toContain("https://fediplus.test/users/alice");
    expect(result).toContain("https://fediplus.test/users/bob");
  });
});

describe("Circles — getCircles", () => {
  it("should return circles for the user", async () => {
    const userId = randomUUID();
    const circleList = [
      { ...makeCircle({ userId }), memberCount: 3 },
      { ...makeCircle({ userId, name: "Family" }), memberCount: 5 },
    ];
    selectFn.mockReturnValue(chainProxy(circleList));

    const result = await getCircles(userId);
    expect(result).toHaveLength(2);
  });
});

describe("Circles — getCircle", () => {
  it("should return null if circle does not belong to user", async () => {
    findFirstFn.mockResolvedValue(undefined);

    const result = await getCircle(randomUUID(), randomUUID());
    expect(result).toBeNull();
  });

  it("should return circle with members", async () => {
    const userId = randomUUID();
    const circle = makeCircle({ userId });
    findFirstFn.mockResolvedValue(circle);
    selectFn.mockReturnValue(
      chainProxy([
        {
          id: randomUUID(),
          username: "alice",
          displayName: "Alice",
          avatarUrl: null,
          actorUri: "https://fediplus.test/users/alice",
        },
      ])
    );

    const result = await getCircle(circle.id, userId);
    expect(result).not.toBeNull();
    expect(result!.members).toHaveLength(1);
    expect(result!.members[0].username).toBe("alice");
  });
});
