import { eq, and, desc, asc, sql, lt, gt, or } from "drizzle-orm";
import { db } from "../db/connection.js";
import { events, eventRsvps, eventPhotos } from "../db/schema/events.js";
import { users, profiles } from "../db/schema/users.js";
import { notifications } from "../db/schema/notifications.js";
import { circles, circleMembers } from "../db/schema/circles.js";
import { media } from "../db/schema/media.js";
import { sendEvent, broadcastToUsers } from "../realtime/sse.js";
import { config } from "../config.js";

interface CreateEventInput {
  name: string;
  description?: string;
  startDate: string;
  endDate?: string;
  location?: string;
  visibility?: "public" | "private";
  coverMediaId?: string;
}

interface UpdateEventInput {
  name?: string;
  description?: string;
  startDate?: string;
  endDate?: string | null;
  location?: string;
  visibility?: "public" | "private";
  coverMediaId?: string | null;
}

export async function createEvent(userId: string, input: CreateEventInput) {
  let coverUrl: string | null = null;
  if (input.coverMediaId) {
    const cover = await db.query.media.findFirst({
      where: eq(media.id, input.coverMediaId),
    });
    if (cover) coverUrl = cover.url;
  }

  const [event] = await db
    .insert(events)
    .values({
      name: input.name,
      description: input.description ?? "",
      startDate: new Date(input.startDate),
      endDate: input.endDate ? new Date(input.endDate) : null,
      location: input.location ?? null,
      visibility: input.visibility ?? "public",
      coverUrl,
      createdById: userId,
      apId: `${config.publicUrl}/events/${crypto.randomUUID()}`,
    })
    .returning();

  const creator = await db
    .select({
      username: users.username,
      displayName: profiles.displayName,
      avatarUrl: profiles.avatarUrl,
    })
    .from(users)
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(users.id, userId));

  return { ...event, creator: creator[0] ?? null };
}

export async function getEvent(id: string) {
  const event = await db.query.events.findFirst({
    where: eq(events.id, id),
  });
  if (!event) return null;

  const creator = await db
    .select({
      username: users.username,
      displayName: profiles.displayName,
      avatarUrl: profiles.avatarUrl,
    })
    .from(users)
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(users.id, event.createdById));

  const rsvpCounts = await db
    .select({
      status: eventRsvps.status,
      count: sql<number>`count(*)::int`,
    })
    .from(eventRsvps)
    .where(eq(eventRsvps.eventId, id))
    .groupBy(eventRsvps.status);

  const counts = { going: 0, maybe: 0, not_going: 0 };
  for (const row of rsvpCounts) {
    counts[row.status] = row.count;
  }

  return { ...event, creator: creator[0] ?? null, rsvpCounts: counts };
}

export async function listEvents(cursor?: string, limit = 20) {
  const now = new Date();
  const conditions = [
    eq(events.visibility, "public"),
    gt(events.startDate, now),
  ];
  if (cursor) {
    conditions.push(gt(events.startDate, new Date(cursor)));
  }

  const result = await db
    .select()
    .from(events)
    .where(and(...conditions))
    .orderBy(asc(events.startDate))
    .limit(limit + 1);

  const hasMore = result.length > limit;
  const items = result.slice(0, limit);

  return {
    items,
    cursor: hasMore ? items[items.length - 1].startDate.toISOString() : null,
  };
}

export async function getUserEvents(userId: string) {
  // Events created by user or RSVP'd to
  const created = await db
    .select()
    .from(events)
    .where(eq(events.createdById, userId))
    .orderBy(asc(events.startDate));

  const rsvpd = await db
    .select({ event: events, rsvpStatus: eventRsvps.status })
    .from(eventRsvps)
    .innerJoin(events, eq(eventRsvps.eventId, events.id))
    .where(eq(eventRsvps.userId, userId))
    .orderBy(asc(events.startDate));

  const seen = new Set(created.map((e) => e.id));
  const combined = [...created.map((e) => ({ ...e, myRsvp: null as string | null }))];
  for (const row of rsvpd) {
    if (!seen.has(row.event.id)) {
      seen.add(row.event.id);
      combined.push({ ...row.event, myRsvp: row.rsvpStatus });
    }
  }

  return combined;
}

