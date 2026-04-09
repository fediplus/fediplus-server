import type { FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import { config } from "../../../config.js";
import { authMiddleware, type AuthPayload } from "../../../middleware/auth.js";
import {
  getOAuthUrl,
  exchangeCode,
  fetchChannelInfo,
  saveYouTubeConnection,
  getYouTubeConnection,
  disconnectYouTube,
  createYouTubeBroadcast,
} from "../../../services/youtube.js";

export async function youtubeRoutes(app: FastifyInstance) {
  /**
   * GET /api/v1/youtube/auth
   * Redirects the user to Google's OAuth2 consent screen.
   * Requires a JWT token as query param (since this is a redirect flow).
   */
  app.get("/api/v1/youtube/auth", async (request, reply) => {
    const { token } = request.query as { token?: string };
    if (!token) {
      return reply.status(400).send({ error: "Missing token parameter" });
    }

    let user: AuthPayload;
    try {
      user = jwt.verify(token, config.jwt.secret) as AuthPayload;
    } catch {
      return reply.status(401).send({ error: "Invalid or expired token" });
    }

    if (!config.google.clientId || !config.google.clientSecret) {
      return reply
        .status(503)
        .send({ error: "YouTube integration is not configured" });
    }

    // Encode userId in state so the callback can link the tokens
    const state = jwt.sign(
      { userId: user.userId },
      config.jwt.secret,
      { expiresIn: "10m" }
    );

    const url = getOAuthUrl(state);
    return reply.redirect(url);
  });

  /**
   * GET /api/v1/youtube/callback
   * Google redirects here after the user consents. Exchanges the code
   * for tokens, fetches channel info, stores everything, and redirects
   * back to the settings page.
   */
  app.get("/api/v1/youtube/callback", async (request, reply) => {
    const { code, state, error: oauthError } = request.query as {
      code?: string;
      state?: string;
      error?: string;
    };

    const settingsUrl = `${config.publicUrl}/settings`;

    if (oauthError) {
      return reply.redirect(
        `${settingsUrl}?youtube_error=${encodeURIComponent(oauthError)}`
      );
    }

    if (!code || !state) {
      return reply.redirect(
        `${settingsUrl}?youtube_error=missing_params`
      );
    }

    let statePayload: { userId: string };
    try {
      statePayload = jwt.verify(state, config.jwt.secret) as {
        userId: string;
      };
    } catch {
      return reply.redirect(
        `${settingsUrl}?youtube_error=invalid_state`
      );
    }

    try {
      const tokens = await exchangeCode(code);

      if (!tokens.refresh_token) {
        return reply.redirect(
          `${settingsUrl}?youtube_error=no_refresh_token`
        );
      }

      const channel = await fetchChannelInfo(tokens.access_token);

      await saveYouTubeConnection(
        statePayload.userId,
        channel.id,
        channel.snippet.title,
        tokens.access_token,
        tokens.refresh_token,
        tokens.expires_in
      );

      return reply.redirect(`${settingsUrl}?youtube_connected=true`);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Unknown error";
      app.log.error({ err: msg }, "YouTube OAuth callback failed");
      return reply.redirect(
        `${settingsUrl}?youtube_error=${encodeURIComponent("connection_failed")}`
      );
    }
  });

  /**
   * GET /api/v1/youtube/connection
   * Returns the current YouTube connection (channel name etc), or null.
   */
  app.get(
    "/api/v1/youtube/connection",
    { preHandler: authMiddleware },
    async (request) => {
      const conn = await getYouTubeConnection(request.user!.userId);
      if (!conn) return { connected: false };

      return {
        connected: true,
        channelId: conn.channelId,
        channelTitle: conn.channelTitle,
        connectedAt: conn.createdAt,
      };
    }
  );

  /**
   * DELETE /api/v1/youtube/connection
   * Disconnect the YouTube account (revokes tokens).
   */
  app.delete(
    "/api/v1/youtube/connection",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const removed = await disconnectYouTube(request.user!.userId);
      if (!removed) {
        return reply
          .status(404)
          .send({ error: "No YouTube account connected" });
      }
      return { disconnected: true };
    }
  );

  /**
   * POST /api/v1/youtube/broadcast
   * Creates a YouTube live broadcast + stream, returns RTMP details.
   * Used when starting a Hangout On Air with YouTube as the destination.
   */
  app.post(
    "/api/v1/youtube/broadcast",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { title } = request.body as { title?: string };
      const broadcastTitle = title || "Fedi+ Hangout On Air";

      try {
        const result = await createYouTubeBroadcast(
          request.user!.userId,
          broadcastTitle
        );
        return result;
      } catch (err) {
        const statusCode =
          (err as { statusCode?: number }).statusCode ?? 500;
        const message =
          err instanceof Error ? err.message : "Failed to create broadcast";
        return reply.status(statusCode).send({ error: message });
      }
    }
  );
}
