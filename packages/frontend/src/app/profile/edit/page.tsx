"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { apiFetch } from "@/hooks/useApi";
import { useAuthStore } from "@/stores/auth";
import { announce } from "@/a11y/announcer";
import styles from "./page.module.css";

interface UserProfile {
  id: string;
  username: string;
  profile: {
    displayName: string;
    bio: string;
    avatarUrl: string | null;
    coverUrl: string | null;
    location: string | null;
    website: string | null;
  } | null;
}

export default function ProfileEditPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [location, setLocation] = useState("");
  const [website, setWebsite] = useState("");

  useEffect(() => {
    if (!user) return;

    apiFetch<UserProfile>(`/api/v1/users/${user.username}`)
      .then((data) => {
        if (data.profile) {
          setDisplayName(data.profile.displayName ?? "");
          setBio(data.profile.bio ?? "");
          setLocation(data.profile.location ?? "");
          setWebsite(data.profile.website ?? "");
        }
      })
      .catch(() => setError("Failed to load profile"))
      .finally(() => setLoading(false));
  }, [user]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      await apiFetch(`/api/v1/users/${user.username}`, {
        method: "PATCH",
        body: JSON.stringify({
          displayName,
          bio,
          location: location || undefined,
          website: website || undefined,
        }),
      });
      setSuccess("Profile updated successfully");
      announce("Profile updated");
    } catch {
      setError("Failed to update profile");
    } finally {
      setSaving(false);
    }
  }

  if (!user) {
    return (
      <div className={styles.container}>
        <p>Please sign in to edit your profile.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={styles.container}>
        <p role="status">Loading profile...</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <Card className={styles.card}>
        <h1 className={styles.heading}>Edit Profile</h1>

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {success && (
          <p className={styles.success} role="status">
            {success}
          </p>
        )}

        <form onSubmit={handleSubmit} className={styles.form}>
          <Input
            label="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={100}
          />

          <div className={styles.field}>
            <label htmlFor="bio" className={styles.label}>
              Bio
            </label>
            <textarea
              id="bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              className={styles.textarea}
              rows={4}
              maxLength={500}
            />
          </div>

          <Input
            label="Location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            maxLength={100}
            placeholder="City, Country"
          />

          <Input
            label="Website"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            maxLength={200}
            placeholder="https://example.com"
            type="url"
          />

          <div className={styles.actions}>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </Button>
            <Button
              variant="secondary"
              type="button"
              onClick={() => router.push(`/${user.username}`)}
            >
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