export async function updateEvent(
  id: string,
  userId: string,
  input: UpdateEventInput
) {
  const event = await db.query.events.findFirst({
    where: eq(events.id, id),
  });
  if (!event) return null;
  if (event.createdById !== userId) {
    throw Object.assign(new Error("Only the creator can update this event"), {
      statusCode: 403,
    });
  }

  const values: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) values.name = input.name;
  if (input.description !== undefined) values.description = input.description;
  if (input.startDate !== undefined) values.startDate = new Date(input.startDate);
  if (input.endDate !== undefined) values.endDate = input.endDate ? new Date(input.endDate) : null;
  if (input.location !== undefined) values.location = input.location;
  if (input.visibility !== undefined) values.visibility = input.visibility;
  if (input.coverMediaId !== undefined) {
    if (input.coverMediaId) {
      const cover = await db.query.media.findFirst({
        where: eq(media.id, input.coverMediaId),
      });
      values.coverUrl = cover?.url ?? null;
    } else {
      values.coverUrl = null;
    }
  }

  const [updated] = await db
    .update(events)
    .set(values)
    .where(eq(events.id, id))
    .returning();

  return updated;
}

export async function deleteEvent(id: string, userId: string) {
  const event = await db.query.events.findFirst({
    where: eq(events.id, id),
  });
  if (!event) return false;
  if (event.createdById !== userId) {
    throw Object.assign(new Error("Only the creator can delete this event"), {
      statusCode: 403,
    });
  }

  await db.delete(events).where(eq(events.id, id));
  return true;
}

export async function rsvpEvent(
  eventId: string,
  userId: string,
  status: "going" | "maybe" | "not_going"
) {
  const event = await db.query.events.findFirst({
    where: eq(events.id, eventId),
  });
  if (!event) return null;

  // Upsert RSVP
  const existing = await db.query.eventRsvps.findFirst({
    where: and(
      eq(eventRsvps.eventId, eventId),
      eq(eventRsvps.userId, userId)
    ),
  });

  let rsvp;
  if (existing) {
    [rsvp] = await db
      .update(eventRsvps)
      .set({ status })
      .where(eq(eventRsvps.id, existing.id))
      .returning();
  } else {
    [rsvp] = await db
      .insert(eventRsvps)
      .values({ eventId, userId, status })
      .returning();
  }

  // Notify event creator
  if (event.createdById !== userId) {
    await db.insert(notifications).values({
      userId: event.createdById,
      type: "event_rsvp",
      actorId: userId,
      targetId: eventId,
      targetType: "event",
    });
    sendEvent(event.createdById, "event_rsvp", {
      eventId,
      userId,
      status,
    });
  }

  return rsvp;
}

export async function getEventRsvps(eventId: string) {
  const rsvps = await db
    .select({
      id: eventRsvps.id,
      status: eventRsvps.status,
      userId: users.id,
      username: users.username,
      displayName: profiles.displayName,
      avatarUrl: profiles.avatarUrl,
    })
    .from(eventRsvps)
    .innerJoin(users, eq(eventRsvps.userId, users.id))
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(eventRsvps.eventId, eventId))
    .orderBy(eventRsvps.createdAt);

  const grouped = { going: [] as typeof rsvps, maybe: [] as typeof rsvps, not_going: [] as typeof rsvps };
  for (const rsvp of rsvps) {
    grouped[rsvp.status].push(rsvp);
  }
  return grouped;
}

