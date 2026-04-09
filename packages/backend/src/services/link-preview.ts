import { db } from "../db/connection.js";
import { posts } from "../db/schema/posts.js";
import { eq } from "drizzle-orm";

export interface LinkPreviewData {
  url: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
  domain: string;
}

const URL_REGEX =
  /https?:\/\/(?:[\w-]+\.)+[a-z]{2,}(?:\/[^\s<>()"\u00A0]*)?/gi;

const FETCH_TIMEOUT = 8000;
const MAX_BODY_SIZE = 512 * 1024; // 512 KB of HTML is plenty

/**
 * Extract the first URL from text content.
 */
export function extractFirstUrl(text: string): string | null {
  const match = text.match(URL_REGEX);
  return match ? match[0] : null;
}

/**
 * Extract all URLs from text content.
 */
export function extractUrls(text: string): string[] {
  return [...text.matchAll(URL_REGEX)].map((m) => m[0]);
}

/**
 * Fetch OpenGraph / meta tag data for a URL.
 * Returns null if the URL is unreachable, non-HTML, or has no useful metadata.
 */
export async function fetchLinkPreview(
  url: string
): Promise<LinkPreviewData | null> {
  try {
    const parsedUrl = new URL(url);

    // Only allow http/https
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return null;
    }

    // Block private/internal IPs (SSRF protection)
    const hostname = parsedUrl.hostname;
    if (isPrivateHost(hostname)) {
      return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "text/html, application/xhtml+xml",
        "User-Agent": "FediPlus/1.0 LinkPreview Bot",
      },
      signal: controller.signal,
      redirect: "follow",
    });

    clearTimeout(timeout);

    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("xhtml")) {
      return null;
    }

    // Read limited body to prevent memory issues
    const body = await readLimitedBody(response, MAX_BODY_SIZE);
    if (!body) return null;

    const meta = parseMetaTags(body);
    const domain = parsedUrl.hostname.replace(/^www\./, "");

    // Must have at least a title
    const title = meta["og:title"] || meta["twitter:title"] || meta["title"];
    if (!title) return null;

    return {
      url,
      title,
      description:
        meta["og:description"] ||
        meta["twitter:description"] ||
        meta["description"] ||
        null,
      imageUrl: meta["og:image"] || meta["twitter:image"] || null,
      siteName: meta["og:site_name"] || null,
      domain,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch and store link preview for a post.
 * Called from the BullMQ worker after post creation.
 */
export async function fetchAndStoreLinkPreview(postId: string): Promise<void> {
  const post = await db.query.posts.findFirst({
    where: eq(posts.id, postId),
  });
  if (!post) return;

  const url = extractFirstUrl(post.content);
  if (!url) return;

  const preview = await fetchLinkPreview(url);
  if (!preview) return;

  await db
    .update(posts)
    .set({ linkPreview: JSON.stringify(preview) })
    .where(eq(posts.id, postId));
}

// ── Internal helpers ──

async function readLimitedBody(
  response: Response,
  maxBytes: number
): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;

  const chunks: Uint8Array[] = [];
  let totalSize = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalSize += value.byteLength;
      if (totalSize > maxBytes) {
        reader.cancel();
        break;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }

  const decoder = new TextDecoder();
  return chunks.map((c) => decoder.decode(c, { stream: true })).join("");
}

/**
 * Simple regex-based meta tag parser.
 * Extracts og:*, twitter:*, and standard meta name/property tags from HTML head.
 */
function parseMetaTags(html: string): Record<string, string> {
  const tags: Record<string, string> = {};

  // Extract <title> content
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (titleMatch) {
    tags["title"] = decodeEntities(titleMatch[1].trim());
  }

  // Extract <meta> tags — property, name, or itemprop
  const metaRegex =
    /<meta\s+[^>]*?(?:property|name|itemprop)\s*=\s*["']([^"']+)["'][^>]*?content\s*=\s*["']([^"']+)["'][^>]*?\/?>/gi;
  const metaRegexReversed =
    /<meta\s+[^>]*?content\s*=\s*["']([^"']+)["'][^>]*?(?:property|name|itemprop)\s*=\s*["']([^"']+)["'][^>]*?\/?>/gi;

  let match: RegExpExecArray | null;

  while ((match = metaRegex.exec(html)) !== null) {
    tags[match[1].toLowerCase()] = decodeEntities(match[2]);
  }

  while ((match = metaRegexReversed.exec(html)) !== null) {
    const key = match[2].toLowerCase();
    if (!tags[key]) {
      tags[key] = decodeEntities(match[1]);
    }
  }

  return tags;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/");
}

function isPrivateHost(hostname: string): boolean {
  // Block localhost
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname === "0.0.0.0"
  ) {
    return true;
  }

  // Block private IP ranges
  const parts = hostname.split(".");
  if (parts.length === 4 && parts.every((p) => /^\d+$/.test(p))) {
    const first = parseInt(parts[0], 10);
    const second = parseInt(parts[1], 10);
    if (first === 10) return true;
    if (first === 172 && second >= 16 && second <= 31) return true;
    if (first === 192 && second === 168) return true;
    if (first === 169 && second === 254) return true; // link-local
  }

  return false;
}
