"use client";

import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useAuthStore } from "@/stores/auth";
import { apiFetch } from "@/hooks/useApi";
import { announce } from "@/a11y/announcer";
import styles from "./page.module.css";

interface MediaItem {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  altText: string;
  width: number | null;
  height: number | null;
  createdAt: string;
  albumId: string | null;
}

interface Album {
  id: string;
  name: string;
  description: string;
  photoCount: number;
  createdAt: string;
}

export default function PhotosPage() {
  const user = useAuthStore((s) => s.user);
  const [photos, setPhotos] = useState<MediaItem[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [selectedAlbum, setSelectedAlbum] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreateAlbum, setShowCreateAlbum] = useState(false);
  const [albumName, setAlbumName] = useState("");

  const fetchPhotos = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      if (selectedAlbum) {
        const items = await apiFetch<MediaItem[]>(
          `/api/v1/albums/${selectedAlbum}/photos`
        );
        setPhotos(items);
      } else {
        const items = await apiFetch<MediaItem[]>("/api/v1/media");
        setPhotos(items);
      }
    } catch {
      // Ignore
    } finally {
      setLoading(false);
    }
  }, [user, selectedAlbum]);

  useEffect(() => {
    if (!user) return;
    apiFetch<Album[]>("/api/v1/albums")
      .then(setAlbums)
      .catch(() => {});
    fetchPhotos();
  }, [user, fetchPhotos]);

  async function handleCreateAlbum() {
    if (!albumName.trim()) return;
    try {
      const album = await apiFetch<Album>("/api/v1/albums", {
        method: "POST",
        body: JSON.stringify({ name: albumName }),
      });
      setAlbums((prev) => [{ ...album, photoCount: 0 }, ...prev]);
      setAlbumName("");
      setShowCreateAlbum(false);
      announce("Album created");
    } catch {
      announce("Failed to create album", "assertive");
    }
  }

  function openLightbox(index: number) {
    setLightboxIndex(index);
  }

  function closeLightbox() {
    setLightboxIndex(null);
  }

  function lightboxPrev() {
    if (lightboxIndex === null) return;
    setLightboxIndex(lightboxIndex > 0 ? lightboxIndex - 1 : photos.length - 1);
  }

  function lightboxNext() {
    if (lightboxIndex === null) return;
    setLightboxIndex(lightboxIndex < photos.length - 1 ? lightboxIndex + 1 : 0);
  }

  function handleLightboxKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") closeLightbox();
    else if (e.key === "ArrowLeft") lightboxPrev();
    else if (e.key === "ArrowRight") lightboxNext();
  }

  if (!user) {
    return <p>Please log in to view your photos.</p>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Photos</h1>
      </div>

      {/* Albums strip */}
      <div className={styles.albumStrip} role="tablist" aria-label="Photo albums">
        <button
          role="tab"
          aria-selected={selectedAlbum === null}
          className={`${styles.albumTab} ${selectedAlbum === null ? styles.albumTabActive : ""}`}
          onClick={() => setSelectedAlbum(null)}
        >
          All Photos
        </button>
        {albums.map((album) => (
          <button
            key={album.id}
            role="tab"
            aria-selected={selectedAlbum === album.id}
            className={`${styles.albumTab} ${selectedAlbum === album.id ? styles.albumTabActive : ""}`}
            onClick={() => setSelectedAlbum(album.id)}
          >
            {album.name} ({album.photoCount})
          </button>
        ))}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowCreateAlbum(!showCreateAlbum)}
        >
          + New Album
        </Button>
      </div>

      {showCreateAlbum && (
        <Card className={styles.createAlbum}>
          <div className={styles.createAlbumForm}>
            <Input
              label="Album name"
              value={albumName}
              onChange={(e) => setAlbumName(e.target.value)}
              placeholder="My Album"
            />
            <Button variant="primary" size="sm" onClick={handleCreateAlbum}>
              Create
            </Button>
          </div>
        </Card>
      )}

      {loading ? (
        <p role="status">Loading photos...</p>
      ) : photos.length === 0 ? (
        <p className={styles.empty}>
          {selectedAlbum ? "No photos in this album." : "No photos yet. Upload some with your posts!"}
        </p>
      ) : (
        <div
          className={styles.photoGrid}
          role="list"
          aria-label="Photo gallery"
        >
          {photos.map((photo, i) => (
            <button
              key={photo.id}
              className={styles.photoCell}
              onClick={() => openLightbox(i)}
              role="listitem"
              aria-label={photo.altText || `Photo ${i + 1}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.thumbnailUrl || photo.url}
                alt={photo.altText || ""}
                className={styles.photoImage}
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightboxIndex !== null && photos[lightboxIndex] && (
        <div
          className={styles.lightbox}
          role="dialog"
          aria-label="Photo viewer"
          aria-modal="true"
          onClick={closeLightbox}
          onKeyDown={handleLightboxKey}
          tabIndex={0}
        >
          <div
            className={styles.lightboxContent}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className={styles.lightboxClose}
              onClick={closeLightbox}
              aria-label="Close"
            >
              &times;
            </button>
            <button
              className={`${styles.lightboxNav} ${styles.lightboxPrev}`}
              onClick={lightboxPrev}
              aria-label="Previous photo"
            >
              &lsaquo;
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photos[lightboxIndex].url}
              alt={photos[lightboxIndex].altText || "Photo"}
              className={styles.lightboxImage}
            />
            <button
              className={`${styles.lightboxNav} ${styles.lightboxNext}`}
              onClick={lightboxNext}
              aria-label="Next photo"
            >
              &rsaquo;
            </button>
            {photos[lightboxIndex].altText && (
              <p className={styles.lightboxAlt}>
                {photos[lightboxIndex].altText}
              </p>
            )}
            <p className={styles.lightboxCounter}>
              {lightboxIndex + 1} / {photos.length}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
