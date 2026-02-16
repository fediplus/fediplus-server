"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { apiFetch } from "@/hooks/useApi";
import { announce } from "@/a11y/announcer";
import styles from "./page.module.css";

interface CircleMember {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

interface Circle {
  id: string;
  name: string;
  color: string;
  isDefault: boolean;
  memberCount: number;
}

interface CircleDetail extends Circle {
  members: CircleMember[];
}

export default function CirclesPage() {
  const [circles, setCircles] = useState<Circle[]>([]);
  const [viewMode, setViewMode] = useState<"visual" | "list">("visual");
  const [loading, setLoading] = useState(true);
  const [selectedCircle, setSelectedCircle] = useState<CircleDetail | null>(
    null
  );
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#4285f4");
  const [addUsername, setAddUsername] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (prefersReducedMotion) {
      setViewMode("list");
    }
    loadCircles();
  }, []);

  async function loadCircles() {
    try {
      const data = await apiFetch<Circle[]>("/api/v1/circles");
      setCircles(data);
    } catch {
      // Not logged in or error
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateCircle(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!newName.trim()) return;

    try {
      const circle = await apiFetch<Circle>("/api/v1/circles", {
        method: "POST",
        body: JSON.stringify({ name: newName.trim(), color: newColor }),
      });
      setCircles((prev) => [...prev, { ...circle, memberCount: 0 }]);
      setNewName("");
      setNewColor("#4285f4");
      setShowCreate(false);
      announce(`Circle "${circle.name}" created`);
    } catch {
      setError("Failed to create circle");
    }
  }

  async function handleDeleteCircle(circleId: string, circleName: string) {
    try {
      await apiFetch(`/api/v1/circles/${circleId}`, { method: "DELETE" });
      setCircles((prev) => prev.filter((c) => c.id !== circleId));
      if (selectedCircle?.id === circleId) setSelectedCircle(null);
      announce(`Circle "${circleName}" deleted`);
    } catch {
      setError("Failed to delete circle");
    }
  }

  async function handleSelectCircle(circleId: string) {
    try {
      const detail = await apiFetch<CircleDetail>(
        `/api/v1/circles/${circleId}`
      );
      setSelectedCircle({
        ...detail,
        memberCount: detail.members.length,
      });
    } catch {
      setError("Failed to load circle details");
    }
  }

  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCircle || !addUsername.trim()) return;
    setError("");

    try {
      // Look up the user first
      const user = await apiFetch<{ id: string; username: string }>(
        `/api/v1/users/${addUsername.trim()}`
      );

      await apiFetch(`/api/v1/circles/${selectedCircle.id}/members`, {
        method: "POST",
        body: JSON.stringify({ memberIds: [user.id] }),
      });

      // Refresh circle detail
      await handleSelectCircle(selectedCircle.id);
      setAddUsername("");
      announce(`${user.username} added to ${selectedCircle.name}`);
    } catch {
      setError("User not found or could not be added");
    }
  }

  async function handleRemoveMember(memberId: string, memberName: string) {
    if (!selectedCircle) return;

    try {
      await apiFetch(
        `/api/v1/circles/${selectedCircle.id}/members/${memberId}`,
        { method: "DELETE" }
      );
      setSelectedCircle((prev) =>
        prev
          ? {
              ...prev,
              members: prev.members.filter((m) => m.id !== memberId),
              memberCount: prev.memberCount - 1,
            }
          : null
      );
      setCircles((prev) =>
        prev.map((c) =>
          c.id === selectedCircle.id
            ? { ...c, memberCount: c.memberCount - 1 }
            : c
        )
      );
      announce(`${memberName} removed from ${selectedCircle.name}`);
    } catch {
      setError("Failed to remove member");
    }
  }

  // ── Drag and drop (visual mode) ──

  function handleDragStart(e: React.DragEvent, member: CircleMember) {
    e.dataTransfer.setData(
      "application/json",
      JSON.stringify({ memberId: member.id, username: member.username })
    );
    e.dataTransfer.effectAllowed = "copy";
  }

  async function handleDrop(e: React.DragEvent, targetCircleId: string) {
    e.preventDefault();
    const data = e.dataTransfer.getData("application/json");
    if (!data) return;

    try {
      const { memberId, username } = JSON.parse(data);
      await apiFetch(`/api/v1/circles/${targetCircleId}/members`, {
        method: "POST",
        body: JSON.stringify({ memberIds: [memberId] }),
      });
      await loadCircles();
      if (selectedCircle) {
        await handleSelectCircle(selectedCircle.id);
      }
      const targetCircle = circles.find((c) => c.id === targetCircleId);
      announce(`${username} added to ${targetCircle?.name ?? "circle"}`);
    } catch {
      setError("Failed to add member");
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.heading}>Circles</h1>

        <div className={styles.controls}>
          <Button size="sm" onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? "Cancel" : "New Circle"}
          </Button>
          <fieldset className={styles.viewToggle}>
            <legend className="sr-only">View mode</legend>
            <Button
              variant={viewMode === "visual" ? "primary" : "secondary"}
              size="sm"
              onClick={() => setViewMode("visual")}
              aria-pressed={viewMode === "visual"}
            >
              Visual
            </Button>
            <Button
              variant={viewMode === "list" ? "primary" : "secondary"}
              size="sm"
              onClick={() => setViewMode("list")}
              aria-pressed={viewMode === "list"}
            >
              List
            </Button>
          </fieldset>
        </div>
      </header>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {showCreate && (
        <Card className={styles.createForm}>
          <form onSubmit={handleCreateCircle}>
            <h2 className={styles.formHeading}>Create Circle</h2>
            <div className={styles.formRow}>
              <Input
                label="Circle name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={50}
                required
              />
              <div className={styles.colorPicker}>
                <label htmlFor="circle-color" className={styles.colorLabel}>
                  Color
                </label>
                <input
                  id="circle-color"
                  type="color"
                  value={newColor}
                  onChange={(e) => setNewColor(e.target.value)}
                  className={styles.colorInput}
                />
              </div>
              <Button type="submit">Create</Button>
            </div>
          </form>
        </Card>
      )}

      {loading ? (
        <p className={styles.loading} role="status">
          Loading circles...
        </p>
      ) : circles.length === 0 ? (
        <Card>
          <p className={styles.emptyState}>
            No circles yet. Sign in to see your default circles or create new
            ones.
          </p>
        </Card>
      ) : (
        <div className={styles.layout}>
          <div className={styles.circlesList}>
            {viewMode === "visual" ? (
              <CirclesVisualView
                circles={circles}
                selectedId={selectedCircle?.id ?? null}
                onSelect={handleSelectCircle}
                onDelete={handleDeleteCircle}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
              />
            ) : (
              <CirclesListView
                circles={circles}
                selectedId={selectedCircle?.id ?? null}
                onSelect={handleSelectCircle}
                onDelete={handleDeleteCircle}
              />
            )}
          </div>

          {selectedCircle && (
            <CircleDetailPanel
              circle={selectedCircle}
              onAddMember={handleAddMember}
              onRemoveMember={handleRemoveMember}
              addUsername={addUsername}
              setAddUsername={setAddUsername}
              onClose={() => setSelectedCircle(null)}
              onDragStart={handleDragStart}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ── Visual view ──

function CirclesVisualView({
  circles,
  selectedId,
  onSelect,
  onDelete,
  onDrop,
  onDragOver,
}: {
  circles: Circle[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string, name: string) => void;
  onDrop: (e: React.DragEvent, circleId: string) => void;
  onDragOver: (e: React.DragEvent) => void;
}) {
  return (
    <div className={styles.visualGrid} role="list" aria-label="Your circles">
      {circles.map((circle) => (
        <Card
          key={circle.id}
          className={`${styles.circleCard} ${selectedId === circle.id ? styles.selected : ""}`}
          role="listitem"
          style={{ borderTopColor: circle.color }}
          onClick={() => onSelect(circle.id)}
          onDrop={(e: React.DragEvent) => onDrop(e, circle.id)}
          onDragOver={onDragOver}
        >
          <div
            className={styles.circleIndicator}
            style={{ backgroundColor: circle.color }}
            aria-hidden="true"
          />
          <h2 className={styles.circleName}>{circle.name}</h2>
          <p className={styles.circleMeta}>
            {circle.memberCount}{" "}
            {circle.memberCount === 1 ? "person" : "people"}
          </p>
          {circle.isDefault && (
            <span className={styles.defaultBadge}>Default</span>
          )}
          {!circle.isDefault && (
            <button
              className={styles.deleteBtn}
              onClick={(e) => {
                e.stopPropagation();
                onDelete(circle.id, circle.name);
              }}
              aria-label={`Delete ${circle.name}`}
            >
              ×
            </button>
          )}
        </Card>
      ))}
    </div>
  );
}

// ── List view ──

function CirclesListView({
  circles,
  selectedId,
  onSelect,
  onDelete,
}: {
  circles: Circle[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string, name: string) => void;
}) {
  return (
    <ul className={styles.listView} aria-label="Your circles">
      {circles.map((circle) => (
        <li key={circle.id} className={styles.listItem}>
          <Card
            className={`${styles.listCard} ${selectedId === circle.id ? styles.selected : ""}`}
            onClick={() => onSelect(circle.id)}
          >
            <span
              className={styles.listColor}
              style={{ backgroundColor: circle.color }}
              aria-hidden="true"
            />
            <div className={styles.listInfo}>
              <span className={styles.listName}>{circle.name}</span>
              <span className={styles.listMeta}>
                {circle.memberCount}{" "}
                {circle.memberCount === 1 ? "person" : "people"}
                {circle.isDefault ? " — Default" : ""}
              </span>
            </div>
            {!circle.isDefault && (
              <button
                className={styles.deleteBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(circle.id, circle.name);
                }}
                aria-label={`Delete ${circle.name}`}
              >
                ×
              </button>
            )}
          </Card>
        </li>
      ))}
    </ul>
  );
}

// ── Circle detail panel ──

function CircleDetailPanel({
  circle,
  onAddMember,
  onRemoveMember,
  addUsername,
  setAddUsername,
  onClose,
  onDragStart,
}: {
  circle: CircleDetail;
  onAddMember: (e: React.FormEvent) => void;
  onRemoveMember: (id: string, name: string) => void;
  addUsername: string;
  setAddUsername: (v: string) => void;
  onClose: () => void;
  onDragStart: (e: React.DragEvent, member: CircleMember) => void;
}) {
  return (
    <Card className={styles.detailPanel} aria-label={`${circle.name} details`}>
      <div className={styles.detailHeader}>
        <h2
          className={styles.detailTitle}
          style={{ borderLeftColor: circle.color }}
        >
          {circle.name}
        </h2>
        <button
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="Close detail panel"
        >
          ×
        </button>
      </div>

      <form onSubmit={onAddMember} className={styles.addMemberForm}>
        <Input
          label="Add member by username"
          value={addUsername}
          onChange={(e) => setAddUsername(e.target.value)}
          placeholder="username"
        />
        <Button type="submit" size="sm">
          Add
        </Button>
      </form>

      {circle.members.length === 0 ? (
        <p className={styles.emptyMembers}>No members yet</p>
      ) : (
        <ul className={styles.memberList} aria-label="Circle members">
          {circle.members.map((member) => (
            <li
              key={member.id}
              className={styles.memberItem}
              draggable
              onDragStart={(e) => onDragStart(e, member)}
            >
              <div className={styles.memberAvatar} aria-hidden="true">
                {member.displayName?.charAt(0) ??
                  member.username.charAt(0)}
              </div>
              <div className={styles.memberInfo}>
                <span className={styles.memberName}>
                  {member.displayName || member.username}
                </span>
                <span className={styles.memberUsername}>
                  @{member.username}
                </span>
              </div>
              <button
                className={styles.removeMemberBtn}
                onClick={() =>
                  onRemoveMember(
                    member.id,
                    member.displayName || member.username
                  )
                }
                aria-label={`Remove ${member.displayName || member.username}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
