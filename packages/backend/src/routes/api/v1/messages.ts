import type { FastifyInstance } from "fastify";
import {
  createConversationSchema,
  sendMessageSchema,
  setupEncryptionSchema,
  uploadKeyPackagesSchema,
  storeGroupStateSchema,
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
  uploadKeyPackages,
  consumeKeyPackage,
  getAvailableKeyPackageCount,
  storeGroupState,
  getGroupState,
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

  // ── MLS Key Packages ──

  // Upload key packages (batch)
  app.post("/api/v1/users/me/key-packages", async (request, reply) => {
    const { packages } = uploadKeyPackagesSchema.parse(request.body);
    const result = await uploadKeyPackages(request.user!.userId, packages);
    return reply.status(201).send(result);
  });

  // Get own available key package count
  app.get("/api/v1/users/me/key-packages/count", async (request) => {
    const count = await getAvailableKeyPackageCount(request.user!.userId);
    return { count };
  });

  // Consume one of a user's key packages (for starting encrypted conversations)
  app.post("/api/v1/users/:id/key-package/consume", async (request, reply) => {
    const { id } = request.params as { id: string };
    const keyPackage = await consumeKeyPackage(id);
    if (!keyPackage) {
      return reply
        .status(404)
        .send({ error: "No key packages available for this user" });
    }
    return keyPackage;
  });

  // ── MLS Group State ──

  // Store group state for a conversation member
  app.post(
    "/api/v1/conversations/:id/group-state",
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const input = storeGroupStateSchema.parse(request.body);
      const state = await storeGroupState(
        id,
        request.user!.userId,
        input.epoch,
        input.encryptedState,
        input.initiatorId,
        input.keyPackageId
      );
      return reply.status(201).send(state);
    }
  );

  // Store group state for an arbitrary user in the conversation (initiator stores for recipient)
  app.post(
    "/api/v1/conversations/:id/group-state/:userId",
    async (request, reply) => {
      const { id, userId } = request.params as { id: string; userId: string };
      const input = storeGroupStateSchema.parse(request.body);
      const state = await storeGroupState(
        id,
        userId,
        input.epoch,
        input.encryptedState,
        input.initiatorId,
        input.keyPackageId
      );
      return reply.status(201).send(state);
    }
  );

  // Get own group state for a conversation
  app.get("/api/v1/conversations/:id/group-state", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { epoch } = (request.query as { epoch?: string }) ?? {};
    const state = await getGroupState(
      id,
      request.user!.userId,
      epoch !== undefined ? Number(epoch) : undefined
    );
    if (!state) {
      return reply
        .status(404)
        .send({ error: "No group state found for this conversation" });
    }
    return state;
  });
}
