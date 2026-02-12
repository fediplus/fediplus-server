import type { FastifyInstance } from "fastify";
import { cursorPaginationSchema } from "@fediplus/shared";
import { authMiddleware } from "../../../middleware/auth.js";
import {
  getNotifications,
  markNotificationRead,
  markAllRead,
  getUnreadCount,
} from "../../../services/notifications.js";

export async function notificationRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);

  app.get("/api/v1/notifications", async (request) => {
    const { cursor, limit } = cursorPaginationSchema.parse(request.query);
    return getNotifications(request.user!.userId, cursor, limit);
  });

  app.get("/api/v1/notifications/unread-count", async (request) => {
    const count = await getUnreadCount(request.user!.userId);
    return { count };
  });

  app.post("/api/v1/notifications/:id/read", async (request) => {
    const { id } = request.params as { id: string };
    await markNotificationRead(id, request.user!.userId);
    return { ok: true };
  });

  app.post("/api/v1/notifications/read-all", async (request) => {
    await markAllRead(request.user!.userId);
    return { ok: true };
  });
}
