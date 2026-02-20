import type { FastifyInstance } from "fastify";
import {
  createConversationSchema,
  sendMessageSchema,
  setupEncryptionSchema,
  cursorPaginationSchema,
} from "@fediplus/shared";
import { authMiddleware } from "../../../middleware/auth.js";
import {
  createConversation,
  getConversations,
  getConversation,
  sendMessage,
  getMessages,
  markConversationRead,
  setupEncryptionKeys,
  getEncryptionKeys,
  getUserPublicKey,
} from "../../../services/messages.js";

export async function messageRoutes(app: FastifyInstance) {
  // All message routes require auth
  app.addHook("preHandler", authMiddleware);

  // List conversations
  app.get("/api/v1/conversations", async (request) => {
    const { cursor, limit } = cursorPaginationSchema.parse(request.query);
    return getConversations(request.user!.userId, cursor, limit);
  });

  // Create conversation
  app.post("/api/v1/conversations", async (request, reply) => {
    const { participantIds } = createConversationSchema.parse(request.body);
    const conversation = await createConversation(
      request.user!.userId,
      participantIds
    );
    return reply.status(201).send(conversation);
  });

  // Get conversation with participants
  app.get("/api/v1/conversations/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const conversation = await getConversation(id, request.user!.userId);
    if (!conversation) {
      return reply.status(404).send({ error: "Conversation not found" });
    }
    return conversation;
  });

  // Get messages in conversation
  app.get("/api/v1/conversations/:id/messages", async (request) => {
    const { id } = request.params as { id: string };
    const { cursor, limit } = cursorPaginationSchema.parse(request.query);
    return getMessages(id, request.user!.userId, cursor, limit);
  });

  // Send message
  app.post("/api/v1/conversations/:id/messages", async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = sendMessageSchema.parse(request.body);
    const message = await sendMessage(id, request.user!.userId, input);
    return reply.status(201).send(message);
  });

  // Mark conversation as read
  app.post("/api/v1/conversations/:id/read", async (request) => {
    const { id } = request.params as { id: string };
    return markConversationRead(id, request.user!.userId);
  });

  // ── Encryption key management ──

  // Upload encryption keys
  app.put("/api/v1/users/me/encryption-keys", async (request) => {
    const { encryptionPublicKey, encryptionPrivateKeyEnc } =
      setupEncryptionSchema.parse(request.body);
    return setupEncryptionKeys(
      request.user!.userId,
      encryptionPublicKey,
      encryptionPrivateKeyEnc
    );
  });

  // Get own encrypted private key (for recovery)
  app.get("/api/v1/users/me/encryption-keys", async (request, reply) => {
    const keys = await getEncryptionKeys(request.user!.userId);
    if (!keys) {
      return reply.status(404).send({ error: "User not found" });
    }
    return keys;
  });

  // Get another user's public encryption key
  app.get("/api/v1/users/:id/encryption-key", async (request, reply) => {
    const { id } = request.params as { id: string };
    const key = await getUserPublicKey(id);
    if (!key) {
      return reply.status(404).send({ error: "User not found" });
    }
    return key;
  });
}
