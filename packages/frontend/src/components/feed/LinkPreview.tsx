"use client";

import styles from "./LinkPreview.module.css";

export interface LinkPreviewData {
  url: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
  domain: string;
}

interface LinkPreviewProps {
  preview: LinkPreviewData;
  onRemove?: () => void;
}

export function LinkPreview({ preview, onRemove }: LinkPreviewProps) {
  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      className={styles.card}
      aria-label={`Link preview: ${preview.title ?? preview.url}`}
    >
      {onRemove && (
        <button
          type="button"
          className={styles.removeButton}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }}
          aria-label="Remove link preview"
        >
          &times;
        </button>
      )}

      {preview.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview.imageUrl}
          alt=""
          className={styles.image}
          loading="lazy"
        />
      )}

      <div className={styles.content}>
        {preview.title && <div className={styles.title}>{preview.title}</div>}

        {preview.description && (
          <div className={styles.description}>{preview.description}</div>
        )}

        <div className={styles.domain}>
          {preview.siteName ? `${preview.siteName} · ${preview.domain}` : preview.domain}
        </div>
      </div>
    </a>
  );
}
