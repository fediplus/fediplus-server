import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import sharp from "sharp";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "../db/connection.js";
import { media, albums } from "../db/schema/media.js";
import { config } from "../config.js";

// Lazy-init S3 client only when needed
let _s3: S3Client | null = null;
function getS3(): S3Client {
  if (!_s3) {
    _s3 = new S3Client({
      endpoint: config.s3.endpoint,
      region: config.s3.region,
      credentials: {
        accessKeyId: config.s3.accessKey,
        secretAccessKey: config.s3.secretKey,
      },
      forcePathStyle: true,
    });
  }
  return _s3;
}

const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/ogg",
];

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const THUMBNAIL_SIZE = 400;
const MAX_IMAGE_DIMENSION = 2048;

interface UploadResult {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  blurhash: string | null;
  width: number | null;
  height: number | null;
  mimeType: string;
  size: number;
}

// Storage helpers

async function storeFile(
  key: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  if (config.storage.type === "local") {
    const filePath = resolve(config.storage.localPath, key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, body);
  } else {
    await getS3().send(
      new PutObjectCommand({
        Bucket: config.s3.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      })
    );
  }
}

async function deleteFile(key: string): Promise<void> {
  if (config.storage.type === "local") {
    const filePath = resolve(config.storage.localPath, key);
    await unlink(filePath).catch(() => {});
  } else {
    await getS3()
      .send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: key }))
      .catch(() => {});
  }
}

const localBaseUrl = `http://${config.host === "0.0.0.0" ? "localhost" : config.host}:${config.port}`;

function buildMediaUrl(key: string): string {
  if (config.storage.type === "local") {
    return `${localBaseUrl}/media/${key}`;
  }
  return `${config.s3.endpoint}/${config.s3.bucket}/${key}`;
}

function extractKey(url: string): string {
  if (config.storage.type === "local") {
    return url.replace(`${localBaseUrl}/media/`, "");
  }
  return url.replace(`${config.s3.endpoint}/${config.s3.bucket}/`, "");
}

export async function uploadMedia(
  userId: string,
  fileBuffer: Buffer,
  originalFilename: string,
  mimeType: string,
  altText: string = ""
): Promise<UploadResult> {
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    throw Object.assign(new Error("Unsupported file type"), {
      statusCode: 400,
    });
  }

  if (fileBuffer.length > MAX_FILE_SIZE) {
    throw Object.assign(new Error("File too large (max 50MB)"), {
      statusCode: 400,
    });
  }

  const isImage = mimeType.startsWith("image/");
  const ext = mimeType.split("/")[1].replace("jpeg", "jpg");
  const id = randomUUID();
  const filename = `${id}.${ext}`;
  const key = `media/${userId}/${filename}`;

  let processedBuffer = fileBuffer;
  let width: number | null = null;
  let height: number | null = null;
  let thumbnailUrl: string | null = null;
  let blurhash: string | null = null;

  if (isImage && mimeType !== "image/gif") {
    // Process image: resize if too large, convert to WebP for efficiency
    const image = sharp(fileBuffer);
    const metadata = await image.metadata();
    width = metadata.width ?? null;
    height = metadata.height ?? null;

    // Resize if exceeds max dimension
    if (
      (width && width > MAX_IMAGE_DIMENSION) ||
      (height && height > MAX_IMAGE_DIMENSION)
    ) {
      const resized = await image
        .resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, { fit: "inside" })
        .toBuffer({ resolveWithObject: true });
      processedBuffer = resized.data;
      width = resized.info.width;
      height = resized.info.height;
    }

    // Generate thumbnail
    const thumbnailBuffer = await sharp(processedBuffer)
      .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: "cover" })
      .webp({ quality: 75 })
      .toBuffer();

    const thumbnailKey = `media/${userId}/thumb_${id}.webp`;
    await storeFile(thumbnailKey, thumbnailBuffer, "image/webp");
    thumbnailUrl = buildMediaUrl(thumbnailKey);

    // Generate blurhash (small version for fast encoding)
    try {
      const { data, info } = await sharp(processedBuffer)
        .resize(32, 32, { fit: "inside" })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      // Simple blurhash-like placeholder (base64 of tiny image)
      const tinyBuffer = await sharp(processedBuffer)
        .resize(4, 4, { fit: "cover" })
        .webp({ quality: 1 })
        .toBuffer();
      blurhash = `data:image/webp;base64,${tinyBuffer.toString("base64")}`;
    } catch {
      // Blurhash generation is optional
    }
  }

  // Upload original/processed file
  await storeFile(key, processedBuffer, mimeType);
  const url = buildMediaUrl(key);

  const mediaType = mimeType.startsWith("image/")
    ? "image"
    : mimeType.startsWith("video/")
      ? "video"
      : mimeType.startsWith("audio/")
        ? "audio"
        : "document";

  const [record] = await db
    .insert(media)
    .values({
      userId,
      type: mediaType as "image" | "video" | "audio" | "document",
      filename,
      originalFilename,
      mimeType,
      size: processedBuffer.length,
      width,
      height,
      url,
      thumbnailUrl,
      blurhash,
      altText,
    })
    .returning();

  return {
    id: record.id,
    url,
    thumbnailUrl,
    blurhash,
    width,
    height,
    mimeType,
    size: processedBuffer.length,
  };
}

