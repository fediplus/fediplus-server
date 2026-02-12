"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PostCard } from "@/components/feed/PostCard";
import type { StreamPost } from "@/stores/feed";
import { useAuthStore } from "@/stores/auth";
import { apiFetch, ApiError } from "@/hooks/useApi";
import { announce } from "@/a11y/announcer";
import styles from "./page.module.css";

interface Community {
  id: string;
  name: string;
  slug: string;
  description: string;
  visibility: string;
  postApproval: boolean;
  memberCount: number;
  createdById: string;
}

interface Member {
  id: string;
  username: string;
  displayName: string;
  role: string;
  approved: boolean;
}

export default function CommunityDetailPage() {
  const params = useParams();
  const slug = params?.slug as string;
  const user = useAuthStore((s) => s.user);

  const [community, setCommunity] = useState<Community | null>(null);
  const [posts, setPosts] = useState<StreamPost[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [isMember, setIsMember] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showMembers, setShowMembers] = useState(false);

  useEffect(() => {
    if (!slug) return;

    Promise.all([
      apiFetch<Community>(`/api/v1/communities/${slug}`).then(setCommunity),
      apiFetch<{ items: StreamPost[] }>(`/api/v1/communities/${slug}/posts`)
        .then((d) => setPosts(d.items))
        .catch(() => {}),
      apiFetch<Member[]>(`/api/v1/communities/${slug}/members`)
        .then((m) => {
          setMembers(m);
          if (user) {
            setIsMember(m.some((mem) => mem.id === user.id));
          }
        })
        .catch(() => {}),
    ])
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [slug, user]);

  async function handleJoin() {
    try {
      await apiFetch(`/api/v1/communities/${slug}/join`, { method: "POST" });
      setIsMember(true);
      setCommunity((c) =>
        c ? { ...c, memberCount: c.memberCount + 1 } : c
      );
      announce("Joined community");
    } catch (err) {
      announce(
        err instanceof ApiError ? err.message : "Failed to join",
        "assertive"
      );
    }
  }

  async function handleLeave() {
    try {
      await apiFetch(`/api/v1/communities/${slug}/leave`, { method: "POST" });
      setIsMember(false);
      setCommunity((c) =>
        c ? { ...c, memberCount: c.memberCount - 1 } : c
      );
      announce("Left community");
    } catch (err) {
      announce(
        err instanceof ApiError ? err.message : "Failed to leave",
        "assertive"
      );
    }
  }

  if (loading) return <p role="status">Loading...</p>;
  if (!community) return <p>Community not found.</p>;

  return (
    <div className={styles.container}>
      <Card className={styles.headerCard} elevation={2}>
        <div className={styles.communityAvatar} aria-hidden="true">
          {community.name.charAt(0)}
        </div>
        <div className={styles.headerInfo}>
          <h1 className={styles.name}>{community.name}</h1>
          <p className={styles.meta}>
            {community.memberCount}{" "}
            {community.memberCount === 1 ? "member" : "members"}
            {community.visibility === "private" && " · Private"}
          </p>
          {community.description && (
            <p className={styles.description}>{community.description}</p>
          )}
        </div>
        <div className={styles.headerActions}>
          {user && (
            isMember ? (
              <Button variant="secondary" size="sm" onClick={handleLeave}>
                Leave
              </Button>
            ) : (
              <Button variant="primary" size="sm" onClick={handleJoin}>
                Join
              </Button>
            )
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowMembers(!showMembers)}
            aria-expanded={showMembers}
          >
            Members
          </Button>
        </div>
      </Card>

      {showMembers && (
        <Card>
          <h2 className={styles.sectionTitle}>Members</h2>
          <ul className={styles.memberList} role="list">
            {members
              .filter((m) => m.approved)
              .map((member) => (
                <li key={member.id} className={styles.memberItem}>
                  <span className={styles.memberName}>
                    {member.displayName}
                  </span>
                  <span className={styles.memberUsername}>
                    @{member.username}
                  </span>
                  {member.role !== "member" && (
                    <span className={styles.roleBadge}>{member.role}</span>
                  )}
                </li>
              ))}
          </ul>
        </Card>
      )}

      <section aria-label="Community posts">
        {posts.length === 0 ? (
          <p className={styles.empty}>
            No posts in this community yet.
          </p>
        ) : (
          <div className={styles.postList}>
            {posts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
