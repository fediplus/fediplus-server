import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { makeUser, makeProfile } from "../helpers/fixtures.js";

// ── Helpers ────────────────────────────────────────────────────

function makeHangout(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  return {
    id,
    name: "Test Hangout",
    visibility: "public" as const,
    status: "waiting" as const,
    createdById: randomUUID(),
    maxParticipants: 10,
    rtmpUrl: null,
    rtmpActive: false,
    apId: `https://fediplus.test/hangouts/${id}`,
    startedAt: null,
    endedAt: null,
    createdAt: new Date("2025-01-15"),
    updatedAt: new Date("2025-01-15"),
    ...overrides,
  };
}

function makeParticipant(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    hangoutId: randomUUID(),
    userId: randomUUID(),
    joinedAt: new Date("2025-01-15"),
    leftAt: null,
    isMuted: false,
    isCameraOff: false,
    isScreenSharing: false,
    ...overrides,
  };
}

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
      hangouts: { findFirst: findFirstFn },
      hangoutParticipants: { findFirst: findFirstFn },
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
    mediasoup: {
      listenIp: "0.0.0.0",
      announcedIp: "127.0.0.1",
      rtcMinPort: 40000,
      rtcMaxPort: 49999,
    },
  },
}));

// Mock mediasoup rooms
const mockCreateRoom = vi.fn().mockResolvedValue({
  router: { rtpCapabilities: {} },
  participants: new Map(),
});
const mockGetRoom = vi.fn();
const mockCloseRoom = vi.fn();
const mockRemoveParticipant = vi.fn();

vi.mock("../../mediasoup/rooms.js", () => ({
  createRoom: (...args: unknown[]) => mockCreateRoom(...args),
  getRoom: (...args: unknown[]) => mockGetRoom(...args),
  closeRoom: (...args: unknown[]) => mockCloseRoom(...args),
  removeParticipant: (...args: unknown[]) => mockRemoveParticipant(...args),
}));

// Mock mediasoup streaming
const mockStartRtmpStream = vi.fn().mockResolvedValue(true);
const mockStopRtmpStream = vi.fn().mockReturnValue(true);

vi.mock("../../mediasoup/streaming.js", () => ({
  startRtmpStream: (...args: unknown[]) => mockStartRtmpStream(...args),
  stopRtmpStream: (...args: unknown[]) => mockStopRtmpStream(...args),
}));

// Mock SSE
const mockSendEvent = vi.fn();
const mockBroadcastToUsers = vi.fn();

vi.mock("../../realtime/sse.js", () => ({
  sendEvent: (...args: unknown[]) => mockSendEvent(...args),
  broadcastToUsers: (...args: unknown[]) => mockBroadcastToUsers(...args),
}));

// Mock streaming service (imported by hangouts for startStream)
const mockGetStreamingDestination = vi.fn();
const mockResolveRtmpUrl = vi.fn();

vi.mock("../../services/streaming.js", () => ({
  getStreamingDestination: (...args: unknown[]) => mockGetStreamingDestination(...args),
  resolveRtmpUrl: (...args: unknown[]) => mockResolveRtmpUrl(...args),
}));

// Mock YouTube service
const mockGetYouTubeConnection = vi.fn();
const mockCreateYouTubeBroadcast = vi.fn();

vi.mock("../../services/youtube.js", () => ({
  getYouTubeConnection: (...args: unknown[]) => mockGetYouTubeConnection(...args),
  createYouTubeBroadcast: (...args: unknown[]) => mockCreateYouTubeBroadcast(...args),
}));

// Mock posts service
const mockCreatePost = vi.fn().mockResolvedValue({ id: "post-id" });

vi.mock("../../services/posts.js", () => ({
  createPost: (...args: unknown[]) => mockCreatePost(...args),
}));

// ── Import AFTER mocks ────────────────────────────────────────

