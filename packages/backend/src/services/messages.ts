import { eq, and, desc, lt, sql } from "drizzle-orm";
import { db } from "../db/connection.js";
import {
  conversations,
  conversationParticipants,
  messages,
} from "../db/schema/messages.js";
import { users, profiles } from "../db/schema/users.js";
import { notifications } from "../db/schema/notifications.js";
import { sendEvent } from "../realtime/sse.js";

export async function createConversation(
  userId: string,
  participantIds: string[]
) {
  // For 1:1, check if conversation already exists
  if (participantIds.length === 1) {
    const otherId = participantIds[0];
    // Find conversations where both users participate and it's not a group
    const myConvs = await db
      .select({ conversationId: conversationParticipants.conversationId })
      .from(conversationParticipants)
      .where(eq(conversationParticipants.userId, userId));

    for (const mc of myConvs) {
      const conv = await db.query.conversations.findFirst({
        where: and(
          eq(conversations.id, mc.conversationId),
          eq(conversations.isGroup, false)
        ),
      });
      if (!conv) continue;

      const otherMember = await db.query.conversationParticipants.findFirst({
        where: and(
          eq(conversationParticipants.conversationId, conv.id),
          eq(conversationParticipants.userId, otherId)
        ),
      });
      if (otherMember) {
        return getConversation(conv.id, userId);
      }
    }
  }

  const isGroup = participantIds.length > 1;
  const [conversation] = await db
    .insert(conversations)
    .values({
      createdById: userId,
      isGroup,
    })
    .returning();

  // Add all participants including creator
  const allParticipantIds = [userId, ...participantIds];
  await db.insert(conversationParticipants).values(
    allParticipantIds.map((uid) => ({
      conversationId: conversation.id,
      userId: uid,
    }))
  );

  return getConversation(conversation.id, userId);
}

export async function getConversations(
  userId: string,
  cursor?: string,
  limit = 20
) {
  // Get conversations the user participates in
  const conditions = [eq(conversationParticipants.userId, userId)];

  const participantRows = await db
    .select({
      conversationId: conversationParticipants.conversationId,
    })
    .from(conversationParticipants)
    .where(and(...conditions));

  const conversationIds = participantRows.map((r) => r.conversationId);
  if (conversationIds.length === 0) return { items: [], cursor: null };

  const cursorConditions = [
    sql`${conversations.id} IN (${sql.join(
      conversationIds.map((id) => sql`${id}::uuid`),
      sql`, `
    )})`,
  ];
  if (cursor) {
    cursorConditions.push(lt(conversations.updatedAt, new Date(cursor)));
  }

  const result = await db
    .select()
    .from(conversations)
    .where(and(...cursorConditions))
    .orderBy(desc(conversations.updatedAt))
    .limit(limit + 1);

  const hasMore = result.length > limit;
  const items = result.slice(0, limit);

  // For each conversation, get participants and last message metadata
  const enriched = await Promise.all(
    items.map(async (conv) => {
      const participants = await db
        .select({
          userId: users.id,
          username: users.username,
          displayName: profiles.displayName,
          avatarUrl: profiles.avatarUrl,
          encryptionPublicKey: users.encryptionPublicKey,
        })
        .from(conversationParticipants)
        .innerJoin(users, eq(conversationParticipants.userId, users.id))
        .innerJoin(profiles, eq(profiles.userId, users.id))
        .where(eq(conversationParticipants.conversationId, conv.id));

      // Last message metadata (just timestamp and senderId)
      const [lastMessage] = await db
        .select({
          senderId: messages.senderId,
          createdAt: messages.createdAt,
        })
        .from(messages)
        .where(eq(messages.conversationId, conv.id))
        .orderBy(desc(messages.createdAt))
        .limit(1);

      // Unread count for current user
      const myParticipant = await db.query.conversationParticipants.findFirst({
        where: and(
          eq(conversationParticipants.conversationId, conv.id),
          eq(conversationParticipants.userId, userId)
        ),
      });

      let unreadCount = 0;
      if (myParticipant) {
        const unreadConditions = [
          eq(messages.conversationId, conv.id),
          sql`${messages.senderId} != ${userId}`,
        ];
        if (myParticipant.lastReadAt) {
          unreadConditions.push(
            sql`${messages.createdAt} > ${myParticipant.lastReadAt}`
          );
        }
        const [{ count }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(messages)
          .where(and(...unreadConditions));
        unreadCount = count;
      }

      return {
        ...conv,
        participants,
        lastMessage: lastMessage ?? null,
        unreadCount,
      };
    })
  );

  return {
    items: enriched,
    cursor: hasMore
      ? items[items.length - 1].updatedAt.toISOString()
      : null,
  };
}

export async function getConversation(id: string, userId: string) {
  const conversation = await db.query.conversations.findFirst({
    where: eq(conversations.id, id),
  });
  if (!conversation) return null;

  // Verify user is participant
  const myParticipant = await db.query.conversationParticipants.findFirst({
    where: and(
      eq(conversationParticipants.conversationId, id),
      eq(conversationParticipants.userId, userId)
    ),
  });
  if (!myParticipant) {
    throw Object.assign(new Error("Not a participant"), { statusCode: 403 });
  }

  const participants = await db
    .select({
      userId: users.id,
      username: users.username,
      displayName: profiles.displayName,
      avatarUrl: profiles.avatarUrl,
      encryptionPublicKey: users.encryptionPublicKey,
    })
    .from(conversationParticipants)
    .innerJoin(users, eq(conversationParticipants.userId, users.id))
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(conversationParticipants.conversationId, id));

  return { ...conversation, participants };
}

