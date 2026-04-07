"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useAuthStore } from "@/stores/auth";
import { useAdminStore } from "@/stores/admin";
import { announce } from "@/a11y/announcer";
import { apiFetch, ApiError } from "@/hooks/useApi";
import styles from "./page.module.css";

type Tab =
  | "dashboard"
  | "reports"
  | "users"
  | "domains"
  | "ip-blocks"
  | "settings"
  | "audit-log";

const TABS: { key: Tab; label: string }[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "reports", label: "Reports" },
  { key: "users", label: "Users" },
  { key: "domains", label: "Federation" },
  { key: "ip-blocks", label: "IP Blocks" },
  { key: "settings", label: "Settings" },
  { key: "audit-log", label: "Audit Log" },
];

export default function AdminPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");

  useEffect(() => {
    if (!user || (user.role !== "admin" && user.role !== "moderator")) {
      router.push("/");
    }
  }, [user, router]);

  if (!user || (user.role !== "admin" && user.role !== "moderator")) {
    return null;
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Administration</h1>
      </div>

      <nav className={styles.nav} aria-label="Admin sections">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={
              activeTab === tab.key ? styles.navTabActive : styles.navTab
            }
            onClick={() => setActiveTab(tab.key)}
            aria-current={activeTab === tab.key ? "page" : undefined}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === "dashboard" && <DashboardPanel />}
      {activeTab === "reports" && <ReportsPanel />}
      {activeTab === "users" && <UsersPanel isAdmin={user.role === "admin"} />}
      {activeTab === "domains" && <DomainsPanel isAdmin={user.role === "admin"} />}
      {activeTab === "ip-blocks" && <IpBlocksPanel />}
      {activeTab === "settings" && <SettingsPanel />}
      {activeTab === "audit-log" && <AuditLogPanel />}
    </div>
  );
}

// ── Dashboard Panel ──

function DashboardPanel() {
  const { dashboard, loading, fetchDashboard } = useAdminStore();

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  if (loading && !dashboard) return <p className={styles.loading}>Loading...</p>;
  if (!dashboard) return null;

  const metrics = [
    { label: "Total Users", value: dashboard.totalUsers },
    { label: "Active Users", value: dashboard.activeUsers },
    { label: "New Today", value: dashboard.newUsersToday },
    { label: "New This Week", value: dashboard.newUsersThisWeek },
    { label: "Total Posts", value: dashboard.totalPosts },
    { label: "Pending Reports", value: dashboard.pendingReports },
    { label: "Total Reports", value: dashboard.totalReports },
    { label: "Suspended Users", value: dashboard.suspendedUsers },
    { label: "Blocked Domains", value: dashboard.blockedDomains },
  ];

  return (
    <div className={styles.metricsGrid}>
      {metrics.map((m) => (
        <Card key={m.label} className={styles.metricCard}>
          <div className={styles.metricValue}>{m.value.toLocaleString()}</div>
          <div className={styles.metricLabel}>{m.label}</div>
        </Card>
      ))}
    </div>
  );
}

// ── Reports Panel ──