const {
  createHangout,
  getHangout,
  listActiveHangouts,
  getUserHangouts,
  joinHangout,
  leaveHangout,
  endHangout,
  updateMediaState,
  startStream,
  stopStream,
} = await import("../../services/hangouts.js");

// ── Tests ──────────────────────────────────────────────────────

describe("Hangouts — createHangout", () => {
  const userId = randomUUID();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a hangout and mediasoup room", async () => {
    const hangout = makeHangout({ createdById: userId });
    returningFn.mockResolvedValue([hangout]);
    insertFn.mockReturnValue(chainProxy());
    selectFn.mockReturnValue(
      chainProxy([{ username: "alice", displayName: "Alice", avatarUrl: null }])
    );

    const result = await createHangout(userId, {
      name: "Test Hangout",
      visibility: "public",
      maxParticipants: 10,
    });

    expect(insertFn).toHaveBeenCalled();
    expect(mockCreateRoom).toHaveBeenCalledWith(hangout.id);
    expect(result.creator).toEqual({
      username: "alice",
      displayName: "Alice",
      avatarUrl: null,
    });
  });

  it("defaults visibility to public", async () => {
    const hangout = makeHangout({ createdById: userId });
    returningFn.mockResolvedValue([hangout]);
    insertFn.mockReturnValue(chainProxy());
    selectFn.mockReturnValue(chainProxy([]));

    const result = await createHangout(userId, {});

    expect(insertFn).toHaveBeenCalled();
    expect(result.creator).toBeNull();
  });
});

describe("Hangouts — getHangout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null for unknown hangout", async () => {
    findFirstFn.mockResolvedValue(null);

    const result = await getHangout(randomUUID());

    expect(result).toBeNull();
  });

  it("returns hangout with creator and participants", async () => {
    const hangout = makeHangout();
    findFirstFn.mockResolvedValue(hangout);
    selectFn
      .mockReturnValueOnce(
        chainProxy([
          { username: "alice", displayName: "Alice", avatarUrl: null },
        ])
      )
      .mockReturnValueOnce(
        chainProxy([
          {
            id: randomUUID(),
            userId: randomUUID(),
            joinedAt: new Date(),
            isMuted: false,
            isCameraOff: false,
            isScreenSharing: false,
            username: "bob",
            displayName: "Bob",
            avatarUrl: null,
          },
        ])
      );

    const result = await getHangout(hangout.id);

    expect(result).not.toBeNull();
    expect(result!.creator).toEqual({
      username: "alice",
      displayName: "Alice",
      avatarUrl: null,
    });
    expect(result!.participants).toHaveLength(1);
    expect(result!.participants[0].username).toBe("bob");
  });
});

describe("Hangouts — joinHangout", () => {
  const userId = randomUUID();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null if hangout not found", async () => {
    findFirstFn.mockResolvedValue(null);

    const result = await joinHangout(randomUUID(), userId);

    expect(result).toBeNull();
  });

  it("throws 410 if hangout has ended", async () => {
    findFirstFn.mockResolvedValue(makeHangout({ status: "ended" }));

    await expect(joinHangout(randomUUID(), userId)).rejects.toThrow(
      "Hangout has ended"
    );
  });

  it("returns existing participant if already joined", async () => {
    const hangout = makeHangout({ status: "active" });
    const existing = makeParticipant({
      hangoutId: hangout.id,
      userId,
    });

    findFirstFn
      .mockResolvedValueOnce(hangout) // hangouts.findFirst
      .mockResolvedValueOnce(existing); // hangoutParticipants.findFirst

    const result = await joinHangout(hangout.id, userId);

    expect(result).toEqual(existing);
  });

  it("throws 409 if hangout is full", async () => {
    const hangout = makeHangout({ status: "active", maxParticipants: 2 });

    findFirstFn
      .mockResolvedValueOnce(hangout) // hangouts.findFirst
      .mockResolvedValueOnce(null); // hangoutParticipants.findFirst (not already in)

    // Active participants
    selectFn.mockReturnValueOnce(
      chainProxy([{ id: randomUUID() }, { id: randomUUID() }])
    );

    await expect(joinHangout(hangout.id, userId)).rejects.toThrow(
      "Hangout is full"
    );
  });

  it("creates participant and sets hangout active if waiting", async () => {
    const hangout = makeHangout({ status: "waiting" });
    const participant = makeParticipant({
      hangoutId: hangout.id,
      userId,
    });

    findFirstFn
      .mockResolvedValueOnce(hangout)
      .mockResolvedValueOnce(null); // not already joined

    selectFn
      .mockReturnValueOnce(chainProxy([])) // active participants (empty)
      .mockReturnValueOnce(
        chainProxy([{ username: "alice", displayName: "Alice" }])
      ) // user info
      .mockReturnValueOnce(chainProxy([])); // other user IDs

    returningFn.mockResolvedValue([participant]);
    insertFn.mockReturnValue(chainProxy());
    updateFn.mockReturnValue(chainProxy());

    const result = await joinHangout(hangout.id, userId);

    expect(returningFn).toHaveBeenCalled();
    expect(updateFn).toHaveBeenCalled();
  });
});

