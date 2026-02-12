import type { FastifyInstance } from "fastify";
import { createPostSchema, cursorPaginationSchema } from "@fediplus/shared";
import { authMiddleware } from "../../../middleware/auth.js";
import {
  createPost,
  getPost,
  getTimeline,
  addReaction,
  removeReaction,
  deletePost,
} from "../../../services/posts.js";

export async function postRoutes(app: FastifyInstance) {
  app.get("/api/v1/timeline", { preHandler: [authMiddleware] }, async (request) => {
    const { cursor, limit } = cursorPaginationSchema.parse(request.query);
    return getTimeline(request.user!.userId, cursor, limit);
  });

  app.get("/api/v1/posts/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const post = await getPost(id);
    if (!post) {
      return reply.status(404).send({ error: "Post not found" });
    }
    return post;
  });

  app.post(
    "/api/v1/posts",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const input = createPostSchema.parse(request.body);
      const post = await createPost(request.user!.userId, input);
      return reply.status(201).send(post);
    }
  );

  app.delete(
    "/api/v1/posts/:id",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const deleted = await deletePost(id, request.user!.userId);
      if (!deleted) {
        return reply.status(404).send({ error: "Post not found" });
      }
      return { ok: true };
    }
  );

  app.post(
    "/api/v1/posts/:id/reactions",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const reaction = await addReaction(id, request.user!.userId);
      return reply.status(201).send(reaction);
    }
  );

  app.delete(
    "/api/v1/posts/:id/reactions",
    { preHandler: [authMiddleware] },
    async (request) => {
      const { id } = request.params as { id: string };
      await removeReaction(id, request.user!.userId);
      return { ok: true };
    }
  );
}
