import { eq, and, desc, isNull } from "drizzle-orm";
import { db } from "../db/connection.js";
import { hangouts, hangoutParticipants } from "../db/schema/hangouts.js";
import { users, profiles } from "../db/schema/users.js";
import { sendEvent, broadcastToUsers } from "../realtime/sse.js";
import { config } from "../config.js";
import { createRoom, getRoom, closeRoom, removeParticipant } from "../mediasoup/rooms.js";
import { startRtmpStream, stopRtmpStream } from "../mediasoup/streaming.js";

interface CreateHangoutInput {
  name?: string;
  visibility?: "public" | "private";
  maxParticipants?: number;
}

export async function createHangout(userId: string, input: CreateHangoutInput) {
  const [hangout] = await db
    .insert(hangouts)
    .values({
      name: input.name ?? null,
      visibility: input.visibility ?? "public",
      maxParticipants: input.maxParticipants ?? 10,
      createdById: userId,
      status: "waiting",
      apId: `${config.publicUrl}/hangouts/${crypto.randomUUID()}`,
    })
    .returning();

  // Create mediasoup room
  await createRoom(hangout.id);

  const creator = await db
    .select({
      username: users.username,
      displayName: profiles.displayName,
      avatarUrl: profiles.avatarUrl,
    })
    .from(users)
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(users.id, userId));

  return { ...hangout, creator: creator[0] ?? null };
}

export async function getHangout(id: string) {
  const hangout = await db.query.hangouts.findFirst({
    where: eq(hangouts.id, id),
  });
  if (!hangout) return null;

  const creator = await db
    .select({
      username: users.username,
      displayName: profiles.displayName,
      avatarUrl: profiles.avatarUrl,
    })
    .from(users)
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(users.id, hangout.createdById));

  const participants = await db
    .select({
      id: hangoutParticipants.id,
      userId: hangoutParticipants.userId,
      joinedAt: hangoutParticipants.joinedAt,
      isMuted: hangoutParticipants.isMuted,
      isCameraOff: hangoutParticipants.isCameraOff,
      isScreenSharing: hangoutParticipants.isScreenSharing,
      username: users.username,
      displayName: profiles.displayName,
      avatarUrl: profiles.avatarUrl,
    })
    .from(hangoutParticipants)
    .innerJoin(users, eq(hangoutParticipants.userId, users.id))
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .where(
      and(
        eq(hangoutParticipants.hangoutId, id),
        isNull(hangoutParticipants.leftAt)
      )
    );

  return { ...hangout, creator: creator[0] ?? null, participants };
}

export async function listActiveHangouts(cursor?: string, limit = 20) {
  const conditions = [
    eq(hangouts.visibility, "public"),
    eq(hangouts.status, "active"),
  ];

  const result = await db
    .select()
    .from(hangouts)
    .where(and(...conditions))
    .orderBy(desc(hangouts.createdAt))
    .limit(limit + 1);

  // Also include "waiting" hangouts
  const waitingResult = await db
    .select()
    .from(hangouts)
    .where(
      and(eq(hangouts.visibility, "public"), eq(hangouts.status, "waiting"))
    )
    .orderBy(desc(hangouts.createdAt))
    .limit(limit);

  const combined = [...waitingResult, ...result];
  const items = combined.slice(0, limit);

  return { items };
}

export async function getUserHangouts(userId: string) {
  // Hangouts created by user
  const created = await db
    .select()
    .from(hangouts)
    .where(eq(hangouts.createdById, userId))
    .orderBy(desc(hangouts.createdAt));

  // Hangouts participated in
  const participated = await db
    .select({ hangout: hangouts })
    .from(hangoutParticipants)
    .innerJoin(hangouts, eq(hangoutParticipants.hangoutId, hangouts.id))
    .where(eq(hangoutParticipants.userId, userId))
    .orderBy(desc(hangouts.createdAt));

  const seen = new Set(created.map((h) => h.id));
  const combined = [...created];
  for (const row of participated) {
    if (!seen.has(row.hangout.id)) {
      seen.add(row.hangout.id);
      combined.push(row.hangout);
    }
  }

  return combined;
}

