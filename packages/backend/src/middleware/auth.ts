import type { FastifyRequest, FastifyReply } from "fastify";
import jwt from "jsonwebtoken";
import type { StringValue } from "ms";
import { config } from "../config.js";
import { db } from "../db/connection.js";
import { users } from "../db/schema/users.js";
import { eq } from "drizzle-orm";

export interface AuthPayload {
  userId: string;
  username: string;
  role?: string;
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

export function requireRole(...roles: string[]) {
  return async function roleMiddleware(
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    if (!request.user) {
      return reply.status(401).send({ error: "Authentication required" });
    }

    // Fetch fresh role from DB to prevent stale JWT claims
    const [user] = await db
      .select({ role: users.role, status: users.status })
      .from(users)
      .where(eq(users.id, request.user.userId))
      .limit(1);

    if (!user) {
      return reply.status(401).send({ error: "User not found" });
    }

    if (user.status !== "active") {
      return reply.status(403).send({ error: "Account is not active" });
    }

    if (!roles.includes(user.role)) {
      return reply
        .status(403)
        .send({ error: "Insufficient permissions" });
    }

    // Update request with fresh role
    request.user.role = user.role;
  };
}

export function requireAdmin() {
  return requireRole("admin");
}

export function requireModerator() {
  return requireRole("admin", "moderator");
}

export function generateToken(payload: AuthPayload): string {
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiry as StringValue,
  });
}
