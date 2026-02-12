import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { cursorPaginationSchema } from "@fediplus/shared";
import { authMiddleware } from "../../../middleware/auth.js";
import {
  createCollection,
  getCollection,
  getUserCollections,
  updateCollection,
  deleteCollection,
  addItem,
  removeItem,
  getCollectionItems,
} from "../../../services/collections.js";

const createCollectionSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(2000).optional(),
  isPublic: z.boolean().optional(),
});

const updateCollectionSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(2000).optional(),
  isPublic: z.boolean().optional(),
});

const addItemSchema = z.object({
  postId: z.string().uuid(),
});

export async function collectionRoutes(app: FastifyInstance) {
  // User's collections
  app.get("/api/v1/users/:username/collections", async (request) => {
    const { username } = request.params as { username: string };
    return getUserCollections(username, request.user?.userId);
  });

  // Get collection
  app.get("/api/v1/collections/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const collection = await getCollection(id, request.user?.userId);
    if (!collection) {
      return reply.status(404).send({ error: "Collection not found" });
    }
    return collection;
  });

  // Create collection
  app.post(
    "/api/v1/collections",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const input = createCollectionSchema.parse(request.body);
      const collection = await createCollection(request.user!.userId, input);
      return reply.status(201).send(collection);
    }
  );

  // Update collection
  app.patch(
    "/api/v1/collections/:id",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const input = updateCollectionSchema.parse(request.body);
      const collection = await updateCollection(
        id,
        request.user!.userId,
        input
      );
      if (!collection) {
        return reply.status(404).send({ error: "Collection not found" });
      }
      return collection;
    }
  );

  // Delete collection
  app.delete(
    "/api/v1/collections/:id",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const deleted = await deleteCollection(id, request.user!.userId);
      if (!deleted) {
        return reply.status(404).send({ error: "Collection not found" });
      }
      return { ok: true };
    }
  );

  // Collection items
  app.get("/api/v1/collections/:id/items", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { cursor, limit } = cursorPaginationSchema.parse(request.query);
    const result = await getCollectionItems(
      id,
      request.user?.userId,
      cursor,
      limit
    );
    if (!result) {
      return reply.status(404).send({ error: "Collection not found" });
    }
    return result;
  });

  // Add item
  app.post(
    "/api/v1/collections/:id/items",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { postId } = addItemSchema.parse(request.body);
      const item = await addItem(id, request.user!.userId, postId);
      if (!item) {
        return reply.status(404).send({ error: "Collection not found" });
      }
      return reply.status(201).send(item);
    }
  );

  // Remove item
  app.delete(
    "/api/v1/collections/:id/items/:postId",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { id, postId } = request.params as { id: string; postId: string };
      const removed = await removeItem(id, request.user!.userId, postId);
      if (!removed) {
        return reply.status(404).send({ error: "Collection not found" });
      }
      return { ok: true };
    }
  );
}
