import type { FastifyInstance } from "fastify";
import { createPostSchema, cursorPaginationSchema } from "@fediplus/shared";
import { z } from "zod";
import { authMiddleware } from "../../../middleware/auth.js";
import {
  createPost,
  getPost,
  getStream,
  getHashtagStream,
  getComments,
  getUserPosts,
  editPost,
  resharePost,
  unresharePost,
  addReaction,
  removeReaction,
  deletePost,
} from "../../../services/posts.js";
import {
  sendCreateNote,
  sendUpdateNote,
  sendDeleteNote,
  sendLike,
  sendUndoLike,
  sendAnnounce,
} from "../../../federation/outbox.js";

const streamQuerySchema = cursorPaginationSchema.extend({
  circleId: z.string().uuid().optional(),
});

const editPostSchema = z.object({
  content: z.string().min(1).max(5000),
});

export async function postRoutes(app: FastifyInstance) {
  // Stream
  app.get(
    "/api/v1/stream",
    { preHandler: [authMiddleware] },
    async (request) => {
      const { cursor, limit, circleId } = streamQuerySchema.parse(
        request.query
      );
      return getStream(request.user!.userId, { cursor, limit, circleId });
    }
  );

  // Hashtag stream
  app.get("/api/v1/hashtags/:tag/stream", async (request, reply) => {
    const { tag } = request.params as { tag: string };
    const { cursor, limit } = cursorPaginationSchema.parse(request.query);
    // Allow unauthenticated access to public hashtag streams
    const userId = request.user?.userId ?? "00000000-0000-0000-0000-000000000000";
    return getHashtagStream(tag, userId, cursor, limit);
  });

  // User posts
  app.get("/api/v1/users/:username/posts", async (request) => {
    const { username } = request.params as { username: string };
    const { cursor, limit } = cursorPaginationSchema.parse(request.query);
    const userId = request.user?.userId ?? "00000000-0000-0000-0000-000000000000";
    return getUserPosts(username, userId, cursor, limit);
  });

  // Single post
  app.get("/api/v1/posts/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const post = await getPost(id, request.user?.userId);
    if (!post) {
      return reply.status(404).send({ error: "Post not found" });
    }
    return post;
  });

  // Comments for a post
  app.get("/api/v1/posts/:id/comments", async (request) => {
    const { id } = request.params as { id: string };
    const { cursor, limit } = cursorPaginationSchema.parse(request.query);
    const userId = request.user?.userId ?? "00000000-0000-0000-0000-000000000000";
    return getComments(id, userId, cursor, limit);
  });

  // Create post (or comment via replyToId)
  app.post(
    "/api/v1/posts",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const input = createPostSchema.parse(request.body);
      const post = await createPost(request.user!.userId, input);
      // Send AP activity for public posts
      if (input.visibility === "public" || input.visibility === "followers") {
        sendCreateNote(request.user!.userId, {
          id: post.id,
          content: post.content,
          apId: post.apId,
          createdAt: post.createdAt,
        }).catch(() => {});
      }
      return reply.status(201).send(post);
    }
  );

  // Edit post
  app.patch(
    "/api/v1/posts/:id",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { content } = editPostSchema.parse(request.body);
      const post = await editPost(id, request.user!.userId, content);
      if (!post) {
        return reply.status(404).send({ error: "Post not found" });
      }
      sendUpdateNote(request.user!.userId, {
        id: post.id,
        content: post.content,
        apId: post.apId,
        updatedAt: post.updatedAt,
      }).catch(() => {});
      return post;
    }
  );

  // Delete post
  app.delete(
    "/api/v1/posts/:id",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const deletedPost = await deletePost(id, request.user!.userId);
      if (!deletedPost) {
        return reply.status(404).send({ error: "Post not found" });
      }
      if (deletedPost.apId) {
        sendDeleteNote(request.user!.userId, deletedPost.apId).catch(() => {});
      }
      return { ok: true };
    }
  );

  // +1 Reaction
  app.post(
    "/api/v1/posts/:id/reactions",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const reaction = await addReaction(id, request.user!.userId);
      if (!reaction) {
        return reply.status(404).send({ error: "Post not found" });
      }
      sendLike(request.user!.userId, id).catch(() => {});
      return reply.status(201).send(reaction);
    }
  );

  app.delete(
    "/api/v1/posts/:id/reactions",
    { preHandler: [authMiddleware] },
    async (request) => {
      const { id } = request.params as { id: string };
      await removeReaction(id, request.user!.userId);
      sendUndoLike(request.user!.userId, id).catch(() => {});
      return { ok: true };
    }
  );

  // Reshare
  app.post(
    "/api/v1/posts/:id/reshare",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const reshare = await resharePost(request.user!.userId, id);
      if (!reshare) {
        return reply.status(404).send({ error: "Post not found" });
      }
      sendAnnounce(request.user!.userId, id, reshare.id).catch(() => {});
      return reply.status(201).send(reshare);
    }
  );

  app.delete(
    "/api/v1/posts/:id/reshare",
    { preHandler: [authMiddleware] },
    async (request) => {
      const { id } = request.params as { id: string };
      await unresharePost(request.user!.userId, id);
      return { ok: true };
    }
  );
}
