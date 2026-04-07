import type { FastifyInstance } from "fastify";
import {
  adminSearchUsersSchema,
  adminListReportsSchema,
  adminListAuditLogSchema,
  createReportSchema,
  resolveReportSchema,
  assignReportSchema,
  createAppealSchema,
  resolveAppealSchema,
  adminUpdateUserSchema,
  issueWarningSchema,
  domainBlockSchema,
  updateDomainBlockSchema,
  ipBlockSchema,
  adminSettingsSchema,
  cursorPaginationSchema,
} from "@fediplus/shared";
import {
  authMiddleware,
  requireAdmin,
  requireModerator,
} from "../../../middleware/auth.js";
import { reportRateLimitMiddleware } from "../../../middleware/rate-limit.js";
import {
  createReport,
  getReport,
  listReports,
  assignReport,
  resolveReport,
  suspendUser,
  unsuspendUser,
  silenceUser,
  unsilenceUser,
  disableUser,
  enableUser,
  updateUserRole,
  updateUserPermissions,
  updateAdminNote,
  sensitizeUser,
  issueWarning,
  getWarnings,
  createAppeal,
  resolveAppeal,
  listAppeals,
  deletePostByAdmin,
  markPostSensitive,
  createDomainBlock,
  updateDomainBlock,
  removeDomainBlock,
  listDomainBlocks,
  createIpBlock,
  removeIpBlock,
  listIpBlocks,
  getSetting,
  getPublicSettings,
  getAllSettings,
  upsertSetting,
  adminSearchUsers,
  adminGetUser,
  getAuditLogs,
  getDashboardMetrics,
} from "../../../services/admin.js";

export async function reportRoutes(app: FastifyInstance) {
  // ── User-facing: File a report ──
  app.post(
    "/api/v1/reports",
    { preHandler: [authMiddleware, reportRateLimitMiddleware()] },
    async (request) => {
      const data = createReportSchema.parse(request.body);
      return createReport(request.user!.userId, data);
    }
  );

  // ── User-facing: File an appeal ──
  app.post(
    "/api/v1/reports/:id/appeal",
    { preHandler: [authMiddleware] },
    async (request) => {
      const { id } = request.params as { id: string };
      const { text } = createAppealSchema.parse(request.body);
      return createAppeal(id, request.user!.userId, text);
    }
  );
}

