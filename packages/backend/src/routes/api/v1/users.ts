import type { FastifyInstance } from "fastify";
import { updateProfileSchema } from "@fediplus/shared";
import { authMiddleware } from "../../../middleware/auth.js";
import {
  getUserByUsername,
  updateProfile,
} from "../../../services/users.js";

export async function userRoutes(app: FastifyInstance) {
  app.get("/api/v1/users/:username", async (request, reply) => {
    const { username } = request.params as { username: string };
    const user = await getUserByUsername(username);
    if (!user) {
      return reply.status(404).send({ error: "User not found" });
    }
    return reply.send(user);
  });

  app.patch(
    "/api/v1/users/:username",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { username } = request.params as { username: string };
      if (request.user!.username !== username) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      const input = updateProfileSchema.parse(request.body);
      const profile = await updateProfile(request.user!.userId, input);
      return reply.send(profile);
    }
  );
}
