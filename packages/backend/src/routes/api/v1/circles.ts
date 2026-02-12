import type { FastifyInstance } from "fastify";
import {
  createCircleSchema,
  updateCircleSchema,
  addCircleMembersSchema,
} from "@fediplus/shared";
import { authMiddleware } from "../../../middleware/auth.js";
import {
  getCircles,
  getCircle,
  createCircle,
  updateCircle,
  deleteCircle,
  addMembers,
  removeMember,
} from "../../../services/circles.js";

export async function circleRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);

  app.get("/api/v1/circles", async (request) => {
    return getCircles(request.user!.userId);
  });

  app.get("/api/v1/circles/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const circle = await getCircle(id, request.user!.userId);
    if (!circle) {
      return reply.status(404).send({ error: "Circle not found" });
    }
    return circle;
  });

  app.post("/api/v1/circles", async (request, reply) => {
    const input = createCircleSchema.parse(request.body);
    const circle = await createCircle(request.user!.userId, input);
    return reply.status(201).send(circle);
  });

  app.patch("/api/v1/circles/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = updateCircleSchema.parse(request.body);
    const circle = await updateCircle(id, request.user!.userId, input);
    if (!circle) {
      return reply.status(404).send({ error: "Circle not found" });
    }
    return circle;
  });

  app.delete("/api/v1/circles/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const deleted = await deleteCircle(id, request.user!.userId);
    if (!deleted) {
      return reply.status(404).send({ error: "Circle not found" });
    }
    return { ok: true };
  });

  app.post("/api/v1/circles/:id/members", async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = addCircleMembersSchema.parse(request.body);
    const result = await addMembers(id, request.user!.userId, input.memberIds);
    if (!result) {
      return reply.status(404).send({ error: "Circle not found" });
    }
    return { ok: true };
  });

  app.delete(
    "/api/v1/circles/:id/members/:memberId",
    async (request, reply) => {
      const { id, memberId } = request.params as {
        id: string;
        memberId: string;
      };
      const removed = await removeMember(id, request.user!.userId, memberId);
      if (!removed) {
        return reply.status(404).send({ error: "Circle not found" });
      }
      return { ok: true };
    }
  );
}
