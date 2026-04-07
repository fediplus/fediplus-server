import { db } from "../db/connection.js";
import {
  reports,
  appeals,
  userWarnings,
  auditLogs,
  domainBlocks,
  ipBlocks,
  adminSettings,
} from "../db/schema/admin.js";
import { users, profiles } from "../db/schema/users.js";
import { posts } from "../db/schema/posts.js";
import { eq, and, desc, lt, count, sql, ilike, or } from "drizzle-orm";

// ── Audit Logging ──

export async function createAuditLog(
  actorId: string,
  action: typeof auditLogs.$inferInsert["action"],
  targetType: string,
  targetId: string,
  metadata: Record<string, unknown> = {}
) {
  const [log] = await db
    .insert(auditLogs)
    .values({ actorId, action, targetType, targetId, metadata })
    .returning();
  return log;
}

export async function getAuditLogs(opts: {
  actorId?: string;
  action?: typeof auditLogs.$inferInsert["action"];
  cursor?: string;
  limit?: number;
}) {
  const { actorId, action, cursor, limit = 20 } = opts;
  const conditions = [];
  if (actorId) conditions.push(eq(auditLogs.actorId, actorId));
  if (action) conditions.push(eq(auditLogs.action, action));
  if (cursor) conditions.push(lt(auditLogs.createdAt, new Date(cursor)));

  const rows = await db
    .select()
    .from(auditLogs)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    items,
    nextCursor: hasMore
      ? items[items.length - 1].createdAt.toISOString()
      : null,
  };
}

// ── Reports ──

export async function createReport(
  reporterId: string,
  data: {
    targetType: typeof reports.$inferInsert["targetType"];
    targetId: string;
    type: typeof reports.$inferInsert["type"];
    comment?: string;
  }
) {
  // Find the account that owns the target content
  let targetAccountId: string | null = null;
  if (data.targetType === "post" || data.targetType === "comment") {
    const [post] = await db
      .select({ authorId: posts.authorId })
      .from(posts)
      .where(eq(posts.id, data.targetId))
      .limit(1);
    if (post) targetAccountId = post.authorId;
  } else if (data.targetType === "user") {
    targetAccountId = data.targetId;
  }

  const [report] = await db
    .insert(reports)
    .values({
      reporterId,
      targetType: data.targetType,
      targetId: data.targetId,
      targetAccountId,
      type: data.type,
      comment: data.comment ?? "",
    })
    .returning();
  return report;
}

export async function getReport(id: string) {
  const [report] = await db
    .select()
    .from(reports)
    .where(eq(reports.id, id))
    .limit(1);
  return report ?? null;
}

export async function listReports(opts: {
  status?: typeof reports.$inferInsert["status"];
  targetType?: typeof reports.$inferInsert["targetType"];
  assignedToMe?: string;
  cursor?: string;
  limit?: number;
}) {
  const { status, targetType, assignedToMe, cursor, limit = 20 } = opts;
  const conditions = [];
  if (status) conditions.push(eq(reports.status, status));
  if (targetType) conditions.push(eq(reports.targetType, targetType));
  if (assignedToMe) conditions.push(eq(reports.assignedModId, assignedToMe));
  if (cursor) conditions.push(lt(reports.createdAt, new Date(cursor)));

  const rows = await db
    .select()
    .from(reports)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(reports.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    items,
    nextCursor: hasMore
      ? items[items.length - 1].createdAt.toISOString()
      : null,
  };
}

export async function assignReport(reportId: string, moderatorId: string) {
  const [updated] = await db
    .update(reports)
    .set({ assignedModId: moderatorId, updatedAt: new Date() })
    .where(eq(reports.id, reportId))
    .returning();
  return updated;
}

