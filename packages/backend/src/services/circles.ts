import { eq, and, sql } from "drizzle-orm";
import { db } from "../db/connection.js";
import { circles, circleMembers } from "../db/schema/circles.js";
import { users, profiles } from "../db/schema/users.js";
import type { CreateCircleInput, UpdateCircleInput } from "@fediplus/shared";

export async function getCircles(userId: string) {
  const userCircles = await db
    .select({
      id: circles.id,
      name: circles.name,
      color: circles.color,
      isDefault: circles.isDefault,
      createdAt: circles.createdAt,
      updatedAt: circles.updatedAt,
      memberCount: sql<number>`(
        SELECT count(*)::int FROM circle_members
        WHERE circle_members.circle_id = ${circles.id}
      )`,
    })
    .from(circles)
    .where(eq(circles.userId, userId))
    .orderBy(circles.createdAt);

  return userCircles;
}

export async function getCircle(circleId: string, userId: string) {
  const circle = await db.query.circles.findFirst({
    where: and(eq(circles.id, circleId), eq(circles.userId, userId)),
  });
  if (!circle) return null;

  const members = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: profiles.displayName,
      avatarUrl: profiles.avatarUrl,
      actorUri: users.actorUri,
    })
    .from(circleMembers)
    .innerJoin(users, eq(circleMembers.memberId, users.id))
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(circleMembers.circleId, circleId));

  return { ...circle, members };
}

export async function createCircle(userId: string, input: CreateCircleInput) {
  const [circle] = await db
    .insert(circles)
    .values({
      userId,
      name: input.name,
      color: input.color ?? "#4285f4",
      isDefault: false,
    })
    .returning();

  return circle;
}

export async function updateCircle(
  circleId: string,
  userId: string,
  input: UpdateCircleInput
) {
  const circle = await db.query.circles.findFirst({
    where: and(eq(circles.id, circleId), eq(circles.userId, userId)),
  });
  if (!circle) return null;

  const values: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) values.name = input.name;
  if (input.color !== undefined) values.color = input.color;

  const [updated] = await db
    .update(circles)
    .set(values)
    .where(eq(circles.id, circleId))
    .returning();

  return updated;
}

export async function deleteCircle(circleId: string, userId: string) {
  const circle = await db.query.circles.findFirst({
    where: and(eq(circles.id, circleId), eq(circles.userId, userId)),
  });
  if (!circle) return false;
  if (circle.isDefault) {
    throw Object.assign(new Error("Cannot delete default circles"), {
      statusCode: 400,
    });
  }

  await db.delete(circles).where(eq(circles.id, circleId));
  return true;
}

export async function addMembers(
  circleId: string,
  userId: string,
  memberIds: string[]
) {
  const circle = await db.query.circles.findFirst({
    where: and(eq(circles.id, circleId), eq(circles.userId, userId)),
  });
  if (!circle) return null;

  const values = memberIds.map((memberId) => ({
    circleId,
    memberId,
  }));

  await db.insert(circleMembers).values(values).onConflictDoNothing();
  return true;
}

export async function removeMember(
  circleId: string,
  userId: string,
  memberId: string
) {
  const circle = await db.query.circles.findFirst({
    where: and(eq(circles.id, circleId), eq(circles.userId, userId)),
  });
  if (!circle) return false;

  await db
    .delete(circleMembers)
    .where(
      and(
        eq(circleMembers.circleId, circleId),
        eq(circleMembers.memberId, memberId)
      )
    );
  return true;
}

export async function resolveCircleMembers(
  circleIds: string[],
  userId: string
): Promise<string[]> {
  if (circleIds.length === 0) return [];

  const members = await db
    .select({ actorUri: users.actorUri })
    .from(circleMembers)
    .innerJoin(users, eq(circleMembers.memberId, users.id))
    .innerJoin(circles, eq(circleMembers.circleId, circles.id))
    .where(
      sql`${circles.userId} = ${userId} AND ${circleMembers.circleId} IN (${sql.join(
        circleIds.map((id) => sql`${id}::uuid`),
        sql`, `
      )})`
    );

  return [...new Set(members.map((m) => m.actorUri))];
}