export async function attachMediaToPost(mediaIds: string[], postId: string) {
  for (const mediaId of mediaIds) {
    await db
      .update(media)
      .set({ postId })
      .where(eq(media.id, mediaId));
  }
}

export async function getMediaByPost(postId: string) {
  return db
    .select()
    .from(media)
    .where(eq(media.postId, postId))
    .orderBy(media.createdAt);
}

export async function getUserMedia(userId: string, limit = 50, offset = 0) {
  return db
    .select()
    .from(media)
    .where(and(eq(media.userId, userId), eq(media.type, "image")))
    .orderBy(desc(media.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function updateAltText(
  mediaId: string,
  userId: string,
  altText: string
) {
  const [updated] = await db
    .update(media)
    .set({ altText })
    .where(and(eq(media.id, mediaId), eq(media.userId, userId)))
    .returning();
  return updated ?? null;
}

export async function deleteMedia(mediaId: string, userId: string) {
  const record = await db.query.media.findFirst({
    where: and(eq(media.id, mediaId), eq(media.userId, userId)),
  });
  if (!record) return false;

  // Delete files
  const key = extractKey(record.url);
  await deleteFile(key);

  if (record.thumbnailUrl) {
    const thumbKey = extractKey(record.thumbnailUrl);
    await deleteFile(thumbKey);
  }

  await db.delete(media).where(eq(media.id, mediaId));
  return true;
}

// Albums

export async function createAlbum(
  userId: string,
  name: string,
  description = ""
) {
  const [album] = await db
    .insert(albums)
    .values({ userId, name, description })
    .returning();
  return album;
}

export async function getUserAlbums(userId: string) {
  const result = await db
    .select()
    .from(albums)
    .where(eq(albums.userId, userId))
    .orderBy(desc(albums.createdAt));

  return Promise.all(
    result.map(async (album) => {
      const [count] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(media)
        .where(eq(media.albumId, album.id));
      return { ...album, photoCount: count.count };
    })
  );
}

export async function addToAlbum(
  mediaId: string,
  albumId: string,
  userId: string
) {
  const album = await db.query.albums.findFirst({
    where: and(eq(albums.id, albumId), eq(albums.userId, userId)),
  });
  if (!album) return false;

  await db
    .update(media)
    .set({ albumId })
    .where(and(eq(media.id, mediaId), eq(media.userId, userId)));
  return true;
}

export async function getAlbumPhotos(albumId: string) {
  return db
    .select()
    .from(media)
    .where(and(eq(media.albumId, albumId), eq(media.type, "image")))
    .orderBy(media.createdAt);
}