export async function resolveReport(
  reportId: string,
  modId: string,
  action: "dismiss" | "warn" | "silence" | "suspend" | "delete_content",
  note?: string
) {
  const report = await getReport(reportId);
  if (!report) throw Object.assign(new Error("Report not found"), { statusCode: 404 });

  const status = action === "dismiss" ? "dismissed" as const : "resolved" as const;
  const auditAction = action === "dismiss" ? "dismiss_report" as const : "resolve_report" as const;

  const [updated] = await db
    .update(reports)
    .set({
      status,
      resolvedAt: new Date(),
      resolvedById: modId,
      resolutionNote: note ?? null,
      updatedAt: new Date(),
    })
    .where(eq(reports.id, reportId))
    .returning();

  // Execute moderation action if not just dismissing
  if (action !== "dismiss" && report.targetAccountId) {
    if (action === "suspend") {
      await suspendUser(report.targetAccountId, modId, note);
    } else if (action === "silence") {
      await silenceUser(report.targetAccountId, modId);
    } else if (action === "warn") {
      await issueWarning(report.targetAccountId, modId, "warn", note ?? "", reportId);
    } else if (action === "delete_content") {
      if (report.targetType === "post" || report.targetType === "comment") {
        await deletePostByAdmin(report.targetId, modId);
      }
    }
  }

  await createAuditLog(modId, auditAction, "report", reportId, {
    action,
    note,
    previousStatus: report.status,
  });

  return updated;
}

// ── User Moderation ──

export async function suspendUser(
  targetId: string,
  modId: string,
  reason?: string
) {
  const [updated] = await db
    .update(users)
    .set({
      status: "suspended",
      suspendedAt: new Date(),
      suspensionReason: reason ?? null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, targetId))
    .returning();

  await createAuditLog(modId, "suspend", "user", targetId, { reason });
  return updated;
}

export async function unsuspendUser(targetId: string, modId: string) {
  const [updated] = await db
    .update(users)
    .set({
      status: "active",
      suspendedAt: null,
      suspensionReason: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, targetId))
    .returning();

  await createAuditLog(modId, "unsuspend", "user", targetId);
  return updated;
}

export async function silenceUser(targetId: string, modId: string) {
  const [updated] = await db
    .update(users)
    .set({ silenced: true, updatedAt: new Date() })
    .where(eq(users.id, targetId))
    .returning();

  await createAuditLog(modId, "silence", "user", targetId);
  return updated;
}

export async function unsilenceUser(targetId: string, modId: string) {
  const [updated] = await db
    .update(users)
    .set({ silenced: false, updatedAt: new Date() })
    .where(eq(users.id, targetId))
    .returning();

  await createAuditLog(modId, "unsuspend", "user", targetId, {
    action: "unsilence",
  });
  return updated;
}

export async function disableUser(targetId: string, modId: string) {
  const [updated] = await db
    .update(users)
    .set({ status: "disabled", updatedAt: new Date() })
    .where(eq(users.id, targetId))
    .returning();

  await createAuditLog(modId, "disable", "user", targetId);
  return updated;
}

export async function enableUser(targetId: string, modId: string) {
  const [updated] = await db
    .update(users)
    .set({ status: "active", updatedAt: new Date() })
    .where(eq(users.id, targetId))
    .returning();

  await createAuditLog(modId, "enable", "user", targetId);
  return updated;
}

export async function updateUserRole(
  targetId: string,
  modId: string,
  role: string
) {
  const [existing] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, targetId))
    .limit(1);

  const [updated] = await db
    .update(users)
    .set({ role, updatedAt: new Date() })
    .where(eq(users.id, targetId))
    .returning();

  await createAuditLog(modId, "update_role", "user", targetId, {
    oldRole: existing?.role,
    newRole: role,
  });
  return updated;
}

export async function updateUserPermissions(
  targetId: string,
  modId: string,
  permissions: Record<string, boolean>
) {
  const [existing] = await db
    .select({ permissions: users.permissions })
    .from(users)
    .where(eq(users.id, targetId))
    .limit(1);

  const merged = { ...(existing?.permissions as Record<string, boolean>), ...permissions };

  const [updated] = await db
    .update(users)
    .set({ permissions: merged, updatedAt: new Date() })
    .where(eq(users.id, targetId))
    .returning();

  await createAuditLog(modId, "update_permissions", "user", targetId, {
    oldPermissions: existing?.permissions,
    newPermissions: merged,
  });
  return updated;
}

export async function updateAdminNote(
  targetId: string,
  modId: string,
  note: string
) {
  const [updated] = await db
    .update(users)
    .set({ adminNote: note, updatedAt: new Date() })
    .where(eq(users.id, targetId))
    .returning();

  await createAuditLog(modId, "update_notes", "user", targetId, { note });
  return updated;
}

