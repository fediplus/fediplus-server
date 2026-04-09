import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/connection.js";
import { streamingDestinations } from "../db/schema/streaming.js";
import type {
  CreateStreamingDestinationInput,
  UpdateStreamingDestinationInput,
} from "@fediplus/shared";

const MAX_DESTINATIONS = 10;

export async function getStreamingDestinations(userId: string) {
  return db
    .select()
    .from(streamingDestinations)
    .where(eq(streamingDestinations.userId, userId))
    .orderBy(desc(streamingDestinations.isDefault), desc(streamingDestinations.createdAt));
}

export async function getStreamingDestination(id: string, userId: string) {
  const [dest] = await db
    .select()
    .from(streamingDestinations)
    .where(
      and(
        eq(streamingDestinations.id, id),
        eq(streamingDestinations.userId, userId)
      )
    );
  return dest ?? null;
}

export async function createStreamingDestination(
  userId: string,
  input: CreateStreamingDestinationInput
) {
  // Enforce limit
  const existing = await db
    .select({ id: streamingDestinations.id })
    .from(streamingDestinations)
    .where(eq(streamingDestinations.userId, userId));

  if (existing.length >= MAX_DESTINATIONS) {
    throw Object.assign(
      new Error(`Maximum ${MAX_DESTINATIONS} streaming destinations allowed`),
      { statusCode: 400 }
    );
  }

  // If this is set as default, clear other defaults first
  if (input.isDefault) {
    await db
      .update(streamingDestinations)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(
        and(
          eq(streamingDestinations.userId, userId),
          eq(streamingDestinations.isDefault, true)
        )
      );
  }

  const [dest] = await db
    .insert(streamingDestinations)
    .values({
      userId,
      name: input.name,
      platform: input.platform ?? "custom",
      rtmpUrl: input.rtmpUrl,
      streamKey: input.streamKey ?? null,
      isDefault: input.isDefault ?? false,
    })
    .returning();

  return dest;
}

export async function updateStreamingDestination(
  id: string,
  userId: string,
  input: UpdateStreamingDestinationInput
) {
  const existing = await getStreamingDestination(id, userId);
  if (!existing) return null;

  // If setting as default, clear other defaults
  if (input.isDefault === true) {
    await db
      .update(streamingDestinations)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(
        and(
          eq(streamingDestinations.userId, userId),
          eq(streamingDestinations.isDefault, true)
        )
      );
  }

  const values: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) values.name = input.name;
  if (input.platform !== undefined) values.platform = input.platform;
  if (input.rtmpUrl !== undefined) values.rtmpUrl = input.rtmpUrl;
  if (input.streamKey !== undefined) values.streamKey = input.streamKey;
  if (input.isDefault !== undefined) values.isDefault = input.isDefault;

  const [updated] = await db
    .update(streamingDestinations)
    .set(values)
    .where(
      and(
        eq(streamingDestinations.id, id),
        eq(streamingDestinations.userId, userId)
      )
    )
    .returning();

  return updated;
}

export async function deleteStreamingDestination(
  id: string,
  userId: string
) {
  const existing = await getStreamingDestination(id, userId);
  if (!existing) return false;

  await db
    .delete(streamingDestinations)
    .where(
      and(
        eq(streamingDestinations.id, id),
        eq(streamingDestinations.userId, userId)
      )
    );

  return true;
}

/**
 * Resolve the full RTMP URL for streaming — combines rtmpUrl + streamKey if present.
 */
export function resolveRtmpUrl(destination: {
  rtmpUrl: string;
  streamKey: string | null;
}): string {
  if (!destination.streamKey) return destination.rtmpUrl;
  // Ensure the URL ends with / before appending the stream key
  const base = destination.rtmpUrl.endsWith("/")
    ? destination.rtmpUrl
    : destination.rtmpUrl + "/";
  return base + destination.streamKey;
}