function ReportsPanel() {
  const { reports, loading, fetchReports, resolveReport } = useAdminStore();
  const [statusFilter, setStatusFilter] = useState("open");

  useEffect(() => {
    fetchReports(`status=${statusFilter}`);
  }, [fetchReports, statusFilter]);

  async function handleResolve(id: string, action: string) {
    try {
      await resolveReport(id, action);
      announce("Report updated");
      fetchReports(`status=${statusFilter}`);
    } catch (err) {
      announce(
        err instanceof ApiError ? err.message : "Failed to resolve report",
        "assertive"
      );
    }
  }

  return (
    <div>
      <div className={styles.filters}>
        <select
          className={styles.filterSelect}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter reports by status"
        >
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
          <option value="dismissed">Dismissed</option>
        </select>
      </div>

      {loading && !reports ? (
        <p className={styles.loading}>Loading...</p>
      ) : !reports?.items.length ? (
        <p className={styles.empty}>No reports found</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Type</th>
              <th>Target</th>
              <th>Category</th>
              <th>Status</th>
              <th>Filed</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {reports.items.map((report) => (
              <tr key={report.id}>
                <td>{report.targetType}</td>
                <td>
                  <code>{report.targetId.slice(0, 8)}</code>
                </td>
                <td>{report.type.replace(/_/g, " ")}</td>
                <td>
                  <span
                    className={
                      report.status === "open"
                        ? styles.badgeOpen
                        : report.status === "resolved"
                          ? styles.badgeResolved
                          : styles.badgeDismissed
                    }
                  >
                    {report.status}
                  </span>
                </td>
                <td>{new Date(report.createdAt).toLocaleDateString()}</td>
                <td>
                  {report.status === "open" && (
                    <div className={styles.actions}>
                      <Button
                        size="sm"
                        onClick={() => handleResolve(report.id, "dismiss")}
                      >
                        Dismiss
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleResolve(report.id, "warn")}
                      >
                        Warn
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => handleResolve(report.id, "suspend")}
                      >
                        Suspend
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {reports?.nextCursor && (
        <div className={styles.pagination}>
          <Button
            variant="secondary"
            onClick={() =>
              fetchReports(`status=${statusFilter}&cursor=${reports.nextCursor}`)
            }
          >
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Users Panel ──

function UsersPanel({ isAdmin }: { isAdmin: boolean }) {
  const { users, loading, fetchUsers } = useAdminStore();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const doFetch = useCallback(() => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (roleFilter) params.set("role", roleFilter);
    if (statusFilter) params.set("status", statusFilter);
    fetchUsers(params.toString());
  }, [search, roleFilter, statusFilter, fetchUsers]);

  useEffect(() => {
    doFetch();
  }, [doFetch]);

  async function handleAction(userId: string, action: string) {
    try {
      await apiFetch(`/api/v1/admin/users/${userId}/${action}`, {
        method: "POST",
      });
      announce(`User ${action}ed`);
      doFetch();
    } catch (err) {
      announce(
        err instanceof ApiError ? err.message : `Failed to ${action} user`,
        "assertive"
      );
    }
  }

  return (
    <div>
      <div className={styles.filters}>
        <input
          type="search"
          className={styles.searchInput}
          placeholder="Search users..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search users"
        />
        <select
          className={styles.filterSelect}
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          aria-label="Filter by role"
        >
          <option value="">All roles</option>
          <option value="user">User</option>
          <option value="moderator">Moderator</option>
          <option value="admin">Admin</option>
        </select>
        <select
          className={styles.filterSelect}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="disabled">Disabled</option>
          <option value="pending">Pending</option>
        </select>
      </div>

      {loading && !users ? (
        <p className={styles.loading}>Loading...</p>
      ) : !users?.items.length ? (
        <p className={styles.empty}>No users found</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Username</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Joined</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.items.map((u) => (
              <tr key={u.id}>
                <td>
                  <strong>{u.displayName || u.username}</strong>
                  <br />
                  <small>@{u.username}{u.domain ? `@${u.domain}` : ""}</small>
                </td>
                <td>{u.email}</td>
                <td>
                  <span
                    className={
                      u.role === "admin"
                        ? styles.badgeAdmin
                        : u.role === "moderator"
                          ? styles.badgeMod
                          : styles.badge
                    }
                  >
                    {u.role}
                  </span>
                </td>
                <td>
                  <span
                    className={
                      u.status === "active"
                        ? styles.badgeActive
                        : u.status === "suspended"
                          ? styles.badgeSuspended
                          : styles.badge
                    }
                  >
                    {u.status}
                  </span>
                  {u.silenced && (
                    <span className={styles.badge}> silenced</span>
                  )}
                </td>
                <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                <td>
                  <div className={styles.actions}>
                    {u.status === "active" && (
                      <>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => handleAction(u.id, "suspend")}
                        >
                          Suspend
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleAction(u.id, "silence")}
                        >
                          Silence
                        </Button>
                      </>
                    )}
                    {u.status === "suspended" && (
                      <Button
                        size="sm"
                        onClick={() => handleAction(u.id, "unsuspend")}
                      >
                        Unsuspend
                      </Button>
                    )}
                    {u.silenced && (
                      <Button
                        size="sm"
                        onClick={() => handleAction(u.id, "unsilence")}
                      >
                        Unsilence
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {users?.nextCursor && (
        <div className={styles.pagination}>
          <Button variant="secondary" onClick={() => {
            const params = new URLSearchParams();
            if (search) params.set("q", search);
            if (roleFilter) params.set("role", roleFilter);
            if (statusFilter) params.set("status", statusFilter);
            params.set("cursor", users.nextCursor!);
            fetchUsers(params.toString());
          }}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Domains Panel ──

function DomainsPanel({ isAdmin }: { isAdmin: boolean }) {
  const { domainBlocks, loading, fetchDomainBlocks } = useAdminStore();
  const [showAdd, setShowAdd] = useState(false);
  const [newDomain, setNewDomain] = useState("");
  const [newSeverity, setNewSeverity] = useState("silence");

  useEffect(() => {
    fetchDomainBlocks();
  }, [fetchDomainBlocks]);

  async function handleAdd() {
    try {
      await apiFetch("/api/v1/admin/domain-blocks", {
        method: "POST",
        body: JSON.stringify({ domain: newDomain, severity: newSeverity }),
      });
      announce("Domain block added");
      setShowAdd(false);
      setNewDomain("");
      fetchDomainBlocks();
    } catch (err) {
      announce(
        err instanceof ApiError ? err.message : "Failed to add block",
        "assertive"
      );
    }
  }

  async function handleRemove(id: string) {
    try {
      await apiFetch(`/api/v1/admin/domain-blocks/${id}`, {
        method: "DELETE",
      });
      announce("Domain block removed");
      fetchDomainBlocks();
    } catch (err) {
      announce(
        err instanceof ApiError ? err.message : "Failed to remove block",
        "assertive"
      );
    }
  }

  return (
    <div>
      {isAdmin && (
        <div className={styles.filters}>
          <Button onClick={() => setShowAdd(!showAdd)}>
            {showAdd ? "Cancel" : "Add domain block"}
          </Button>
        </div>
      )}

      {showAdd && (
        <Card className={styles.metricCard}>
          <div className={styles.filters}>
            <input
              className={styles.searchInput}
              placeholder="example.com"
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              aria-label="Domain"
            />
            <select
              className={styles.filterSelect}
              value={newSeverity}
              onChange={(e) => setNewSeverity(e.target.value)}
              aria-label="Severity"
            >
              <option value="silence">Silence</option>
              <option value="suspend">Suspend</option>
              <option value="noop">None (just record)</option>
            </select>
            <Button onClick={handleAdd} disabled={!newDomain.trim()}>
              Add
            </Button>
          </div>
        </Card>
      )}

      {loading && !domainBlocks ? (
        <p className={styles.loading}>Loading...</p>
      ) : !domainBlocks?.items.length ? (
        <p className={styles.empty}>No domain blocks</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Domain</th>
              <th>Severity</th>
              <th>Reject Media</th>
              <th>Added</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {domainBlocks.items.map((block) => (
              <tr key={block.id}>
                <td>{block.domain}</td>
                <td>
                  <span
                    className={
                      block.severity === "suspend"
                        ? styles.badgeSuspended
                        : block.severity === "silence"
                          ? styles.badgeOpen
                          : styles.badge
                    }
                  >
                    {block.severity}
                  </span>
                </td>
                <td>{block.rejectMedia ? "Yes" : "No"}</td>
                <td>{new Date(block.createdAt).toLocaleDateString()}</td>
                <td>
                  {isAdmin && (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => handleRemove(block.id)}
                    >
                      Remove
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── IP Blocks Panel ──

function IpBlocksPanel() {
  const [blocks, setBlocks] = useState<{ items: Array<{ id: string; ip: string; severity: string; comment: string | null; expiresAt: string | null; createdAt: string }>; nextCursor: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newIp, setNewIp] = useState("");
  const [newSeverity, setNewSeverity] = useState("sign_up_block");

  useEffect(() => {
    fetchBlocks();
  }, []);

  async function fetchBlocks() {
    setLoading(true);
    const data = await apiFetch<typeof blocks>("/api/v1/admin/ip-blocks");
    setBlocks(data);
    setLoading(false);
  }

  async function handleAdd() {
    try {
      await apiFetch("/api/v1/admin/ip-blocks", {
        method: "POST",
        body: JSON.stringify({ ip: newIp, severity: newSeverity }),
      });
      announce("IP block added");
      setShowAdd(false);
      setNewIp("");
      fetchBlocks();
    } catch (err) {
      announce(
        err instanceof ApiError ? err.message : "Failed to add block",
        "assertive"
      );
    }
  }

  async function handleRemove(id: string) {
    try {
      await apiFetch(`/api/v1/admin/ip-blocks/${id}`, { method: "DELETE" });
      announce("IP block removed");
      fetchBlocks();
    } catch (err) {
      announce(
        err instanceof ApiError ? err.message : "Failed to remove block",
        "assertive"
      );
    }
  }

  if (loading) return <p className={styles.loading}>Loading...</p>;

  return (
    <div>
      <div className={styles.filters}>
        <Button onClick={() => setShowAdd(!showAdd)}>
          {showAdd ? "Cancel" : "Add IP block"}
        </Button>
      </div>

      {showAdd && (
        <Card className={styles.metricCard}>
          <div className={styles.filters}>
            <input
              className={styles.searchInput}
              placeholder="192.168.1.0/24"
              value={newIp}
              onChange={(e) => setNewIp(e.target.value)}
              aria-label="IP address or CIDR"
            />
            <select
              className={styles.filterSelect}
              value={newSeverity}
              onChange={(e) => setNewSeverity(e.target.value)}
              aria-label="Severity"
            >
              <option value="sign_up_requires_approval">Require Approval</option>
              <option value="sign_up_block">Block Registration</option>
              <option value="no_access">Block All Access</option>
            </select>
            <Button onClick={handleAdd} disabled={!newIp.trim()}>
              Add
            </Button>
          </div>
        </Card>
      )}

      {!blocks?.items.length ? (
        <p className={styles.empty}>No IP blocks</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>IP / CIDR</th>
              <th>Severity</th>
              <th>Comment</th>
              <th>Expires</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {blocks.items.map((block) => (
              <tr key={block.id}>
                <td><code>{block.ip}</code></td>
                <td>{block.severity.replace(/_/g, " ")}</td>
                <td>{block.comment || "—"}</td>
                <td>
                  {block.expiresAt
                    ? new Date(block.expiresAt).toLocaleDateString()
                    : "Never"}
                </td>
                <td>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => handleRemove(block.id)}
                  >
                    Remove
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Settings Panel ──

function SettingsPanel() {
  const user = useAuthStore((s) => s.user);
  const [settings, setSettings] = useState<Array<{ key: string; value: unknown; type: string; isPublic: boolean }>>([]);
  const [loading, setLoading] = useState(true);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newPublic, setNewPublic] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, []);

  async function fetchSettings() {
    setLoading(true);
    const data = await apiFetch<typeof settings>("/api/v1/admin/settings");
    setSettings(data);
    setLoading(false);
  }

  async function handleSave() {
    try {
      let parsed: unknown = newValue;
      try { parsed = JSON.parse(newValue); } catch { /* keep as string */ }
      await apiFetch("/api/v1/admin/settings", {
        method: "PUT",
        body: JSON.stringify({
          key: newKey,
          value: parsed,
          isPublic: newPublic,
        }),
      });
      announce("Setting saved");
      setNewKey("");
      setNewValue("");
      fetchSettings();
    } catch (err) {
      announce(
        err instanceof ApiError ? err.message : "Failed to save setting",
        "assertive"
      );
    }
  }

  if (user?.role !== "admin") {
    return <p className={styles.empty}>Admin access required for settings</p>;
  }

  if (loading) return <p className={styles.loading}>Loading...</p>;

  return (
    <div>
      <Card className={styles.metricCard}>
        <h3>Add / Update Setting</h3>
        <div className={styles.filters}>
          <input
            className={styles.searchInput}
            placeholder="setting.key"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            aria-label="Setting key"
          />
          <input
            className={styles.searchInput}
            placeholder="value (JSON)"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            aria-label="Setting value"
          />
          <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <input
              type="checkbox"
              checked={newPublic}
              onChange={(e) => setNewPublic(e.target.checked)}
            />
            Public
          </label>
          <Button onClick={handleSave} disabled={!newKey.trim()}>
            Save
          </Button>
        </div>
      </Card>

      {!settings.length ? (
        <p className={styles.empty}>No settings configured</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Key</th>
              <th>Value</th>
              <th>Type</th>
              <th>Public</th>
            </tr>
          </thead>
          <tbody>
            {settings.map((s) => (
              <tr key={s.key}>
                <td><code>{s.key}</code></td>
                <td><code>{JSON.stringify(s.value)}</code></td>
                <td>{s.type}</td>
                <td>{s.isPublic ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Audit Log Panel ──

function AuditLogPanel() {
  const { auditLog, loading, fetchAuditLog } = useAdminStore();

  useEffect(() => {
    fetchAuditLog();
  }, [fetchAuditLog]);

  if (loading && !auditLog) return <p className={styles.loading}>Loading...</p>;

  return (
    <div>
      {!auditLog?.items.length ? (
        <p className={styles.empty}>No audit log entries</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Action</th>
              <th>Target</th>
              <th>Actor</th>
              <th>When</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {auditLog.items.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.action.replace(/_/g, " ")}</td>
                <td>
                  {entry.targetType}{" "}
                  <code>{entry.targetId.slice(0, 8)}</code>
                </td>
                <td><code>{entry.actorId.slice(0, 8)}</code></td>
                <td>{new Date(entry.createdAt).toLocaleString()}</td>
                <td>
                  <code>
                    {JSON.stringify(entry.metadata).slice(0, 80)}
                  </code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {auditLog?.nextCursor && (
        <div className={styles.pagination}>
          <Button
            variant="secondary"
            onClick={() =>
              fetchAuditLog(`cursor=${auditLog.nextCursor}`)
            }
          >
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
