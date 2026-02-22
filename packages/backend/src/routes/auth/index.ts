import type { FastifyInstance } from "fastify";
import { registerSchema, loginSchema } from "@fediplus/shared";
import {
  registerUser,
  loginUser,
  deleteAccount,
  verifyEmail,
  requestPasswordReset,
  resetPassword,
  resendVerification,
} from "../../services/auth.js";
import { authMiddleware } from "../../middleware/auth.js";

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

  app.post("/auth/verify-email", async (request, reply) => {
    const { token } = request.body as { token: string };
    if (!token) {
      return reply.status(400).send({ error: "Token is required" });
    }
    const result = await verifyEmail(token);
    return reply.send(result);
  });

  app.post("/auth/forgot-password", async (request, reply) => {
    const { email } = request.body as { email: string };
    if (!email) {
      return reply.status(400).send({ error: "Email is required" });
    }
    const result = await requestPasswordReset(email);
    return reply.send(result);
  });

  app.post("/auth/reset-password", async (request, reply) => {
    const { token, password } = request.body as {
      token: string;
      password: string;
    };
    if (!token || !password) {
      return reply
        .status(400)
        .send({ error: "Token and password are required" });
    }
    const result = await resetPassword(token, password);
    return reply.send(result);
  });

  app.post("/auth/resend-verification", async (request, reply) => {
    const { email } = request.body as { email: string };
    if (!email) {
      return reply.status(400).send({ error: "Email is required" });
    }
    const result = await resendVerification(email);
    return reply.send(result);
  });

  app.post(
    "/api/v1/account/delete",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { password } = request.body as { password: string };
      if (!password) {
        return reply.status(400).send({ error: "Password is required" });
      }
      await deleteAccount(request.user!.userId, password);
      return reply.send({ ok: true });
    }
  );
}