export async function joinHangout(id: string, userId: string) {
  const hangout = await db.query.hangouts.findFirst({
    where: eq(hangouts.id, id),
  });
  if (!hangout) return null;
  if (hangout.status === "ended") {
    throw Object.assign(new Error("Hangout has ended"), { statusCode: 410 });
  }

  // Check if already participating
  const existing = await db.query.hangoutParticipants.findFirst({
    where: and(
      eq(hangoutParticipants.hangoutId, id),
      eq(hangoutParticipants.userId, userId),
      isNull(hangoutParticipants.leftAt)
    ),
  });
  if (existing) return existing;

  // Check max participants
  const activeParticipants = await db
    .select({ id: hangoutParticipants.id })
    .from(hangoutParticipants)
    .where(
      and(
        eq(hangoutParticipants.hangoutId, id),
        isNull(hangoutParticipants.leftAt)
      )
    );

  if (activeParticipants.length >= hangout.maxParticipants) {
    throw Object.assign(new Error("Hangout is full"), { statusCode: 409 });
  }

  const [participant] = await db
    .insert(hangoutParticipants)
    .values({ hangoutId: id, userId })
    .returning();

  // Set hangout to active if first participant
  if (hangout.status === "waiting") {
    await db
      .update(hangouts)
      .set({ status: "active", startedAt: new Date(), updatedAt: new Date() })
      .where(eq(hangouts.id, id));
  }

  // Get user info for notification
  const user = await db
    .select({
      username: users.username,
      displayName: profiles.displayName,
    })
    .from(users)
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(users.id, userId));

  // Notify other participants
  const otherParticipants = activeParticipants
    .map((p) => p.id)
    .filter((pid) => pid !== participant.id);

  // Get user IDs of other participants
  const otherUserIds = await db
    .select({ userId: hangoutParticipants.userId })
    .from(hangoutParticipants)
    .where(
      and(
        eq(hangoutParticipants.hangoutId, id),
        isNull(hangoutParticipants.leftAt)
      )
    );

  broadcastToUsers(
    otherUserIds.map((p) => p.userId).filter((uid) => uid !== userId),
    "participant_joined",
    {
      hangoutId: id,
      userId,
      username: user[0]?.username,
      displayName: user[0]?.displayName,
    }
  );

  return participant;
}

export async function leaveHangout(id: string, userId: string) {
  const hangout = await db.query.hangouts.findFirst({
    where: eq(hangouts.id, id),
  });
  if (!hangout) return false;

  // Mark participant as left
  await db
    .update(hangoutParticipants)
    .set({ leftAt: new Date() })
    .where(
      and(
        eq(hangoutParticipants.hangoutId, id),
        eq(hangoutParticipants.userId, userId),
        isNull(hangoutParticipants.leftAt)
      )
    );

  // Clean up mediasoup resources
  const room = getRoom(id);
  if (room) {
    removeParticipant(room, userId);
  }

  // Check remaining participants
  const remaining = await db
    .select({ id: hangoutParticipants.id })
    .from(hangoutParticipants)
    .where(
      and(
        eq(hangoutParticipants.hangoutId, id),
        isNull(hangoutParticipants.leftAt)
      )
    );

  if (remaining.length === 0) {
    // End hangout if last participant
    await endHangoutInternal(id);
  } else {
    // Notify remaining participants
    const remainingUserIds = await db
      .select({ userId: hangoutParticipants.userId })
      .from(hangoutParticipants)
      .where(
        and(
          eq(hangoutParticipants.hangoutId, id),
          isNull(hangoutParticipants.leftAt)
        )
      );

    broadcastToUsers(
      remainingUserIds.map((p) => p.userId),
      "participant_left",
      { hangoutId: id, userId }
    );
  }

  return true;
}

async function endHangoutInternal(id: string) {
  // Stop streaming if active
  stopRtmpStream(id);

  // Close mediasoup room
  closeRoom(id);

  await db
    .update(hangouts)
    .set({
      status: "ended",
      endedAt: new Date(),
      rtmpActive: false,
      updatedAt: new Date(),
    })
    .where(eq(hangouts.id, id));
}