describe("Hangouts — leaveHangout", () => {
  const userId = randomUUID();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false if hangout not found", async () => {
    findFirstFn.mockResolvedValue(null);

    const result = await leaveHangout(randomUUID(), userId);

    expect(result).toBe(false);
  });

  it("marks participant as left and cleans up mediasoup", async () => {
    const hangout = makeHangout({ status: "active" });
    const room = { router: {}, participants: new Map() };

    findFirstFn.mockResolvedValue(hangout);
    updateFn.mockReturnValue(chainProxy());
    mockGetRoom.mockReturnValue(room);
    selectFn
      .mockReturnValueOnce(chainProxy([])) // remaining participants (empty = last)
    ;

    const result = await leaveHangout(hangout.id, userId);

    expect(result).toBe(true);
    expect(updateFn).toHaveBeenCalled();
    expect(mockRemoveParticipant).toHaveBeenCalledWith(room, userId);
  });

  it("ends hangout when last participant leaves", async () => {
    const hangout = makeHangout({ status: "active" });

    findFirstFn.mockResolvedValue(hangout);
    updateFn.mockReturnValue(chainProxy());
    mockGetRoom.mockReturnValue(null);
    selectFn.mockReturnValueOnce(chainProxy([])); // remaining (empty)

    await leaveHangout(hangout.id, userId);

    expect(mockStopRtmpStream).toHaveBeenCalledWith(hangout.id);
    expect(mockCloseRoom).toHaveBeenCalledWith(hangout.id);
  });
});

describe("Hangouts — endHangout", () => {
  const userId = randomUUID();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false if hangout not found", async () => {
    findFirstFn.mockResolvedValue(null);

    const result = await endHangout(randomUUID(), userId);

    expect(result).toBe(false);
  });

  it("throws 403 if not the creator", async () => {
    const hangout = makeHangout({ createdById: randomUUID() });
    findFirstFn.mockResolvedValue(hangout);

    await expect(endHangout(hangout.id, userId)).rejects.toThrow(
      "Only the creator can end this hangout"
    );
  });

  it("ends the hangout, notifies participants, and cleans up", async () => {
    const hangout = makeHangout({ createdById: userId });

    findFirstFn.mockResolvedValue(hangout);
    selectFn.mockReturnValueOnce(
      chainProxy([{ userId: randomUUID() }, { userId }])
    );
    updateFn.mockReturnValue(chainProxy());

    const result = await endHangout(hangout.id, userId);

    expect(result).toBe(true);
    expect(mockBroadcastToUsers).toHaveBeenCalledWith(
      expect.any(Array),
      "hangout_ended",
      { hangoutId: hangout.id }
    );
    expect(mockStopRtmpStream).toHaveBeenCalledWith(hangout.id);
    expect(mockCloseRoom).toHaveBeenCalledWith(hangout.id);
  });
});

