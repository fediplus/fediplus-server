import type { FastifyInstance } from "fastify";
import {
  createHangoutSchema,
  startStreamSchema,
  updateMediaStateSchema,
  cursorPaginationSchema,
} from "@fediplus/shared";
import { authMiddleware } from "../../../middleware/auth.js";
import {
  createHangout,
  getHangout,
  listActiveHangouts,
  getUserHangouts,
  joinHangout,
  leaveHangout,
  endHangout,
  updateMediaState,
  startStream,
  stopStream,
} from "../../../services/hangouts.js";

export async function hangoutRoutes(app: FastifyInstance) {
  // List active public hangouts
  app.get("/api/v1/hangouts", async (request) => {
    const { cursor, limit } = cursorPaginationSchema.parse(request.query);
    return listActiveHangouts(cursor, limit);
  });

  // My hangouts
  app.get(
    "/api/v1/hangouts/mine",
    { preHandler: [authMiddleware] },
    async (request) => {
      return getUserHangouts(request.user!.userId);
    }
  );

  // Get hangout details
  app.get("/api/v1/hangouts/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const hangout = await getHangout(id);
    if (!hangout) {
      return reply.status(404).send({ error: "Hangout not found" });
    }
    return hangout;
  });

  // Create hangout
  app.post(
    "/api/v1/hangouts",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const input = createHangoutSchema.parse(request.body);
      const hangout = await createHangout(request.user!.userId, input);
      return reply.status(201).send(hangout);
    }
  );

  // Join hangout
  app.post(
    "/api/v1/hangouts/:id/join",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const participant = await joinHangout(id, request.user!.userId);
      if (!participant) {
        return reply.status(404).send({ error: "Hangout not found" });
      }
      return participant;
    }
  );

  // Leave hangout
  app.post(
    "/api/v1/hangouts/:id/leave",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const left = await leaveHangout(id, request.user!.userId);
      if (!left) {
        return reply.status(404).send({ error: "Hangout not found" });
      }
      return { ok: true };
    }
  );

  // End hangout (creator only)
  app.delete(
    "/api/v1/hangouts/:id",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const ended = await endHangout(id, request.user!.userId);
      if (!ended) {
        return reply.status(404).send({ error: "Hangout not found" });
      }
      return { ok: true };
    }
  );

  // Update media state
  app.patch(
    "/api/v1/hangouts/:id/media",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const input = updateMediaStateSchema.parse(request.body);
      const updated = await updateMediaState(
        id,
        request.user!.userId,
        input
      );
      if (!updated) {
        return reply.status(404).send({ error: "Participant not found" });
      }
      return updated;
    }
  );

  // Start RTMP stream (creator only)
  app.post(
    "/api/v1/hangouts/:id/stream",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { rtmpUrl } = startStreamSchema.parse(request.body);
      const result = await startStream(id, request.user!.userId, rtmpUrl);
      if (!result) {
        return reply.status(404).send({ error: "Hangout not found" });
      }
      return result;
    }
  );

  // Stop RTMP stream (creator only)
  app.delete(
    "/api/v1/hangouts/:id/stream",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await stopStream(id, request.user!.userId);
      if (!result) {
        return reply.status(404).send({ error: "Hangout not found" });
      }
      return result;
    }
  );
}
