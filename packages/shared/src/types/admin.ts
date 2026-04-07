import type {
  USER_ROLES,
  USER_STATUS,
  REPORT_TYPES,
  REPORT_TARGET_TYPES,
  REPORT_STATUS,
  MODERATION_ACTIONS,
  DOMAIN_SEVERITY,
  USER_PERMISSIONS,
} from "../constants.js";

export type UserRole = (typeof USER_ROLES)[number];
export type UserStatus = (typeof USER_STATUS)[number];
export type ReportType = (typeof REPORT_TYPES)[number];
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];
export type ReportStatus = (typeof REPORT_STATUS)[number];
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];
export type DomainSeverity = (typeof DOMAIN_SEVERITY)[number];
export type UserPermission = (typeof USER_PERMISSIONS)[number];

export interface Report {
  id: string;
  reporterId: string;
  targetType: ReportTargetType;
  targetId: string;
  targetAccountId: string | null;
  type: ReportType;
  comment: string;
  status: ReportStatus;
  assignedModId: string | null;
  resolvedAt: Date | null;
  resolvedById: string | null;
  resolutionNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditLog {
  id: string;
  actorId: string;
  action: ModerationAction;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface DomainBlock {
  id: string;
  domain: string;
  severity: DomainSeverity;
  publicComment: string | null;
  privateComment: string | null;
  rejectMedia: boolean;
  rejectReports: boolean;
  obfuscate: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IpBlock {
  id: string;
  ip: string;
  severity: "sign_up_requires_approval" | "sign_up_block" | "no_access";
  comment: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Appeal {
  id: string;
  reportId: string;
  accountId: string;
  text: string;
  approvedAt: Date | null;
  approvedById: string | null;
  rejectedAt: Date | null;
  rejectedById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserWarning {
  id: string;
  targetAccountId: string;
  action: ModerationAction;
  text: string;
  reportId: string | null;
  createdByModId: string;
  createdAt: Date;
}

export interface AdminSettings {
  id: string;
  key: string;
  value: unknown;
  type: string;
  isPublic: boolean;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminDashboardMetrics {
  totalUsers: number;
  activeUsers: number;
  newUsersToday: number;
  newUsersThisWeek: number;
  totalPosts: number;
  totalReports: number;
  pendingReports: number;
  resolvedReports: number;
  suspendedUsers: number;
  blockedDomains: number;
  totalCommunities: number;
  storageUsed: number;
}
