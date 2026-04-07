import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { makeUser, makePost } from "../helpers/fixtures.js";

// ── Mocks ──────────────────────────────────────────────────────

const findFirstFn = vi.fn();
const selectFn = vi.fn();
const insertFn = vi.fn();
const updateFn = vi.fn();
const deleteFn = vi.fn();
const returningFn = vi.fn();

const sendActivityFn = vi.fn();
const mockCtx = { sendActivity: sendActivityFn };

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
      users: { findFirst: findFirstFn },
      posts: { findFirst: findFirstFn },
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

// Mock the federation singleton — we need to capture the activity objects
vi.mock("../../federation/outbox.js", async (importOriginal) => {
  // We'll re-export everything and patch getFederation via the module internals
  return importOriginal();
});

// ── Import federation classes for inspection ──────────────────

const fedify = await import("@fedify/fedify");

// ── Import service under test ─────────────────────────────────

// We can't easily mock getFederation() because it's a module-scoped closure.
// Instead, we test the activity construction by using setFederation + a mock.
const { setFederation, sendCreateNote, sendUpdateNote, sendDeleteNote, sendLike, sendUndoLike, sendFollow, sendAnnounce, sendBlock } =
  await import("../../federation/outbox.js");

// ── Helpers ────────────────────────────────────────────────────

function installMockFederation() {
  const mockFed = {
    createContext: vi.fn(() => mockCtx),
  } as any;
  setFederation(mockFed);
}

function makeLocalUser(overrides: Record<string, unknown> = {}) {
  return makeUser({ isLocal: true, ...overrides });
}

// ── Tests ──────────────────────────────────────────────────────

describe("Federation outbox — sendCreateNote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installMockFederation();
  });

  it("should not send if author is not a local user", async () => {
    findFirstFn.mockResolvedValue(undefined);

    await sendCreateNote("nonexistent", {
      id: randomUUID(),
      content: "test",
      apId: null,
      createdAt: new Date(),
    });

    expect(sendActivityFn).not.toHaveBeenCalled();
  });

  it("should construct a Create { Note } activity with correct fields", async () => {
    const user = makeLocalUser();
    findFirstFn.mockResolvedValue(user);

    const postId = randomUUID();
    const apId = `https://fediplus.test/posts/${postId}`;
    const createdAt = new Date("2025-06-01T12:00:00Z");

    await sendCreateNote(user.id, {
      id: postId,
      content: "<p>Hello world</p>",
      apId,
      createdAt,
    });

    expect(sendActivityFn).toHaveBeenCalledOnce();
    const [sender, recipients, activity] = sendActivityFn.mock.calls[0];

    // Sender is the user's identifier
    expect(sender).toEqual({ identifier: user.username });
    // Recipients is "followers"
    expect(recipients).toBe("followers");

    // Activity is a Create
    expect(activity).toBeInstanceOf(fedify.Create);
    expect(activity.actorId?.href).toBe(user.actorUri);

    // Activity ID follows pattern
    expect(activity.id?.href).toBe(
      `https://fediplus.test/activities/create/${postId}`
    );
  });
});

describe("Federation outbox — sendUpdateNote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installMockFederation();
  });

  it("should construct an Update { Note } activity", async () => {
    const user = makeLocalUser();
    findFirstFn.mockResolvedValue(user);

    const postId = randomUUID();
    await sendUpdateNote(user.id, {
      id: postId,
      content: "<p>Edited</p>",
      apId: `https://fediplus.test/posts/${postId}`,
      updatedAt: new Date(),
    });

    expect(sendActivityFn).toHaveBeenCalledOnce();
    const [, , activity] = sendActivityFn.mock.calls[0];
    expect(activity).toBeInstanceOf(fedify.Update);
  });
});

describe("Federation outbox — sendDeleteNote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installMockFederation();
  });

  it("should construct a Delete activity with the post AP ID as object", async () => {
    const user = makeLocalUser();
    findFirstFn.mockResolvedValue(user);

    const apId = "https://fediplus.test/posts/abc";
    await sendDeleteNote(user.id, apId);

    expect(sendActivityFn).toHaveBeenCalledOnce();
    const [, , activity] = sendActivityFn.mock.calls[0];
    expect(activity).toBeInstanceOf(fedify.Delete);
    expect(activity.actorId?.href).toBe(user.actorUri);
  });
});

