import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../../../middleware/auth.js";
import { fetchLinkPreview } from "../../../services/link-preview.js";

const previewSchema = z.object({
  url: z.string().url().max(2048),
});

export async function linkPreviewRoutes(app: FastifyInstance) {
  app.post(
    "/api/v1/links/preview",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { url } = previewSchema.parse(request.body);
      const preview = await fetchLinkPreview(url);
      if (!preview) {
        return reply.status(404).send({ error: "Could not generate preview" });
      }
      return preview;
    }
  );
}
