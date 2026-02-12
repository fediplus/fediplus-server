import type { FastifyRequest, FastifyReply } from "fastify";
import jwt from "jsonwebtoken";
import type { StringValue } from "ms";
import { config } from "../config.js";

export interface AuthPayload {
  userId: string;
  username: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthPayload;
  }
}

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return reply.status(401).send({ error: "Missing or invalid token" });
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, config.jwt.secret) as AuthPayload;
    request.user = payload;
  } catch {
    return reply.status(401).send({ error: "Invalid or expired token" });
  }
}

export function generateToken(payload: AuthPayload): string {
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiry as StringValue,
  });
}