export async function sensitizeUser(
  targetId: string,
  modId: string,
  sensitized: boolean
) {
  const [updated] = await db
    .update(users)
    .set({ sensitized, updatedAt: new Date() })
    .where(eq(users.id, targetId))
    .returning();

  await createAuditLog(modId, "mark_sensitive", "user", targetId, {
    sensitized,
  });
  return updated;
}

// ── Warnings ──

export async function issueWarning(
  targetAccountId: string,
  modId: string,
  action: typeof userWarnings.$inferInsert["action"],
  text: string,
  reportId?: string
) {
  const [warning] = await db
    .insert(userWarnings)
    .values({
      targetAccountId,
      action,
      text,
      reportId: reportId ?? null,
      createdByModId: modId,
    })
    .returning();

  await createAuditLog(modId, "warn", "user", targetAccountId, {
    warningId: warning.id,
    text,
    reportId,
  });
  return warning;
}

export async function getWarnings(targetAccountId: string) {
  return db
    .select()
    .from(userWarnings)
    .where(eq(userWarnings.targetAccountId, targetAccountId))
    .orderBy(desc(userWarnings.createdAt));
}

// ── Appeals ──

export async function createAppeal(
  reportId: string,
  accountId: string,
  text: string
) {
  const report = await getReport(reportId);
  if (!report) throw Object.assign(new Error("Report not found"), { statusCode: 404 });
  if (report.targetAccountId !== accountId) {
    throw Object.assign(new Error("Not authorized"), { statusCode: 403 });
  }

  const [appeal] = await db
    .insert(appeals)
    .values({ reportId, accountId, text })
    .returning();
  return appeal;
}

export async function resolveAppeal(
  appealId: string,
  modId: string,
  action: "approve" | "reject"
) {
  const [appeal] = await db
    .select()
    .from(appeals)
    .where(eq(appeals.id, appealId))
    .limit(1);

  if (!appeal) throw Object.assign(new Error("Appeal not found"), { statusCode: 404 });

  if (action === "approve") {
    const [updated] = await db
      .update(appeals)
      .set({ approvedAt: new Date(), approvedById: modId, updatedAt: new Date() })
      .where(eq(appeals.id, appealId))
      .returning();

    // Undo the suspension/silence on the account
    await unsuspendUser(appeal.accountId, modId);

    return updated;
  } else {
    const [updated] = await db
      .update(appeals)
      .set({ rejectedAt: new Date(), rejectedById: modId, updatedAt: new Date() })
      .where(eq(appeals.id, appealId))
      .returning();
    return updated;
  }
}

export async function listAppeals(opts: { cursor?: string; limit?: number }) {
  const { cursor, limit = 20 } = opts;
  const conditions = [];
  if (cursor) conditions.push(lt(appeals.createdAt, new Date(cursor)));

  // Only pending appeals (no approved/rejected yet)
  conditions.push(sql`${appeals.approvedAt} IS NULL AND ${appeals.rejectedAt} IS NULL`);

  const rows = await db
    .select()
    .from(appeals)
    .where(and(...conditions))
    .orderBy(desc(appeals.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    items,
    nextCursor: hasMore
      ? items[items.length - 1].createdAt.toISOString()
      : null,
  };
}

// ── Content Moderation ──

export async function deletePostByAdmin(postId: string, modId: string) {
  const [post] = await db
    .select({ id: posts.id, authorId: posts.authorId })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1);

  if (!post) throw Object.assign(new Error("Post not found"), { statusCode: 404 });

  await db.delete(posts).where(eq(posts.id, postId));

  await createAuditLog(modId, "delete_post", "post", postId, {
    authorId: post.authorId,
  });
}

export async function markPostSensitive(postId: string, modId: string) {
  const [updated] = await db
    .update(posts)
    .set({ sensitive: true, updatedAt: new Date() })
    .where(eq(posts.id, postId))
    .returning();

  await createAuditLog(modId, "mark_sensitive", "post", postId);
  return updated;
}

// ── Domain Blocks ──

export async function createDomainBlock(
  modId: string,
  data: {
    domain: string;
    severity: typeof domainBlocks.$inferInsert["severity"];
    publicComment?: string;
    privateComment?: string;
    rejectMedia?: boolean;
    rejectReports?: boolean;
    obfuscate?: boolean;
  }
) {
  const [block] = await db
    .insert(domainBlocks)
    .values({
      domain: data.domain.toLowerCase(),
      severity: data.severity,
      publicComment: data.publicComment ?? null,
      privateComment: data.privateComment ?? null,
      rejectMedia: data.rejectMedia ?? false,
      rejectReports: data.rejectReports ?? false,
      obfuscate: data.obfuscate ?? false,
    })
    .returning();

  await createAuditLog(modId, "block_domain", "domain", data.domain, {
    severity: data.severity,
  });
  return block;
}