export async function adminRoutes(app: FastifyInstance) {
  // All admin routes require auth + moderator/admin role
  const modGuard = [authMiddleware, requireModerator()];
  const adminGuard = [authMiddleware, requireAdmin()];

  // ── Dashboard ──
  app.get(
    "/api/v1/admin/dashboard",
    { preHandler: modGuard },
    async () => {
      return getDashboardMetrics();
    }
  );

  // ── Reports Management ──
  app.get(
    "/api/v1/admin/reports",
    { preHandler: modGuard },
    async (request) => {
      const opts = adminListReportsSchema.parse(request.query);
      return listReports({
        ...opts,
        assignedToMe: opts.assignedToMe ? request.user!.userId : undefined,
      });
    }
  );

  app.get(
    "/api/v1/admin/reports/:id",
    { preHandler: modGuard },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const report = await getReport(id);
      if (!report) return reply.status(404).send({ error: "Report not found" });
      return report;
    }
  );

  app.post(
    "/api/v1/admin/reports/:id/assign",
    { preHandler: modGuard },
    async (request) => {
      const { id } = request.params as { id: string };
      const { moderatorId } = assignReportSchema.parse(request.body);
      return assignReport(id, moderatorId);
    }
  );

  app.post(
    "/api/v1/admin/reports/:id/resolve",
    { preHandler: modGuard },
    async (request) => {
      const { id } = request.params as { id: string };
      const { action, note } = resolveReportSchema.parse(request.body);
      return resolveReport(id, request.user!.userId, action, note);
    }
  );

  // ── Appeals Management ──
  app.get(
    "/api/v1/admin/appeals",
    { preHandler: modGuard },
    async (request) => {
      const { cursor, limit } = cursorPaginationSchema.parse(request.query);
      return listAppeals({ cursor, limit });
    }
  );

  app.post(
    "/api/v1/admin/appeals/:id/resolve",
    { preHandler: modGuard },
    async (request) => {
      const { id } = request.params as { id: string };
      const { action } = resolveAppealSchema.parse(request.body);
      return resolveAppeal(id, request.user!.userId, action);
    }
  );

  // ── User Management ──
  app.get(
    "/api/v1/admin/users",
    { preHandler: modGuard },
    async (request) => {
      return adminSearchUsers(adminSearchUsersSchema.parse(request.query));
    }
  );

  app.get(
    "/api/v1/admin/users/:id",
    { preHandler: modGuard },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const user = await adminGetUser(id);
      if (!user) return reply.status(404).send({ error: "User not found" });
      return user;
    }
  );

  app.patch(
    "/api/v1/admin/users/:id",
    { preHandler: adminGuard },
    async (request) => {
      const { id } = request.params as { id: string };
      const data = adminUpdateUserSchema.parse(request.body);
      const modId = request.user!.userId;

      if (data.role !== undefined) {
        await updateUserRole(id, modId, data.role);
      }
      if (data.permissions) {
        await updateUserPermissions(id, modId, data.permissions);
      }
      if (data.note !== undefined) {
        await updateAdminNote(id, modId, data.note);
      }
      if (data.sensitized !== undefined) {
        await sensitizeUser(id, modId, data.sensitized);
      }
      if (data.silenced !== undefined) {
        if (data.silenced) await silenceUser(id, modId);
        else await unsilenceUser(id, modId);
      }
      if (data.status !== undefined) {
        if (data.status === "suspended") await suspendUser(id, modId);
        else if (data.status === "disabled") await disableUser(id, modId);
        else if (data.status === "active") await enableUser(id, modId);
      }

      return adminGetUser(id);
    }
  );

  app.post(
    "/api/v1/admin/users/:id/suspend",
    { preHandler: modGuard },
    async (request) => {
      const { id } = request.params as { id: string };
      return suspendUser(id, request.user!.userId);
    }
  );

  app.post(
    "/api/v1/admin/users/:id/unsuspend",
    { preHandler: modGuard },
    async (request) => {
      const { id } = request.params as { id: string };
      return unsuspendUser(id, request.user!.userId);
    }
  );

  app.post(
    "/api/v1/admin/users/:id/silence",
    { preHandler: modGuard },
    async (request) => {
      const { id } = request.params as { id: string };
      return silenceUser(id, request.user!.userId);
    }
  );

  app.post(
    "/api/v1/admin/users/:id/unsilence",
    { preHandler: modGuard },
    async (request) => {
      const { id } = request.params as { id: string };
      return unsilenceUser(id, request.user!.userId);
    }
  );

  app.post(
    "/api/v1/admin/users/:id/warn",
    { preHandler: modGuard },
    async (request) => {
      const { id } = request.params as { id: string };
      const data = issueWarningSchema.parse(request.body);
      return issueWarning(
        id,
        request.user!.userId,
        data.action,
        data.text,
        data.reportId
      );
    }
  );

  app.get(
    "/api/v1/admin/users/:id/warnings",
    { preHandler: modGuard },
    async (request) => {
      const { id } = request.params as { id: string };
      return getWarnings(id);
    }
  );

  // ── Content Moderation ──
  app.delete(
    "/api/v1/admin/posts/:id",
    { preHandler: modGuard },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      await deletePostByAdmin(id, request.user!.userId);
      return reply.status(204).send();
    }
  );

  app.post(
    "/api/v1/admin/posts/:id/sensitive",
    { preHandler: modGuard },
    async (request) => {
      const { id } = request.params as { id: string };
      return markPostSensitive(id, request.user!.userId);
    }
  );

  // ── Domain Blocks ──
  app.get(
    "/api/v1/admin/domain-blocks",
    { preHandler: modGuard },
    async (request) => {
      const { cursor, limit } = cursorPaginationSchema.parse(request.query);
      return listDomainBlocks({ cursor, limit });
    }
  );

  app.post(
    "/api/v1/admin/domain-blocks",
    { preHandler: adminGuard },
    async (request) => {
      const data = domainBlockSchema.parse(request.body);
      return createDomainBlock(request.user!.userId, data);
    }
  );

  app.patch(
    "/api/v1/admin/domain-blocks/:id",
    { preHandler: adminGuard },
    async (request) => {
      const { id } = request.params as { id: string };
      const data = updateDomainBlockSchema.parse(request.body);
      return updateDomainBlock(id, request.user!.userId, data);
    }
  );

  app.delete(
    "/api/v1/admin/domain-blocks/:id",
    { preHandler: adminGuard },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      await removeDomainBlock(id, request.user!.userId);
      return reply.status(204).send();
    }
  );

  // ── IP Blocks ──
  app.get(
    "/api/v1/admin/ip-blocks",
    { preHandler: adminGuard },
    async (request) => {
      const { cursor, limit } = cursorPaginationSchema.parse(request.query);
      return listIpBlocks({ cursor, limit });
    }
  );

  app.post(
    "/api/v1/admin/ip-blocks",
    { preHandler: adminGuard },
    async (request) => {
      const data = ipBlockSchema.parse(request.body);
      return createIpBlock(request.user!.userId, data);
    }
  );

  app.delete(
    "/api/v1/admin/ip-blocks/:id",
    { preHandler: adminGuard },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      await removeIpBlock(id, request.user!.userId);
      return reply.status(204).send();
    }
  );

  // ── Admin Settings ──
  app.get(
    "/api/v1/admin/settings",
    { preHandler: adminGuard },
    async () => {
      return getAllSettings();
    }
  );

  app.put(
    "/api/v1/admin/settings",
    { preHandler: adminGuard },
    async (request) => {
      const data = adminSettingsSchema.parse(request.body);
      return upsertSetting(
        request.user!.userId,
        data.key,
        data.value,
        data.type,
        data.isPublic
      );
    }
  );

  // ── Audit Log ──
  app.get(
    "/api/v1/admin/audit-log",
    { preHandler: modGuard },
    async (request) => {
      return getAuditLogs(adminListAuditLogSchema.parse(request.query));
    }
  );
}

// Public endpoint for instance-level public settings
export async function publicSettingsRoutes(app: FastifyInstance) {
  app.get("/api/v1/instance/settings", async () => {
    return getPublicSettings();
  });
}
