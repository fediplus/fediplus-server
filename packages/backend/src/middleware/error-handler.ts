import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

export function errorHandler(
  error: FastifyError,
  _request: FastifyRequest,
  reply: FastifyReply
) {
  if (error instanceof ZodError) {
    return reply.status(400).send({
      error: "Validation error",
      details: error.errors.map((e) => ({
        path: e.path.join("."),
        message: e.message,
      })),
    });
  }

  const statusCode = error.statusCode ?? 500;
  const message =
    statusCode >= 500 ? "Internal server error" : error.message;

  if (statusCode >= 500) {
    console.error("Server error:", error);
  }

  return reply.status(statusCode).send({ error: message });
}