export async function inviteCircles(
  eventId: string,
  userId: string,
  circleIds: string[]
) {
  const event = await db.query.events.findFirst({
    where: eq(events.id, eventId),
  });
  if (!event) return null;
  if (event.createdById !== userId) {
    throw Object.assign(new Error("Only the creator can invite to this event"), {
      statusCode: 403,
    });
  }

  // Resolve circle members to user IDs
  const members = await db
    .select({ memberId: circleMembers.memberId })
    .from(circleMembers)
    .innerJoin(circles, eq(circleMembers.circleId, circles.id))
    .where(
      sql`${circles.userId} = ${userId} AND ${circleMembers.circleId} IN (${sql.join(
        circleIds.map((id) => sql`${id}::uuid`),
        sql`, `
      )})`
    );

  const uniqueIds = [...new Set(members.map((m) => m.memberId))].filter(
    (id) => id !== userId
  );

  // Create notifications and SSE for each invited user
  if (uniqueIds.length > 0) {
    await db.insert(notifications).values(
      uniqueIds.map((uid) => ({
        userId: uid,
        type: "event_invited" as const,
        actorId: userId,
        targetId: eventId,
        targetType: "event",
      }))
    );

    broadcastToUsers(uniqueIds, "notification", {
      type: "event_invited",
      eventId,
      eventName: event.name,
    });
  }

  return { invitedCount: uniqueIds.length };
}

export async function addEventPhoto(
  eventId: string,
  userId: string,
  mediaId: string
) {
  const event = await db.query.events.findFirst({
    where: eq(events.id, eventId),
  });
  if (!event) return null;

  // Check user has RSVP'd
  const rsvp = await db.query.eventRsvps.findFirst({
    where: and(
      eq(eventRsvps.eventId, eventId),
      eq(eventRsvps.userId, userId)
    ),
  });
  if (!rsvp && event.createdById !== userId) {
    throw Object.assign(new Error("Must RSVP to upload photos"), {
      statusCode: 403,
    });
  }

  const [photo] = await db
    .insert(eventPhotos)
    .values({ eventId, mediaId, uploadedById: userId })
    .returning();

  // Broadcast to RSVP'd attendees
  const attendees = await db
    .select({ userId: eventRsvps.userId })
    .from(eventRsvps)
    .where(eq(eventRsvps.eventId, eventId));

  const attendeeIds = attendees.map((a) => a.userId);
  broadcastToUsers(attendeeIds, "event_photo", {
    eventId,
    photoId: photo.id,
  });

  return photo;
}

export async function getEventPhotos(
  eventId: string,
  cursor?: string,
  limit = 20
) {
  const conditions = [eq(eventPhotos.eventId, eventId)];
  if (cursor) {
    conditions.push(lt(eventPhotos.createdAt, new Date(cursor)));
  }

  const result = await db
    .select({
      id: eventPhotos.id,
      eventId: eventPhotos.eventId,
      mediaId: eventPhotos.mediaId,
      uploadedById: eventPhotos.uploadedById,
      createdAt: eventPhotos.createdAt,
      url: media.url,
      thumbnailUrl: media.thumbnailUrl,
      altText: media.altText,
    })
    .from(eventPhotos)
    .innerJoin(media, eq(eventPhotos.mediaId, media.id))
    .where(and(...conditions))
    .orderBy(desc(eventPhotos.createdAt))
    .limit(limit + 1);

  const hasMore = result.length > limit;
  const items = result.slice(0, limit);

  return {
    items,
    cursor: hasMore ? items[items.length - 1].createdAt.toISOString() : null,
  };
}

export function generateIcal(event: {
  name: string;
  description: string;
  location: string | null;
  startDate: Date;
  endDate: Date | null;
  apId: string | null;
}) {
  const formatDate = (d: Date) =>
    d
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");

  const uid = event.apId ?? crypto.randomUUID();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Fedi+//Events//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTART:${formatDate(event.startDate)}`,
  ];

  if (event.endDate) {
    lines.push(`DTEND:${formatDate(event.endDate)}`);
  }

  lines.push(`SUMMARY:${event.name.replace(/[,;\\]/g, "\\$&")}`);

  if (event.description) {
    lines.push(`DESCRIPTION:${event.description.replace(/\n/g, "\\n").replace(/[,;\\]/g, "\\$&")}`);
  }

  if (event.location) {
    lines.push(`LOCATION:${event.location.replace(/[,;\\]/g, "\\$&")}`);
  }

  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n");
}
