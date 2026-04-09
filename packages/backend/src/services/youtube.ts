import { eq } from "drizzle-orm";
import { db } from "../db/connection.js";
import { youtubeConnections } from "../db/schema/youtube.js";
import { config } from "../config.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

const SCOPES = [
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/youtube.force-ssl",
].join(" ");

function getRedirectUri(): string {
  return `${config.publicUrl}/api/v1/youtube/callback`;
}

/**
 * Generate the Google OAuth2 consent URL.
 * The `state` parameter carries our JWT-encoded userId so we can
 * associate the token with the right account on callback.
 */
export function getOAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: getRedirectUri(),
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

/**
 * Exchange an authorization code for tokens.
 */
export async function exchangeCode(code: string): Promise<TokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      redirect_uri: getRedirectUri(),
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google token exchange failed: ${body}`);
  }

  return res.json() as Promise<TokenResponse>;
}

/**
 * Refresh an expired access token using the stored refresh token.
 */
async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google token refresh failed: ${body}`);
  }

  return res.json() as Promise<TokenResponse>;
}

/**
 * Get a valid access token for the user, refreshing if expired.
 */
async function getValidAccessToken(userId: string): Promise<string> {
  const conn = await getYouTubeConnection(userId);
  if (!conn) {
    throw Object.assign(new Error("YouTube account not connected"), {
      statusCode: 400,
    });
  }

  // If token expires within 60 seconds, refresh it
  const bufferMs = 60_000;
  if (conn.tokenExpiresAt.getTime() - bufferMs > Date.now()) {
    return conn.accessToken;
  }

  const tokens = await refreshAccessToken(conn.refreshToken);

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  await db
    .update(youtubeConnections)
    .set({
      accessToken: tokens.access_token,
      tokenExpiresAt: expiresAt,
      // Google may issue a new refresh token
      ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
      updatedAt: new Date(),
    })
    .where(eq(youtubeConnections.userId, userId));

  return tokens.access_token;
}

interface YouTubeChannel {
  id: string;
  snippet: {
    title: string;
    thumbnails?: { default?: { url: string } };
  };
}

/**
 * Fetch the authenticated user's YouTube channel info.
 */
export async function fetchChannelInfo(
  accessToken: string
): Promise<YouTubeChannel> {
  const url = `${YOUTUBE_API_BASE}/channels?part=snippet&mine=true`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error("Failed to fetch YouTube channel info");
  }

  const data = (await res.json()) as { items?: YouTubeChannel[] };
  if (!data.items || data.items.length === 0) {
    throw Object.assign(
      new Error("No YouTube channel found for this account"),
      { statusCode: 400 }
    );
  }

  return data.items[0];
}

/**
 * Save or update the YouTube connection for a user.
 */
export async function saveYouTubeConnection(
  userId: string,
  channelId: string,
  channelTitle: string,
  accessToken: string,
  refreshToken: string,
  expiresIn: number
) {
  const expiresAt = new Date(Date.now() + expiresIn * 1000);
  const existing = await getYouTubeConnection(userId);

  if (existing) {
    const [updated] = await db
      .update(youtubeConnections)
      .set({
        channelId,
        channelTitle,
        accessToken,
        refreshToken,
        tokenExpiresAt: expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(youtubeConnections.userId, userId))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(youtubeConnections)
    .values({
      userId,
      channelId,
      channelTitle,
      accessToken,
      refreshToken,
      tokenExpiresAt: expiresAt,
    })
    .returning();
  return created;
}

/**
 * Get the YouTube connection for a user.
 */
export async function getYouTubeConnection(userId: string) {
  const [conn] = await db
    .select()
    .from(youtubeConnections)
    .where(eq(youtubeConnections.userId, userId));
  return conn ?? null;
}

/**
 * Disconnect YouTube — delete stored tokens.
 */
export async function disconnectYouTube(userId: string): Promise<boolean> {
  const conn = await getYouTubeConnection(userId);
  if (!conn) return false;

  // Attempt to revoke the token at Google (best-effort)
  try {
    await fetch(
      `https://oauth2.googleapis.com/revoke?token=${conn.refreshToken}`,
      { method: "POST" }
    );
  } catch {
    // Ignore revocation failures
  }

  await db
    .delete(youtubeConnections)
    .where(eq(youtubeConnections.userId, userId));
  return true;
}

interface LiveBroadcast {
  id: string;
  snippet: { title: string };
  contentDetails: { boundStreamId?: string };
  status: { lifeCycleStatus: string };
}

interface LiveStream {
  id: string;
  cdn: {
    ingestionInfo: {
      ingestionAddress: string;
      streamName: string;
      backupIngestionAddress?: string;
    };
  };
}

/**
 * Create a YouTube live broadcast + bound stream and return the
 * RTMP ingestion URL and stream key.
 */
export async function createYouTubeBroadcast(
  userId: string,
  title: string
): Promise<{
  broadcastId: string;
  rtmpUrl: string;
  streamKey: string;
}> {
  const accessToken = await getValidAccessToken(userId);

  // 1. Create the live broadcast
  const broadcastRes = await fetch(
    `${YOUTUBE_API_BASE}/liveBroadcasts?part=snippet,contentDetails,status`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        snippet: {
          title,
          scheduledStartTime: new Date().toISOString(),
        },
        contentDetails: {
          enableAutoStart: true,
          enableAutoStop: true,
        },
        status: {
          privacyStatus: "public",
          selfDeclaredMadeForKids: false,
        },
      }),
    }
  );

  if (!broadcastRes.ok) {
    const body = await broadcastRes.text();
    throw new Error(`Failed to create YouTube broadcast: ${body}`);
  }

  const broadcast = (await broadcastRes.json()) as LiveBroadcast;

  // 2. Create the live stream (ingestion endpoint)
  const streamRes = await fetch(
    `${YOUTUBE_API_BASE}/liveStreams?part=snippet,cdn`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        snippet: {
          title: `${title} - Stream`,
        },
        cdn: {
          frameRate: "30fps",
          ingestionType: "rtmp",
          resolution: "1080p",
        },
      }),
    }
  );

  if (!streamRes.ok) {
    const body = await streamRes.text();
    throw new Error(`Failed to create YouTube stream: ${body}`);
  }

  const stream = (await streamRes.json()) as LiveStream;

  // 3. Bind the stream to the broadcast
  const bindRes = await fetch(
    `${YOUTUBE_API_BASE}/liveBroadcasts/bind?id=${broadcast.id}&part=id,contentDetails&streamId=${stream.id}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!bindRes.ok) {
    const body = await bindRes.text();
    throw new Error(`Failed to bind stream to broadcast: ${body}`);
  }

  return {
    broadcastId: broadcast.id,
    rtmpUrl: stream.cdn.ingestionInfo.ingestionAddress,
    streamKey: stream.cdn.ingestionInfo.streamName,
  };
}