export async function updateDomainBlock(
  id: string,
  modId: string,
  data: Partial<{
    severity: typeof domainBlocks.$inferInsert["severity"];
    publicComment: string;
    privateComment: string;
    rejectMedia: boolean;
    rejectReports: boolean;
    obfuscate: boolean;
  }>
) {
  const [updated] = await db
    .update(domainBlocks)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(domainBlocks.id, id))
    .returning();

  if (updated) {
    await createAuditLog(modId, "block_domain", "domain", updated.domain, data);
  }
  return updated;
}

export async function removeDomainBlock(id: string, modId: string) {
  const [block] = await db
    .select({ domain: domainBlocks.domain })
    .from(domainBlocks)
    .where(eq(domainBlocks.id, id))
    .limit(1);

  if (!block) throw Object.assign(new Error("Domain block not found"), { statusCode: 404 });

  await db.delete(domainBlocks).where(eq(domainBlocks.id, id));

  await createAuditLog(modId, "unblock_domain", "domain", block.domain);
}

export async function listDomainBlocks(opts: {
  cursor?: string;
  limit?: number;
}) {
  const { cursor, limit = 20 } = opts;
  const conditions = [];
  if (cursor) conditions.push(lt(domainBlocks.createdAt, new Date(cursor)));

  const rows = await db
    .select()
    .from(domainBlocks)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(domainBlocks.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    items,
    nextCursor: hasMore
      ? items[items.length - 1].createdAt.toISOString()
      : null,
  };
}

export async function getDomainBlock(domain: string) {
  const [block] = await db
    .select()
    .from(domainBlocks)
    .where(eq(domainBlocks.domain, domain.toLowerCase()))
    .limit(1);
  return block ?? null;
}

// ── IP Blocks ──

export async function createIpBlock(
  modId: string,
  data: {
    ip: string;
    severity: typeof ipBlocks.$inferInsert["severity"];
    comment?: string;
    expiresAt?: string;
  }
) {
  const [block] = await db
    .insert(ipBlocks)
    .values({
      ip: data.ip,
      severity: data.severity,
      comment: data.comment ?? null,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
    })
    .returning();

  await createAuditLog(modId, "block_domain", "ip", data.ip, {
    severity: data.severity,
  });
  return block;
}

export async function removeIpBlock(id: string, modId: string) {
  const [block] = await db
    .select({ ip: ipBlocks.ip })
    .from(ipBlocks)
    .where(eq(ipBlocks.id, id))
    .limit(1);

  if (!block) throw Object.assign(new Error("IP block not found"), { statusCode: 404 });

  await db.delete(ipBlocks).where(eq(ipBlocks.id, id));

  await createAuditLog(modId, "unblock_domain", "ip", String(block.ip));
}

export async function listIpBlocks(opts: { cursor?: string; limit?: number }) {
  const { cursor, limit = 20 } = opts;
  const conditions = [];
  if (cursor) conditions.push(lt(ipBlocks.createdAt, new Date(cursor)));

  const rows = await db
    .select()
    .from(ipBlocks)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(ipBlocks.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    items,
    nextCursor: hasMore
      ? items[items.length - 1].createdAt.toISOString()
      : null,
  };
}

// ── Admin Settings ──

export async function getSetting(key: string) {
  const [setting] = await db
    .select()
    .from(adminSettings)
    .where(eq(adminSettings.key, key))
    .limit(1);
  return setting ?? null;
}

export async function getPublicSettings() {
  return db
    .select()
    .from(adminSettings)
    .where(eq(adminSettings.isPublic, true));
}

export async function getAllSettings() {
  return db.select().from(adminSettings).orderBy(adminSettings.key);
}