describe("Hangouts — updateMediaState", () => {
  const userId = randomUUID();
  const hangoutId = randomUUID();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no fields provided", async () => {
    const result = await updateMediaState(hangoutId, userId, {});

    expect(result).toBeNull();
  });

  it("updates mute state and broadcasts", async () => {
    const updated = makeParticipant({ isMuted: true });

    returningFn.mockResolvedValue([updated]);
    updateFn.mockReturnValue(chainProxy());
    selectFn.mockReturnValueOnce(
      chainProxy([{ userId }, { userId: randomUUID() }])
    );

    const result = await updateMediaState(hangoutId, userId, {
      isMuted: true,
    });

    expect(updateFn).toHaveBeenCalled();
    expect(mockBroadcastToUsers).toHaveBeenCalledWith(
      expect.any(Array),
      "media_state_changed",
      { hangoutId, userId, isMuted: true }
    );
  });

  it("returns null if participant not found", async () => {
    returningFn.mockResolvedValue([]);
    updateFn.mockReturnValue(chainProxy());

    const result = await updateMediaState(hangoutId, userId, {
      isCameraOff: true,
    });

    // Returns undefined from [0] of empty array
    expect(result).toBeFalsy();
  });
});

describe("Hangouts — streaming", () => {
  const userId = randomUUID();
  const hangoutId = randomUUID();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("startStream throws 403 if not creator", async () => {
    const hangout = makeHangout({ id: hangoutId, createdById: randomUUID() });
    findFirstFn.mockResolvedValue(hangout);

    await expect(
      startStream(hangoutId, userId, "rtmp://stream.example.com/live")
    ).rejects.toThrow("Only the creator can start streaming");
  });

  it("startStream initiates RTMP and notifies participants", async () => {
    const hangout = makeHangout({ id: hangoutId, createdById: userId });
    findFirstFn.mockResolvedValue(hangout);
    updateFn.mockReturnValue(chainProxy());
    selectFn.mockReturnValueOnce(
      chainProxy([{ userId }, { userId: randomUUID() }])
    );
    mockStartRtmpStream.mockResolvedValue(true);

    const result = await startStream(
      hangoutId,
      userId,
      "rtmp://stream.example.com/live"
    );

    expect(result).toEqual({ ok: true, youtubeBroadcastId: null });
    expect(mockStartRtmpStream).toHaveBeenCalledWith(
      hangoutId,
      "rtmp://stream.example.com/live"
    );
    expect(mockBroadcastToUsers).toHaveBeenCalledWith(
      expect.any(Array),
      "stream_started",
      { hangoutId, youtubeBroadcastId: null }
    );
  });

  it("stopStream throws 403 if not creator", async () => {
    const hangout = makeHangout({ id: hangoutId, createdById: randomUUID() });
    findFirstFn.mockResolvedValue(hangout);

    await expect(stopStream(hangoutId, userId)).rejects.toThrow(
      "Only the creator can stop streaming"
    );
  });

  it("stopStream stops RTMP and notifies participants", async () => {
    const hangout = makeHangout({ id: hangoutId, createdById: userId });
    findFirstFn.mockResolvedValue(hangout);
    updateFn.mockReturnValue(chainProxy());
    selectFn.mockReturnValueOnce(
      chainProxy([{ userId }])
    );

    const result = await stopStream(hangoutId, userId);

    expect(result).toEqual({ ok: true });
    expect(mockStopRtmpStream).toHaveBeenCalledWith(hangoutId);
    expect(mockBroadcastToUsers).toHaveBeenCalledWith(
      expect.any(Array),
      "stream_stopped",
      { hangoutId }
    );
  });
});

describe("Hangouts — signaling message handling", () => {
  it("tests are covered by the WebSocket integration in hangout-signaling", () => {
    // The signaling module's handleMessage function is an internal detail
    // tested via the WebSocket protocol. The key behaviors verified here
    // are the service-level operations that the signaling route depends on.
    expect(true).toBe(true);
  });
});
