import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { z } from "zod";
import { authMiddleware } from "../../../middleware/auth.js";
import {
  uploadMedia,
  attachMediaToPost,
  getMediaByPost,
  getUserMedia,
  updateAltText,
  deleteMedia,
  createAlbum,
  getUserAlbums,
  addToAlbum,
  getAlbumPhotos,
} from "../../../services/media.js";

const updateAltTextSchema = z.object({
  altText: z.string().max(1500),
});

const createAlbumSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(2000).optional(),
});

const addToAlbumSchema = z.object({
  mediaId: z.string().uuid(),
});

export async function mediaRoutes(app: FastifyInstance) {
  // Register multipart support for file uploads
  await app.register(multipart, {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50 MB
      files: 50,
    },
  });

  // Upload media
  app.post(
    "/api/v1/media",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const file = await request.file();
      if (!file) {
        return reply.status(400).send({ error: "No file uploaded" });
      }

      const buffer = await file.toBuffer();
      const altText =
        (file.fields.altText as { value?: string } | undefined)?.value ?? "";

      const result = await uploadMedia(
        request.user!.userId,
        buffer,
        file.filename,
        file.mimetype,
        altText
      );

      return reply.status(201).send(result);
    }
  );

  // Get user's media
  app.get(
    "/api/v1/media",
    { preHandler: [authMiddleware] },
    async (request) => {
      const { limit, offset } = request.query as {
        limit?: string;
        offset?: string;
      };
      return getUserMedia(
        request.user!.userId,
        limit ? parseInt(limit, 10) : 50,
        offset ? parseInt(offset, 10) : 0
      );
    }
  );

  // Get media for a post
  app.get("/api/v1/posts/:postId/media", async (request) => {
    const { postId } = request.params as { postId: string };
    return getMediaByPost(postId);
  });

  // Update alt text
  app.patch(
    "/api/v1/media/:id",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { altText } = updateAltTextSchema.parse(request.body);
      const updated = await updateAltText(id, request.user!.userId, altText);
      if (!updated) {
        return reply.status(404).send({ error: "Media not found" });
      }
      return updated;
    }
  );

  // Delete media
  app.delete(
    "/api/v1/media/:id",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const deleted = await deleteMedia(id, request.user!.userId);
      if (!deleted) {
        return reply.status(404).send({ error: "Media not found" });
      }
      return { ok: true };
    }
  );

  // Albums

  // Create album
  app.post(
    "/api/v1/albums",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const input = createAlbumSchema.parse(request.body);
      const album = await createAlbum(
        request.user!.userId,
        input.name,
        input.description
      );
      return reply.status(201).send(album);
    }
  );

  // Get user's albums
  app.get(
    "/api/v1/albums",
    { preHandler: [authMiddleware] },
    async (request) => {
      return getUserAlbums(request.user!.userId);
    }
  );

  // Get album photos
  app.get("/api/v1/albums/:id/photos", async (request) => {
    const { id } = request.params as { id: string };
    return getAlbumPhotos(id);
  });

  // Add media to album
  app.post(
    "/api/v1/albums/:id/photos",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { mediaId } = addToAlbumSchema.parse(request.body);
      const added = await addToAlbum(mediaId, id, request.user!.userId);
      if (!added) {
        return reply.status(404).send({ error: "Album not found" });
      }
      return { ok: true };
    }
  );
}