export async function upsertSetting(
  modId: string,
  key: string,
  value: unknown,
  type: string = "string",
  isPublic: boolean = false
) {
  const existing = await getSetting(key);

  if (existing) {
    const [updated] = await db
      .update(adminSettings)
      .set({ value, type, isPublic, updatedBy: modId, updatedAt: new Date() })
      .where(eq(adminSettings.key, key))
      .returning();

    await createAuditLog(modId, "update_settings", "setting", key, {
      oldValue: existing.value,
      newValue: value,
    });
    return updated;
  } else {
    const [created] = await db
      .insert(adminSettings)
      .values({ key, value, type, isPublic, updatedBy: modId })
      .returning();

    await createAuditLog(modId, "update_settings", "setting", key, {
      newValue: value,
    });
    return created;
  }
}

// ── Admin User Search ──

export async function adminSearchUsers(opts: {
  q?: string;
  role?: string;
  status?: string;
  local?: boolean;
  cursor?: string;
  limit?: number;
}) {
  const { q, role, status, local, cursor, limit = 20 } = opts;
  const conditions = [];

  if (q) {
    conditions.push(
      or(
        ilike(users.username, `%${q}%`),
        ilike(users.email, `%${q}%`)
      )
    );
  }
  if (role) conditions.push(eq(users.role, role));
  if (status) conditions.push(eq(users.status, status));
  if (local !== undefined) conditions.push(eq(users.isLocal, local));
  if (cursor) conditions.push(lt(users.createdAt, new Date(cursor)));

  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      email: users.email,
      role: users.role,
      status: users.status,
      silenced: users.silenced,
      sensitized: users.sensitized,
      permissions: users.permissions,
      isLocal: users.isLocal,
      domain: users.domain,
      adminNote: users.adminNote,
      suspendedAt: users.suspendedAt,
      createdAt: users.createdAt,
      displayName: profiles.displayName,
      avatarUrl: profiles.avatarUrl,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(users.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    items,
    nextCursor: hasMore
      ? items[items.length - 1].createdAt.toISOString()
      : null,
  };
}

export async function adminGetUser(userId: string) {
  const [user] = await db
    .select({
      id: users.id,
      username: users.username,
      email: users.email,
      role: users.role,
      status: users.status,
      silenced: users.silenced,
      sensitized: users.sensitized,
      permissions: users.permissions,
      isLocal: users.isLocal,
      domain: users.domain,
      adminNote: users.adminNote,
      suspendedAt: users.suspendedAt,
      suspensionReason: users.suspensionReason,
      emailVerified: users.emailVerified,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      displayName: profiles.displayName,
      bio: profiles.bio,
      avatarUrl: profiles.avatarUrl,
      coverUrl: profiles.coverUrl,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);
  return user ?? null;
}

// ── Dashboard Metrics ──

export async function getDashboardMetrics() {
  const [userStats] = await db
    .select({
      total: count(),
      active: count(sql`CASE WHEN ${users.status} = 'active' THEN 1 END`),
      suspended: count(sql`CASE WHEN ${users.status} = 'suspended' THEN 1 END`),
      newToday: count(
        sql`CASE WHEN ${users.createdAt} > NOW() - INTERVAL '1 day' THEN 1 END`
      ),
      newThisWeek: count(
        sql`CASE WHEN ${users.createdAt} > NOW() - INTERVAL '7 days' THEN 1 END`
      ),
    })
    .from(users);

  const [postStats] = await db
    .select({ total: count() })
    .from(posts);

  const [reportStats] = await db
    .select({
      total: count(),
      pending: count(sql`CASE WHEN ${reports.status} = 'open' THEN 1 END`),
      resolved: count(
        sql`CASE WHEN ${reports.status} IN ('resolved', 'dismissed') THEN 1 END`
      ),
    })
    .from(reports);

  const [domainStats] = await db
    .select({ total: count() })
    .from(domainBlocks);

  return {
    totalUsers: Number(userStats?.total ?? 0),
    activeUsers: Number(userStats?.active ?? 0),
    newUsersToday: Number(userStats?.newToday ?? 0),
    newUsersThisWeek: Number(userStats?.newThisWeek ?? 0),
    totalPosts: Number(postStats?.total ?? 0),
    totalReports: Number(reportStats?.total ?? 0),
    pendingReports: Number(reportStats?.pending ?? 0),
    resolvedReports: Number(reportStats?.resolved ?? 0),
    suspendedUsers: Number(userStats?.suspended ?? 0),
    blockedDomains: Number(domainStats?.total ?? 0),
    totalCommunities: 0,
    storageUsed: 0,
  };
}
