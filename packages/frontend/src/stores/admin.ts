import { create } from "zustand";
import { apiFetch } from "@/hooks/useApi";
import type {
  AdminDashboardMetrics,
  Report,
  DomainBlock,
  AuditLog,
} from "@fediplus/shared";

interface AdminUser {
  id: string;
  username: string;
  email: string;
  role: string;
  status: string;
  silenced: boolean;
  sensitized: boolean;
  permissions: Record<string, boolean>;
  isLocal: boolean;
  domain: string | null;
  adminNote: string | null;
  suspendedAt: string | null;
  createdAt: string;
  displayName: string | null;
  avatarUrl: string | null;
}

interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
}

interface AdminState {
  dashboard: AdminDashboardMetrics | null;
  reports: PaginatedResult<Report> | null;
  users: PaginatedResult<AdminUser> | null;
  domainBlocks: PaginatedResult<DomainBlock> | null;
  auditLog: PaginatedResult<AuditLog> | null;
  loading: boolean;

  fetchDashboard: () => Promise<void>;
  fetchReports: (params?: string) => Promise<void>;
  fetchUsers: (params?: string) => Promise<void>;
  fetchDomainBlocks: (params?: string) => Promise<void>;
  fetchAuditLog: (params?: string) => Promise<void>;

  resolveReport: (id: string, action: string, note?: string) => Promise<void>;
  suspendUser: (id: string) => Promise<void>;
  unsuspendUser: (id: string) => Promise<void>;
  silenceUser: (id: string) => Promise<void>;
  unsilenceUser: (id: string) => Promise<void>;
  deletePost: (id: string) => Promise<void>;
}

export const useAdminStore = create<AdminState>()((set) => ({
  dashboard: null,
  reports: null,
  users: null,
  domainBlocks: null,
  auditLog: null,
  loading: false,

  fetchDashboard: async () => {
    set({ loading: true });
    const data = await apiFetch<AdminDashboardMetrics>(
      "/api/v1/admin/dashboard"
    );
    set({ dashboard: data, loading: false });
  },

  fetchReports: async (params = "") => {
    set({ loading: true });
    const data = await apiFetch<PaginatedResult<Report>>(
      `/api/v1/admin/reports${params ? `?${params}` : ""}`
    );
    set({ reports: data, loading: false });
  },

  fetchUsers: async (params = "") => {
    set({ loading: true });
    const data = await apiFetch<PaginatedResult<AdminUser>>(
      `/api/v1/admin/users${params ? `?${params}` : ""}`
    );
    set({ users: data, loading: false });
  },

  fetchDomainBlocks: async (params = "") => {
    set({ loading: true });
    const data = await apiFetch<PaginatedResult<DomainBlock>>(
      `/api/v1/admin/domain-blocks${params ? `?${params}` : ""}`
    );
    set({ domainBlocks: data, loading: false });
  },

  fetchAuditLog: async (params = "") => {
    set({ loading: true });
    const data = await apiFetch<PaginatedResult<AuditLog>>(
      `/api/v1/admin/audit-log${params ? `?${params}` : ""}`
    );
    set({ auditLog: data, loading: false });
  },

  resolveReport: async (id, action, note) => {
    await apiFetch(`/api/v1/admin/reports/${id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ action, note }),
    });
  },

  suspendUser: async (id) => {
    await apiFetch(`/api/v1/admin/users/${id}/suspend`, { method: "POST" });
  },

  unsuspendUser: async (id) => {
    await apiFetch(`/api/v1/admin/users/${id}/unsuspend`, { method: "POST" });
  },

  silenceUser: async (id) => {
    await apiFetch(`/api/v1/admin/users/${id}/silence`, { method: "POST" });
  },

  unsilenceUser: async (id) => {
    await apiFetch(`/api/v1/admin/users/${id}/unsilence`, { method: "POST" });
  },

  deletePost: async (id) => {
    await apiFetch(`/api/v1/admin/posts/${id}`, { method: "DELETE" });
  },
}));
