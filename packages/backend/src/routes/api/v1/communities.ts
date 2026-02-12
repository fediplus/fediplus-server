import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { cursorPaginationSchema } from "@fediplus/shared";
import { authMiddleware } from "../../../middleware/auth.js";
import {
  createCommunity,
  getCommunity,
  listCommunities,
  getUserCommunities,
  updateCommunity,
  deleteCommunity,
  joinCommunity,
  leaveCommunity,
  approveMember,
  setMemberRole,
  getCommunityMembers,
  getCommunityPosts,
} from "../../../services/communities.js";

const createCommunitySchema = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
  description: z.string().max(2000).optional(),
  visibility: z.enum(["public", "private"]).optional(),
  postApproval: z.boolean().optional(),
});

const updateCommunitySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(2000).optional(),
  visibility: z.enum(["public", "private"]).optional(),
  postApproval: z.boolean().optional(),
});

const setRoleSchema = z.object({
  role: z.enum(["moderator", "member"]),
});

export async function communityRoutes(app: FastifyInstance) {
  // Discover communities
  app.get("/api/v1/communities", async (request) => {
    const { cursor, limit } = cursorPaginationSchema.parse(request.query);
    return listCommunities(cursor, limit);
  });

  // My communities
  app.get(
    "/api/v1/communities/mine",
    { preHandler: [authMiddleware] },
    async (request) => {
      return getUserCommunities(request.user!.userId);
    }
  );

  // Get community
  app.get("/api/v1/communities/:slug", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const community = await getCommunity(slug);
    if (!community) {
      return reply.status(404).send({ error: "Community not found" });
    }
    return community;
  });

  // Create community
  app.post(
    "/api/v1/communities",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const input = createCommunitySchema.parse(request.body);
      const community = await createCommunity(request.user!.userId, input);
      return reply.status(201).send(community);
    }
  );

  // Update community
  app.patch(
    "/api/v1/communities/:slug",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const input = updateCommunitySchema.parse(request.body);
      const community = await updateCommunity(slug, request.user!.userId, input);
      if (!community) {
        return reply.status(404).send({ error: "Community not found" });
      }
      return community;
    }
  );

  // Delete community
  app.delete(
    "/api/v1/communities/:slug",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const deleted = await deleteCommunity(slug, request.user!.userId);
      if (!deleted) {
        return reply.status(404).send({ error: "Community not found" });
      }
      return { ok: true };
    }
  );

  // Join community
  app.post(
    "/api/v1/communities/:slug/join",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const member = await joinCommunity(slug, request.user!.userId);
      if (!member) {
        return reply.status(404).send({ error: "Community not found" });
      }
      return reply.status(201).send(member);
    }
  );

  // Leave community
  app.post(
    "/api/v1/communities/:slug/leave",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const left = await leaveCommunity(slug, request.user!.userId);
      if (!left) {
        return reply.status(404).send({ error: "Community not found" });
      }
      return { ok: true };
    }
  );

  // Members
  app.get("/api/v1/communities/:slug/members", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const members = await getCommunityMembers(slug);
    if (!members) {
      return reply.status(404).send({ error: "Community not found" });
    }
    return members;
  });

  // Approve member (private communities)
  app.post(
    "/api/v1/communities/:slug/members/:memberId/approve",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { slug, memberId } = request.params as {
        slug: string;
        memberId: string;
      };
      const member = await approveMember(slug, memberId, request.user!.userId);
      if (!member) {
        return reply.status(404).send({ error: "Community not found" });
      }
      return member;
    }
  );

  // Set member role
  app.patch(
    "/api/v1/communities/:slug/members/:memberId/role",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { slug, memberId } = request.params as {
        slug: string;
        memberId: string;
      };
      const { role } = setRoleSchema.parse(request.body);
      const member = await setMemberRole(
        slug,
        memberId,
        role,
        request.user!.userId
      );
      if (!member) {
        return reply.status(404).send({ error: "Community not found" });
      }
      return member;
    }
  );

  // Community posts
  app.get("/api/v1/communities/:slug/posts", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const { cursor, limit } = cursorPaginationSchema.parse(request.query);
    const userId =
      request.user?.userId ?? "00000000-0000-0000-0000-000000000000";
    const result = await getCommunityPosts(slug, userId, cursor, limit);
    if (!result) {
      return reply.status(404).send({ error: "Community not found" });
    }
    return result;
  });
}
