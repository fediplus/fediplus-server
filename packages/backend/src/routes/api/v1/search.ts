import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { search } from "../../../services/search.js";

const searchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  type: z
    .enum(["all", "posts", "users", "communities", "hashtags"])
    .default("all"),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function searchRoutes(app: FastifyInstance) {
  app.get("/api/v1/search", async (request, reply) => {
    const query = searchQuerySchema.parse(request.query);

    // Extract current user if authenticated (optional — search is public)
    let currentUserId: string | undefined;
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      try {
        const jwt = await import("jsonwebtoken");
        const { config } = await import("../../../config.js");
        const payload = jwt.default.verify(
          authHeader.slice(7),
          config.jwt.secret
        ) as { userId: string };
        currentUserId = payload.userId;
      } catch {
        // Unauthenticated search is fine
      }
    }

    const results = await search(query.q, {
      type: query.type,
      limit: query.limit,
      offset: query.offset,
      currentUserId,
    });

    return reply.send(results);
  });
}
