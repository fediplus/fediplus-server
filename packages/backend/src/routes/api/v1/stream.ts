import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../../../middleware/auth.js";
import { addClient } from "../../../realtime/sse.js";

export async function streamRoutes(app: FastifyInstance) {
  app.get(
    "/api/v1/sse",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      addClient(request.user!.userId, reply);

      // Keep connection alive with periodic heartbeat
      const heartbeat = setInterval(() => {
        try {
          reply.raw.write(": heartbeat\n\n");
        } catch {
          clearInterval(heartbeat);
        }
      }, 30_000);

      request.raw.on("close", () => {
        clearInterval(heartbeat);
      });

      // Don't end the response — it stays open for SSE
      await new Promise(() => {});
    }
  );
}