describe("Federation outbox — sendLike", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installMockFederation();
  });

  it("should not send if user is not local", async () => {
    findFirstFn.mockResolvedValue(undefined);
    await sendLike("nonexistent", randomUUID());
    expect(sendActivityFn).not.toHaveBeenCalled();
  });

  it("should construct a Like activity pointing to the post AP ID", async () => {
    const user = makeLocalUser();
    const postId = randomUUID();
    const post = makePost({ id: postId, apId: `https://fediplus.test/posts/${postId}` });
    const postAuthor = makeLocalUser();

    findFirstFn
      .mockResolvedValueOnce(user)      // getLocalUser
      .mockResolvedValueOnce(post)      // post lookup
      .mockResolvedValueOnce(postAuthor); // post author lookup

    await sendLike(user.id, postId);

    expect(sendActivityFn).toHaveBeenCalledOnce();
    const [, , activity] = sendActivityFn.mock.calls[0];
    expect(activity).toBeInstanceOf(fedify.Like);
    expect(activity.id?.href).toContain(user.id);
    expect(activity.id?.href).toContain(postId);
  });
});

describe("Federation outbox — sendUndoLike", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installMockFederation();
  });

  it("should wrap a Like in an Undo activity", async () => {
    const user = makeLocalUser();
    const postId = randomUUID();
    const post = makePost({ id: postId, apId: `https://fediplus.test/posts/${postId}` });

    findFirstFn
      .mockResolvedValueOnce(user) // getLocalUser
      .mockResolvedValueOnce(post); // post lookup

    await sendUndoLike(user.id, postId);

    expect(sendActivityFn).toHaveBeenCalledOnce();
    const [, , activity] = sendActivityFn.mock.calls[0];
    expect(activity).toBeInstanceOf(fedify.Undo);
  });
});

describe("Federation outbox — sendFollow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installMockFederation();
    updateFn.mockReturnValue(chainProxy());
  });

  it("should not send AP Follow for local-to-local follows", async () => {
    const follower = makeLocalUser();
    const following = makeLocalUser(); // isLocal: true

    findFirstFn
      .mockResolvedValueOnce(follower)
      .mockResolvedValueOnce(following);

    await sendFollow(follower.id, following.id, randomUUID());

    expect(sendActivityFn).not.toHaveBeenCalled();
  });

  it("should send AP Follow for local-to-remote follows", async () => {
    const follower = makeLocalUser();
    const remote = makeUser({
      isLocal: false,
      domain: "remote.test",
      actorUri: "https://remote.test/users/bob",
    });

    findFirstFn
      .mockResolvedValueOnce(follower) // getLocalUser
      .mockResolvedValueOnce(remote);  // following lookup

    const followId = randomUUID();
    await sendFollow(follower.id, remote.id, followId);

    expect(sendActivityFn).toHaveBeenCalledOnce();
    const [, , activity] = sendActivityFn.mock.calls[0];
    expect(activity).toBeInstanceOf(fedify.Follow);
    expect(activity.actorId?.href).toBe(follower.actorUri);
  });
});

describe("Federation outbox — sendAnnounce", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installMockFederation();
  });

  it("should construct an Announce activity for reshares", async () => {
    const user = makeLocalUser();
    const originalPostId = randomUUID();
    const original = makePost({
      id: originalPostId,
      apId: `https://fediplus.test/posts/${originalPostId}`,
    });
    const reshareId = randomUUID();

    findFirstFn
      .mockResolvedValueOnce(user)     // getLocalUser
      .mockResolvedValueOnce(original); // original post lookup

    await sendAnnounce(user.id, originalPostId, reshareId);

    expect(sendActivityFn).toHaveBeenCalledOnce();
    const [, , activity] = sendActivityFn.mock.calls[0];
    expect(activity).toBeInstanceOf(fedify.Announce);
    expect(activity.id?.href).toContain(reshareId);
  });
});

describe("Federation outbox — sendBlock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installMockFederation();
  });

  it("should not send Block for local users", async () => {
    const blocker = makeLocalUser();
    const blocked = makeLocalUser(); // isLocal: true

    findFirstFn
      .mockResolvedValueOnce(blocker)
      .mockResolvedValueOnce(blocked);

    await sendBlock(blocker.id, blocked.id);

    expect(sendActivityFn).not.toHaveBeenCalled();
  });

  it("should send Block for remote users", async () => {
    const blocker = makeLocalUser();
    const remote = makeUser({
      isLocal: false,
      actorUri: "https://remote.test/users/spammer",
    });

    findFirstFn
      .mockResolvedValueOnce(blocker)
      .mockResolvedValueOnce(remote);

    await sendBlock(blocker.id, remote.id);

    expect(sendActivityFn).toHaveBeenCalledOnce();
    const [, , activity] = sendActivityFn.mock.calls[0];
    expect(activity).toBeInstanceOf(fedify.Block);
    expect(activity.actorId?.href).toBe(blocker.actorUri);
  });
});