export async function endHangout(id: string, userId: string) {
  const hangout = await db.query.hangouts.findFirst({
    where: eq(hangouts.id, id),
  });
  if (!hangout) return false;
  if (hangout.createdById !== userId) {
    throw Object.assign(new Error("Only the creator can end this hangout"), {
      statusCode: 403,
    });
  }

  // Notify all participants before ending
  const participants = await db
    .select({ userId: hangoutParticipants.userId })
    .from(hangoutParticipants)
    .where(
      and(
        eq(hangoutParticipants.hangoutId, id),
        isNull(hangoutParticipants.leftAt)
      )
    );

  broadcastToUsers(
    participants.map((p) => p.userId),
    "hangout_ended",
    { hangoutId: id }
  );

  // Mark all participants as left
  await db
    .update(hangoutParticipants)
    .set({ leftAt: new Date() })
    .where(
      and(
        eq(hangoutParticipants.hangoutId, id),
        isNull(hangoutParticipants.leftAt)
      )
    );

  await endHangoutInternal(id);
  return true;
}

export async function updateMediaState(
  hangoutId: string,
  userId: string,
  state: { isMuted?: boolean; isCameraOff?: boolean; isScreenSharing?: boolean }
) {
  const values: Record<string, unknown> = {};
  if (state.isMuted !== undefined) values.isMuted = state.isMuted;
  if (state.isCameraOff !== undefined) values.isCameraOff = state.isCameraOff;
  if (state.isScreenSharing !== undefined)
    values.isScreenSharing = state.isScreenSharing;

  if (Object.keys(values).length === 0) return null;

  const [updated] = await db
    .update(hangoutParticipants)
    .set(values)
    .where(
      and(
        eq(hangoutParticipants.hangoutId, hangoutId),
        eq(hangoutParticipants.userId, userId),
        isNull(hangoutParticipants.leftAt)
      )
    )
    .returning();

  if (!updated) return null;

  // Broadcast to all participants
  const participants = await db
    .select({ userId: hangoutParticipants.userId })
    .from(hangoutParticipants)
    .where(
      and(
        eq(hangoutParticipants.hangoutId, hangoutId),
        isNull(hangoutParticipants.leftAt)
      )
    );

  broadcastToUsers(
    participants.map((p) => p.userId),
    "media_state_changed",
    { hangoutId, userId, ...state }
  );

  return updated;
}

export async function startStream(
  hangoutId: string,
  userId: string,
  rtmpUrl: string
) {
  const hangout = await db.query.hangouts.findFirst({
    where: eq(hangouts.id, hangoutId),
  });
  if (!hangout) return null;
  if (hangout.createdById !== userId) {
    throw Object.assign(
      new Error("Only the creator can start streaming"),
      { statusCode: 403 }
    );
  }

  const started = await startRtmpStream(hangoutId, rtmpUrl);
  if (!started) {
    throw Object.assign(new Error("Failed to start stream"), {
      statusCode: 500,
    });
  }

  await db
    .update(hangouts)
    .set({ rtmpUrl, rtmpActive: true, updatedAt: new Date() })
    .where(eq(hangouts.id, hangoutId));

  // Notify participants
  const participants = await db
    .select({ userId: hangoutParticipants.userId })
    .from(hangoutParticipants)
    .where(
      and(
        eq(hangoutParticipants.hangoutId, hangoutId),
        isNull(hangoutParticipants.leftAt)
      )
    );

  broadcastToUsers(
    participants.map((p) => p.userId),
    "stream_started",
    { hangoutId }
  );

  return { ok: true };
}

export async function stopStream(hangoutId: string, userId: string) {
  const hangout = await db.query.hangouts.findFirst({
    where: eq(hangouts.id, hangoutId),
  });
  if (!hangout) return null;
  if (hangout.createdById !== userId) {
    throw Object.assign(
      new Error("Only the creator can stop streaming"),
      { statusCode: 403 }
    );
  }

  stopRtmpStream(hangoutId);

  await db
    .update(hangouts)
    .set({ rtmpActive: false, updatedAt: new Date() })
    .where(eq(hangouts.id, hangoutId));

  // Notify participants
  const participants = await db
    .select({ userId: hangoutParticipants.userId })
    .from(hangoutParticipants)
    .where(
      and(
        eq(hangoutParticipants.hangoutId, hangoutId),
        isNull(hangoutParticipants.leftAt)
      )
    );

  broadcastToUsers(
    participants.map((p) => p.userId),
    "stream_stopped",
    { hangoutId }
  );

  return { ok: true };
}
