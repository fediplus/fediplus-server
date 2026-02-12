"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useAuthStore } from "@/stores/auth";
import { apiFetch } from "@/hooks/useApi";
import { announce } from "@/a11y/announcer";
import styles from "./page.module.css";

interface Community {
  id: string;
  name: string;
  slug: string;
  description: string;
  visibility: string;
  memberCount: number;
  avatarUrl: string | null;
}

export default function CommunitiesPage() {
  const user = useAuthStore((s) => s.user);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [myCommunities, setMyCommunities] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    Promise.all([
      apiFetch<{ items: Community[] }>("/api/v1/communities").then((d) =>
        setCommunities(d.items)
      ),
      user
        ? apiFetch<Community[]>("/api/v1/communities/mine").then(
            setMyCommunities
          )
        : Promise.resolve(),
    ])
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user]);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.heading}>Communities</h1>
        {user && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowCreate(!showCreate)}
          >
            Create community
          </Button>
        )}
      </header>

      {showCreate && <CreateCommunityForm onCreated={(c) => {
        setMyCommunities((prev) => [...prev, c]);
        setShowCreate(false);
        announce("Community created");
      }} />}

      {loading ? (
        <p role="status">Loading communities...</p>
      ) : (
        <>
          {myCommunities.length > 0 && (
            <section>
              <h2 className={styles.sectionTitle}>Your communities</h2>
              <CommunityGrid communities={myCommunities} />
            </section>
          )}

          <section>
            <h2 className={styles.sectionTitle}>Discover</h2>
            {communities.length === 0 ? (
              <p className={styles.empty}>
                No communities yet. Be the first to create one!
              </p>
            ) : (
              <CommunityGrid communities={communities} />
            )}
          </section>
        </>
      )}
    </div>
  );
}

function CommunityGrid({ communities }: { communities: Community[] }) {
  return (
    <div className={styles.grid} role="list" aria-label="Communities">
      {communities.map((community) => (
        <Link
          key={community.id}
          href={`/communities/${community.slug}`}
          className={styles.cardLink}
          role="listitem"
        >
          <Card className={styles.communityCard}>
            <div className={styles.communityAvatar} aria-hidden="true">
              {community.name.charAt(0)}
            </div>
            <h3 className={styles.communityName}>{community.name}</h3>
            <p className={styles.communityDesc}>
              {community.description.slice(0, 120) ||
                "No description"}
            </p>
            <div className={styles.communityMeta}>
              <span>
                {community.memberCount}{" "}
                {community.memberCount === 1 ? "member" : "members"}
              </span>
              {community.visibility === "private" && (
                <span className={styles.privateBadge}>Private</span>
              )}
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}

function CreateCommunityForm({
  onCreated,
}: {
  onCreated: (community: Community) => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const community = await apiFetch<Community>("/api/v1/communities", {
        method: "POST",
        body: JSON.stringify({ name, slug, description }),
      });
      onCreated(community);
      setName("");
      setSlug("");
      setDescription("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className={styles.createForm}>
      <h2 className={styles.formTitle}>Create a community</h2>
      <form onSubmit={handleSubmit} className={styles.form}>
        {error && (
          <p className={styles.error} role="alert">{error}</p>
        )}
        <Input
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <Input
          label="Slug (URL-friendly)"
          value={slug}
          onChange={(e) =>
            setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
          }
          required
          pattern="[a-z0-9-]+"
        />
        <div className={styles.field}>
          <label htmlFor="community-desc" className={styles.label}>
            Description
          </label>
          <textarea
            id="community-desc"
            className={styles.textarea}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
        </div>
        <Button type="submit" disabled={submitting || !name || !slug}>
          {submitting ? "Creating..." : "Create"}
        </Button>
      </form>
    </Card>
  );
}