export async function sendMessage(
  conversationId: string,
  userId: string,
  input: { ciphertext: string; ephemeralPublicKey: string; iv: string }
) {
  // Verify user is participant
  const myParticipant = await db.query.conversationParticipants.findFirst({
    where: and(
      eq(conversationParticipants.conversationId, conversationId),
      eq(conversationParticipants.userId, userId)
    ),
  });
  if (!myParticipant) {
    throw Object.assign(new Error("Not a participant"), { statusCode: 403 });
  }

  const [message] = await db
    .insert(messages)
    .values({
      conversationId,
      senderId: userId,
      ciphertext: input.ciphertext,
      ephemeralPublicKey: input.ephemeralPublicKey,
      iv: input.iv,
    })
    .returning();

  // Update conversation timestamp
  await db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));

  // Get all other participants
  const otherParticipants = await db
    .select({ userId: conversationParticipants.userId })
    .from(conversationParticipants)
    .where(
      and(
        eq(conversationParticipants.conversationId, conversationId),
        sql`${conversationParticipants.userId} != ${userId}`
      )
    );

  const otherIds = otherParticipants.map((p) => p.userId);

  // SSE to all other participants with encrypted payload
  for (const otherId of otherIds) {
    sendEvent(otherId, "new_message", {
      conversationId,
      message: {
        id: message.id,
        senderId: message.senderId,
        ciphertext: message.ciphertext,
        ephemeralPublicKey: message.ephemeralPublicKey,
        iv: message.iv,
        createdAt: message.createdAt.toISOString(),
      },
    });

    // Create notification
    await db.insert(notifications).values({
      userId: otherId,
      type: "message",
      actorId: userId,
      targetId: conversationId,
      targetType: "conversation",
    });
  }

  return message;
}

export async function getMessages(
  conversationId: string,
  userId: string,
  cursor?: string,
  limit = 50
) {
  // Verify user is participant
  const myParticipant = await db.query.conversationParticipants.findFirst({
    where: and(
      eq(conversationParticipants.conversationId, conversationId),
      eq(conversationParticipants.userId, userId)
    ),
  });
  if (!myParticipant) {
    throw Object.assign(new Error("Not a participant"), { statusCode: 403 });
  }

  const conditions = [eq(messages.conversationId, conversationId)];
  if (cursor) {
    conditions.push(lt(messages.createdAt, new Date(cursor)));
  }

  const result = await db
    .select()
    .from(messages)
    .where(and(...conditions))
    .orderBy(desc(messages.createdAt))
    .limit(limit + 1);

  const hasMore = result.length > limit;
  const items = result.slice(0, limit).reverse();

  return {
    items,
    cursor: hasMore ? result[limit].createdAt.toISOString() : null,
  };
}

export async function markConversationRead(
  conversationId: string,
  userId: string
) {
  await db
    .update(conversationParticipants)
    .set({ lastReadAt: new Date() })
    .where(
      and(
        eq(conversationParticipants.conversationId, conversationId),
        eq(conversationParticipants.userId, userId)
      )
    );
  return { ok: true };
}

// ── Encryption key management ──

export async function setupEncryptionKeys(
  userId: string,
  publicKey: string,
  encryptedPrivateKey: string
) {
  const [updated] = await db
    .update(users)
    .set({
      encryptionPublicKey: publicKey,
      encryptionPrivateKeyEnc: encryptedPrivateKey,
    })
    .where(eq(users.id, userId))
    .returning({
      encryptionPublicKey: users.encryptionPublicKey,
    });
  return updated;
}

export async function getEncryptionKeys(userId: string) {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {
      encryptionPublicKey: true,
      encryptionPrivateKeyEnc: true,
    },
  });
  return user;
}

export async function getUserPublicKey(userId: string) {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {
      encryptionPublicKey: true,
    },
  });
  return user;
}
