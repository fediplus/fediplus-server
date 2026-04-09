import type { FastifyInstance } from "fastify";
import {
  createStreamingDestinationSchema,
  updateStreamingDestinationSchema,
} from "@fediplus/shared";
import { authMiddleware } from "../../../middleware/auth.js";
import {
  getStreamingDestinations,
  getStreamingDestination,
  createStreamingDestination,
  updateStreamingDestination,
  deleteStreamingDestination,
} from "../../../services/streaming.js";

export async function streamingDestinationRoutes(app: FastifyInstance) {
  // List user's streaming destinations
  app.get(
    "/api/v1/streaming/destinations",
    { preHandler: [authMiddleware] },
    async (request) => {
      return getStreamingDestinations(request.user!.userId);
    }
  );

  // Get single destination
  app.get(
    "/api/v1/streaming/destinations/:id",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const dest = await getStreamingDestination(id, request.user!.userId);
      if (!dest) {
        return reply.status(404).send({ error: "Destination not found" });
      }
      return dest;
    }
  );

  // Create destination
  app.post(
    "/api/v1/streaming/destinations",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const input = createStreamingDestinationSchema.parse(request.body);
      const dest = await createStreamingDestination(
        request.user!.userId,
        input
      );
      return reply.status(201).send(dest);
    }
  );

  // Update destination
  app.patch(
    "/api/v1/streaming/destinations/:id",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const input = updateStreamingDestinationSchema.parse(request.body);
      const dest = await updateStreamingDestination(
        id,
        request.user!.userId,
        input
      );
      if (!dest) {
        return reply.status(404).send({ error: "Destination not found" });
      }
      return dest;
    }
  );

  // Delete destination
  app.delete(
    "/api/v1/streaming/destinations/:id",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const deleted = await deleteStreamingDestination(
        id,
        request.user!.userId
      );
      if (!deleted) {
        return reply.status(404).send({ error: "Destination not found" });
      }
      return { ok: true };
    }
  );
}
