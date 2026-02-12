import type { FastifyInstance } from "fastify";
import { registerSchema, loginSchema } from "@fediplus/shared";
import { registerUser, loginUser } from "../../services/auth.js";

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/register", async (request, reply) => {
    const input = registerSchema.parse(request.body);
    const result = await registerUser(input);
    return reply.status(201).send(result);
  });

  app.post("/auth/login", async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const result = await loginUser(input);
    return reply.send(result);
  });

  app.post("/auth/logout", async (_request, reply) => {
    // JWT is stateless; client discards token
    return reply.send({ ok: true });
  });
}
