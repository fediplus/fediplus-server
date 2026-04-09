"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { apiFetch, ApiError } from "@/hooks/useApi";
import { useAuthStore } from "@/stores/auth";
import { announce } from "@/a11y/announcer";
import styles from "./page.module.css";

interface UserProfile {
  id: string;
  username: string;
  actorType: string;
  profile: {
    displayName: string;
    bio: string;
    avatarUrl: string | null;
    coverUrl: string | null;
    location: string | null;
    website: string | null;
  } | null;
  followersCount: number;
  followingCount: number;
  postsCount: number;
}

export default function ProfilePage() {
  const params = useParams();
  const username = (params?.username as string)?.replace("@", "");
  const currentUser = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)();
  const isOwnProfile = currentUser?.username === username;
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [blockLoading, setBlockLoading] = useState(false);

  useEffect(() => {
    if (!username) return;

    apiFetch<UserProfile>(`/api/v1/users/${username}`)
      .then(setProfile)
      .catch(() => setError("User not found"))
      .finally(() => setLoading(false));
  }, [username]);

  // Check if this user is in our blocked list
  useEffect(() => {
    if (!profile || isOwnProfile || !isAuthenticated) return;

    apiFetch<Array<{ id: string }>>("/api/v1/blocks")
      .then((blockedUsers) => {
        setBlocked(blockedUsers.some((u) => u.id === profile.id));
      })
      .catch(() => {});
  }, [profile, isOwnProfile, isAuthenticated]);

  async function handleBlock() {
    if (!profile) return;
    setBlockLoading(true);
    try {
      if (blocked) {
        await apiFetch(`/api/v1/users/${profile.id}/unblock`, {
          method: "POST",
        });
        setBlocked(false);
        announce(`Unblocked ${profile.profile?.displayName ?? profile.username}`);
      } else {
        await apiFetch(`/api/v1/users/${profile.id}/block`, {
          method: "POST",
        });
        setBlocked(true);
        announce(`Blocked ${profile.profile?.displayName ?? profile.username}`);
      }
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Action failed";
      announce(message, "assertive");
    } finally {
      setBlockLoading(false);
    }
  }

  if (loading) return <p role="status">Loading profile...</p>;
  if (error) return <p role="alert">{error}</p>;
  if (!profile) return null;

  return (
    <div className={styles.container}>
      <Card className={styles.profileCard} elevation={2}>
        <div
          className={styles.cover}
          style={
            profile.profile?.coverUrl
              ? { backgroundImage: `url(${profile.profile.coverUrl})` }
              : undefined
          }
          role="img"
          aria-label={`${profile.profile?.displayName}'s cover photo`}
        />

        <div className={styles.profileInfo}>
          <div
            className={styles.avatar}
            role="img"
            aria-label={`${profile.profile?.displayName}'s avatar`}
          >
            {profile.profile?.displayName?.charAt(0) ?? profile.username.charAt(0)}
          </div>

          <h1 className={styles.displayName}>
            {profile.profile?.displayName ?? profile.username}
          </h1>
          <p className={styles.username}>@{profile.username}</p>

          {profile.profile?.bio && (
            <p className={styles.bio}>{profile.profile.bio}</p>
          )}

          <div className={styles.stats}>
            <span>
              <strong>{profile.postsCount}</strong> posts
            </span>
            <span>
              <strong>{profile.followersCount}</strong> followers
            </span>
            <span>
              <strong>{profile.followingCount}</strong> following
            </span>
          </div>

          {profile.profile?.location && (
            <p className={styles.meta}>{profile.profile.location}</p>
          )}

          {profile.profile?.website && (
            <p className={styles.meta}>
              <a href={profile.profile.website} target="_blank" rel="noopener noreferrer">
                {profile.profile.website}
              </a>
            </p>
          )}

          {isOwnProfile && (
            <Link href="/profile/edit" className={styles.editLink}>
              <Button variant="secondary" size="sm">
                Edit Profile
              </Button>
            </Link>
          )}

          {!isOwnProfile && isAuthenticated && (
            <div className={styles.profileActions}>
              <Button
                variant={blocked ? "secondary" : "danger"}
                size="sm"
                onClick={handleBlock}
                disabled={blockLoading}
                aria-label={
                  blocked
                    ? `Unblock ${profile.profile?.displayName ?? profile.username}`
                    : `Block ${profile.profile?.displayName ?? profile.username}`
                }
              >
                {blockLoading
                  ? "…"
                  : blocked
                    ? "Unblock"
                    : "Block"}
              </Button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
