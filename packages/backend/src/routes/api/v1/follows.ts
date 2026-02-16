import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../../../middleware/auth.js";
import {
  followUser,
  unfollowUser,
  getFollowers,
  getFollowing,
  blockUser,
  unblockUser,
  getBlocked,
} from "../../../services/follows.js";
import {
  sendFollow,
  sendUndoFollow,
  sendBlock,
} from "../../../federation/outbox.js";

export async function followRoutes(app: FastifyInstance) {
  app.post(
    "/api/v1/users/:id/follow",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const follow = await followUser(request.user!.userId, id);
      sendFollow(request.user!.userId, id, follow.id).catch(() => {});
      return reply.status(201).send(follow);
    }
  );

  app.post(
    "/api/v1/users/:id/unfollow",
    { preHandler: [authMiddleware] },
    async (request) => {
      const { id } = request.params as { id: string };
      sendUndoFollow(request.user!.userId, id).catch(() => {});
      await unfollowUser(request.user!.userId, id);
      return { ok: true };
    }
  );

  app.get("/api/v1/users/:id/followers", async (request) => {
    const { id } = request.params as { id: string };
    return getFollowers(id);
  });

  app.get("/api/v1/users/:id/following", async (request) => {
    const { id } = request.params as { id: string };
    return getFollowing(id);
  });

  app.post(
    "/api/v1/users/:id/block",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const block = await blockUser(request.user!.userId, id);
      sendBlock(request.user!.userId, id).catch(() => {});
      return reply.status(201).send(block);
    }
  );

  app.post(
    "/api/v1/users/:id/unblock",
    { preHandler: [authMiddleware] },
    async (request) => {
      const { id } = request.params as { id: string };
      await unblockUser(request.user!.userId, id);
      return { ok: true };
    }
  );

  app.get(
    "/api/v1/blocks",
    { preHandler: [authMiddleware] },
    async (request) => {
      return getBlocked(request.user!.userId);
    }
  );
}
