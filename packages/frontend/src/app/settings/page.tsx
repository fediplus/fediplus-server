"use client";

import { useState, useEffect, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { useAuthStore } from "@/stores/auth";
import { apiFetch, ApiError } from "@/hooks/useApi";
import { announce } from "@/a11y/announcer";
import styles from "./page.module.css";

interface BlockedUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

interface StreamingDestination {
  id: string;
  name: string;
  platform: "youtube" | "twitch" | "owncast" | "custom";
  rtmpUrl: string;
  streamKey: string | null;
  isDefault: boolean;
}

const PLATFORM_LABELS: Record<string, string> = {
  youtube: "YouTube",
  twitch: "Twitch",
  owncast: "Owncast",
  custom: "Custom RTMP",
};

const PLATFORM_PRESETS: Record<string, string> = {
  youtube: "rtmp://a.rtmp.youtube.com/live2",
  twitch: "rtmp://live.twitch.tv/app",
  owncast: "",
  custom: "",
};

interface YouTubeConnection {
  connected: boolean;
  channelId?: string;
  channelTitle?: string;
  connectedAt?: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const logout = useAuthStore((s) => s.logout);
  const token = useAuthStore((s) => s.token);

  // Delete account state
  const [showConfirm, setShowConfirm] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Blocked users state
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [blocksLoading, setBlocksLoading] = useState(true);
  const [blocksError, setBlocksError] = useState("");
  const [unblocking, setUnblocking] = useState<string | null>(null);

  // Streaming destinations state
  const [destinations, setDestinations] = useState<StreamingDestination[]>([]);
  const [destsLoading, setDestsLoading] = useState(true);
  const [destsError, setDestsError] = useState("");
  const [showDestForm, setShowDestForm] = useState(false);
  const [editingDest, setEditingDest] = useState<StreamingDestination | null>(null);
  const [destName, setDestName] = useState("");
  const [destPlatform, setDestPlatform] = useState<string>("youtube");
  const [destRtmpUrl, setDestRtmpUrl] = useState("");
  const [destStreamKey, setDestStreamKey] = useState("");
  const [destIsDefault, setDestIsDefault] = useState(false);
  const [destSaving, setDestSaving] = useState(false);
  const [deletingDest, setDeletingDest] = useState<string | null>(null);

  // YouTube connection state
  const [ytConnection, setYtConnection] = useState<YouTubeConnection | null>(null);
  const [ytLoading, setYtLoading] = useState(true);
  const [ytDisconnecting, setYtDisconnecting] = useState(false);
  const [ytError, setYtError] = useState("");

  useEffect(() => {
    apiFetch<BlockedUser[]>("/api/v1/blocks")
      .then(setBlockedUsers)
      .catch(() => setBlocksError("Failed to load blocked users"))
      .finally(() => setBlocksLoading(false));
  }, []);

  useEffect(() => {
    apiFetch<StreamingDestination[]>("/api/v1/streaming/destinations")
      .then(setDestinations)
      .catch(() => setDestsError("Failed to load streaming destinations"))
      .finally(() => setDestsLoading(false));
  }, []);

  useEffect(() => {
    apiFetch<YouTubeConnection>("/api/v1/youtube/connection")
      .then(setYtConnection)
      .catch(() => setYtError("Failed to load YouTube connection"))
      .finally(() => setYtLoading(false));
  }, []);

  // Handle YouTube OAuth redirect results
  useEffect(() => {
    if (searchParams.get("youtube_connected") === "true") {
      announce("YouTube account connected successfully");
      // Re-fetch connection info
      apiFetch<YouTubeConnection>("/api/v1/youtube/connection").then(
        setYtConnection
      );
    }
    const ytErr = searchParams.get("youtube_error");
    if (ytErr) {
      const messages: Record<string, string> = {
        access_denied: "YouTube connection was cancelled",
        missing_params: "Missing parameters from YouTube",
        invalid_state: "Session expired, please try again",
        no_refresh_token:
          "YouTube did not grant offline access. Please try again.",
        connection_failed: "Failed to connect YouTube account",
      };
      setYtError(messages[ytErr] ?? `YouTube error: ${ytErr}`);
      announce(messages[ytErr] ?? "YouTube connection failed", "assertive");
    }
  }, [searchParams]);

  async function handleUnblock(userId: string, username: string) {
    setUnblocking(userId);
    try {
      await apiFetch(`/api/v1/users/${userId}/unblock`, { method: "POST" });
      setBlockedUsers((prev) => prev.filter((u) => u.id !== userId));
      announce(`Unblocked ${username}`);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Failed to unblock user";
      setBlocksError(message);
      announce(message, "assertive");
    } finally {
      setUnblocking(null);
    }
  }

  function resetDestForm() {
    setDestName("");
    setDestPlatform("youtube");
    setDestRtmpUrl(PLATFORM_PRESETS.youtube);
    setDestStreamKey("");
    setDestIsDefault(false);
    setEditingDest(null);
    setShowDestForm(false);
    setDestsError("");
  }

  function openNewDestForm() {
    resetDestForm();
    setDestRtmpUrl(PLATFORM_PRESETS.youtube);
    setShowDestForm(true);
  }

  function openEditDestForm(dest: StreamingDestination) {
    setEditingDest(dest);
    setDestName(dest.name);
    setDestPlatform(dest.platform);
    setDestRtmpUrl(dest.rtmpUrl);
    setDestStreamKey(dest.streamKey ?? "");
    setDestIsDefault(dest.isDefault);
    setShowDestForm(true);
  }

  async function handleSaveDest(e: FormEvent) {
    e.preventDefault();
    setDestsError("");
    setDestSaving(true);
    try {
      const body = {
        name: destName,
        platform: destPlatform,
        rtmpUrl: destRtmpUrl,
        streamKey: destStreamKey || undefined,
        isDefault: destIsDefault,
      };
      if (editingDest) {
        const updated = await apiFetch<StreamingDestination>(
          `/api/v1/streaming/destinations/${editingDest.id}`,
          { method: "PATCH", body: JSON.stringify(body) }
        );
        setDestinations((prev) =>
          prev.map((d) => {
            if (d.id === updated.id) return updated;
            if (updated.isDefault && d.id !== updated.id) return { ...d, isDefault: false };
            return d;
          })
        );
        announce(`Updated ${updated.name}`);
      } else {
        const created = await apiFetch<StreamingDestination>(
          "/api/v1/streaming/destinations",
          { method: "POST", body: JSON.stringify(body) }
        );
        setDestinations((prev) => {
          if (created.isDefault) {
            return [...prev.map((d) => ({ ...d, isDefault: false })), created];
          }
          return [...prev, created];
        });
        announce(`Added ${created.name}`);
      }
      resetDestForm();
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Failed to save destination";
      setDestsError(message);
      announce(message, "assertive");
    } finally {
      setDestSaving(false);
    }
  }

  async function handleDeleteDest(id: string, name: string) {
    setDeletingDest(id);
    try {
      await apiFetch(`/api/v1/streaming/destinations/${id}`, {
        method: "DELETE",
      });
      setDestinations((prev) => prev.filter((d) => d.id !== id));
      announce(`Deleted ${name}`);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Failed to delete destination";
      setDestsError(message);
      announce(message, "assertive");
    } finally {
      setDeletingDest(null);
    }
  }

  function handleConnectYouTube() {
    if (!token) return;
    // Navigate to the OAuth endpoint — it will redirect to Google
    window.location.href = `${API_URL}/api/v1/youtube/auth?token=${encodeURIComponent(token)}`;
  }

  async function handleDisconnectYouTube() {
    setYtDisconnecting(true);
    setYtError("");
    try {
      await apiFetch("/api/v1/youtube/connection", { method: "DELETE" });
      setYtConnection({ connected: false });
      announce("YouTube account disconnected");
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : "Failed to disconnect YouTube";
      setYtError(message);
      announce(message, "assertive");
    } finally {
      setYtDisconnecting(false);
    }
  }

  async function handleDelete(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await apiFetch("/api/v1/account/delete", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      logout();
      announce("Account deleted");
      router.push("/login");
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Something went wrong";
      setError(message);
      announce(message, "assertive");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Settings</h1>

      <section className={styles.section} aria-labelledby="blocked-heading">
        <Card>
          <div className={styles.blockedSection}>
            <h2 id="blocked-heading" className={styles.sectionTitle}>
              Blocked users
            </h2>
            <p className={styles.sectionDescription}>
              Blocked users can&apos;t see your posts, react, reshare, or
              message you.
            </p>

            {blocksError && (
              <p className={styles.error} role="alert">
                {blocksError}
              </p>
            )}

            {blocksLoading ? (
              <p className={styles.emptyText} role="status">
                Loading…
              </p>
            ) : blockedUsers.length === 0 ? (
              <p className={styles.emptyText}>No blocked users.</p>
            ) : (
              <ul className={styles.blockedList} role="list">
                {blockedUsers.map((user) => (
                  <li key={user.id} className={styles.blockedItem}>
                    <div className={styles.blockedUser}>
                      <div
                        className={styles.blockedAvatar}
                        role="img"
                        aria-label={`${user.displayName ?? user.username}'s avatar`}
                      >
                        {(user.displayName ?? user.username).charAt(0)}
                      </div>
                      <div className={styles.blockedInfo}>
                        <span className={styles.blockedName}>
                          {user.displayName ?? user.username}
                        </span>
                        <span className={styles.blockedUsername}>
                          @{user.username}
                        </span>
                      </div>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={unblocking === user.id}
                      onClick={() => handleUnblock(user.id, user.username)}
                      aria-label={`Unblock ${user.username}`}
                    >
                      {unblocking === user.id ? "Unblocking…" : "Unblock"}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </section>

      <section className={styles.section} aria-labelledby="accounts-heading">
        <Card>
          <div className={styles.accountsSection}>
            <h2 id="accounts-heading" className={styles.sectionTitle}>
              Connected accounts
            </h2>
            <p className={styles.sectionDescription}>
              Connect your streaming accounts to go live on Hangouts On Air
              without entering RTMP details manually.
            </p>

            {ytError && (
              <p className={styles.error} role="alert">
                {ytError}
              </p>
            )}

            <div className={styles.accountItem}>
              <div className={styles.accountInfo}>
                <span className={styles.accountIcon} aria-hidden="true">
                  ▶
                </span>
                <div className={styles.accountDetails}>
                  <span className={styles.accountName}>YouTube</span>
                  {ytLoading ? (
                    <span className={styles.accountMeta}>Loading…</span>
                  ) : ytConnection?.connected ? (
                    <span className={styles.accountMeta}>
                      Connected as{" "}
                      <strong>{ytConnection.channelTitle}</strong>
                    </span>
                  ) : (
                    <span className={styles.accountMeta}>
                      Not connected
                    </span>
                  )}
                </div>
              </div>
              <div className={styles.accountActions}>
                {ytLoading ? null : ytConnection?.connected ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={ytDisconnecting}
                    onClick={handleDisconnectYouTube}
                  >
                    {ytDisconnecting ? "Disconnecting…" : "Disconnect"}
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleConnectYouTube}
                  >
                    Connect YouTube
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Card>
      </section>

      <section className={styles.section} aria-labelledby="streaming-heading">
        <Card>
          <div className={styles.streamingSection}>
            <div className={styles.streamingHeader}>
              <div>
                <h2 id="streaming-heading" className={styles.sectionTitle}>
                  Streaming destinations
                </h2>
                <p className={styles.sectionDescription}>
                  Save your RTMP destinations for Hangouts On Air. You can
                  quickly select these when starting a live stream.
                </p>
              </div>
              {!showDestForm && destinations.length < 10 && (
                <Button variant="primary" size="sm" onClick={openNewDestForm}>
                  Add destination
                </Button>
              )}
            </div>

            {destsError && (
              <p className={styles.error} role="alert">
                {destsError}
              </p>
            )}

            {showDestForm && (
              <form
                onSubmit={handleSaveDest}
                className={styles.destForm}
                aria-label={
                  editingDest ? "Edit streaming destination" : "Add streaming destination"
                }
              >
                <div className={styles.destFormGrid}>
                  <Input
                    label="Name"
                    value={destName}
                    onChange={(e) => setDestName(e.target.value)}
                    required
                    maxLength={100}
                    placeholder="e.g. My YouTube channel"
                  />

                  <div className={styles.destFormField}>
                    <label className={styles.destLabel} htmlFor="dest-platform">
                      Platform
                    </label>
                    <select
                      id="dest-platform"
                      className={styles.destSelect}
                      value={destPlatform}
                      onChange={(e) => {
                        setDestPlatform(e.target.value);
                        const preset = PLATFORM_PRESETS[e.target.value];
                        if (preset) setDestRtmpUrl(preset);
                      }}
                    >
                      <option value="youtube">YouTube</option>
                      <option value="twitch">Twitch</option>
                      <option value="owncast">Owncast</option>
                      <option value="custom">Custom RTMP</option>
                    </select>
                  </div>

                  <Input
                    label="RTMP URL"
                    value={destRtmpUrl}
                    onChange={(e) => setDestRtmpUrl(e.target.value)}
                    required
                    maxLength={2048}
                    placeholder="rtmp://..."
                  />

                  <Input
                    label="Stream key"
                    type="password"
                    value={destStreamKey}
                    onChange={(e) => setDestStreamKey(e.target.value)}
                    maxLength={500}
                    placeholder="Your stream key (optional for some platforms)"
                  />

                  <label className={styles.destCheckboxRow}>
                    <input
                      type="checkbox"
                      checked={destIsDefault}
                      onChange={(e) => setDestIsDefault(e.target.checked)}
                    />
                    Set as default destination
                  </label>
                </div>

                <div className={styles.buttonRow}>
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    disabled={destSaving}
                  >
                    {destSaving
                      ? "Saving…"
                      : editingDest
                        ? "Update"
                        : "Add"}
                  </Button>
                  <button
                    type="button"
                    className={styles.cancelButton}
                    onClick={resetDestForm}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {destsLoading ? (
              <p className={styles.emptyText} role="status">
                Loading…
              </p>
            ) : destinations.length === 0 && !showDestForm ? (
              <p className={styles.emptyText}>
                No streaming destinations configured. Add one to get started
                with Hangouts On Air.
              </p>
            ) : (
              <ul className={styles.destList} role="list">
                {destinations.map((dest) => (
                  <li key={dest.id} className={styles.destItem}>
                    <div className={styles.destItemInfo}>
                      <span className={styles.destItemName}>
                        {dest.name}
                        {dest.isDefault && (
                          <span className={styles.destDefaultBadge}>
                            Default
                          </span>
                        )}
                      </span>
                      <span className={styles.destItemPlatform}>
                        {PLATFORM_LABELS[dest.platform] ?? dest.platform} —{" "}
                        {dest.rtmpUrl}
                      </span>
                    </div>
                    <div className={styles.destItemActions}>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => openEditDestForm(dest)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={deletingDest === dest.id}
                        onClick={() => handleDeleteDest(dest.id, dest.name)}
                        aria-label={`Delete ${dest.name}`}
                      >
                        {deletingDest === dest.id ? "Deleting…" : "Delete"}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </section>

      <section className={styles.section}>
        <Card>
          <div className={styles.dangerZone}>
            <h2 className={styles.dangerTitle}>Delete account</h2>
            <p className={styles.dangerDescription}>
              Permanently delete your account and all associated data. This
              action cannot be undone.
            </p>

            {!showConfirm ? (
              <Button
                type="button"
                className={styles.dangerButton}
                onClick={() => setShowConfirm(true)}
              >
                Delete my account
              </Button>
            ) : (
              <form onSubmit={handleDelete} className={styles.confirmForm}>
                {error && (
                  <p className={styles.error} role="alert">
                    {error}
                  </p>
                )}

                <p className={styles.confirmWarning}>
                  Enter your password to confirm account deletion.
                </p>

                <Input
                  label="Password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />

                <div className={styles.buttonRow}>
                  <button
                    type="submit"
                    className={styles.dangerButton}
                    disabled={loading}
                  >
                    {loading ? "Deleting..." : "Confirm deletion"}
                  </button>
                  <button
                    type="button"
                    className={styles.cancelButton}
                    onClick={() => {
                      setShowConfirm(false);
                      setPassword("");
                      setError("");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </Card>
      </section>
    </div>
  );
}
