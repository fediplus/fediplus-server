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

interface Collection {
  id: string;
  name: string;
  description: string;
  isPublic: boolean;
  itemCount: number;
}

export default function CollectionsPage() {
  const user = useAuthStore((s) => s.user);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    apiFetch<Collection[]>(`/api/v1/users/${user.username}/collections`)
      .then(setCollections)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user]);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.heading}>Collections</h1>
        {user && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowCreate(!showCreate)}
          >
            New collection
          </Button>
        )}
      </header>

      {showCreate && (
        <CreateCollectionForm
          onCreated={(c) => {
            setCollections((prev) => [c, ...prev]);
            setShowCreate(false);
            announce("Collection created");
          }}
        />
      )}

      {!user ? (
        <p className={styles.empty}>Sign in to create and view your collections.</p>
      ) : loading ? (
        <p role="status">Loading collections...</p>
      ) : collections.length === 0 ? (
        <p className={styles.empty}>
          No collections yet. Create one to start curating posts.
        </p>
      ) : (
        <div className={styles.grid} role="list" aria-label="Your collections">
          {collections.map((collection) => (
            <Link
              key={collection.id}
              href={`/collections/${collection.id}`}
              className={styles.cardLink}
              role="listitem"
            >
              <Card className={styles.collectionCard}>
                <h2 className={styles.collectionName}>{collection.name}</h2>
                <p className={styles.collectionDesc}>
                  {collection.description || "No description"}
                </p>
                <p className={styles.collectionMeta}>
                  {collection.itemCount}{" "}
                  {collection.itemCount === 1 ? "item" : "items"}
                  {!collection.isPublic && " · Private"}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateCollectionForm({
  onCreated,
}: {
  onCreated: (collection: Collection) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const collection = await apiFetch<Collection>("/api/v1/collections", {
        method: "POST",
        body: JSON.stringify({ name, description }),
      });
      onCreated(collection);
      setName("");
      setDescription("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className={styles.createForm}>
      <h2 className={styles.formTitle}>Create a collection</h2>
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
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Button type="submit" disabled={submitting || !name}>
          {submitting ? "Creating..." : "Create"}
        </Button>
      </form>
    </Card>
  );
}
