import type { FastifyRequest, FastifyReply } from "fastify";
import IORedis from "ioredis";
import { config } from "../config.js";
import { RATE_LIMITS } from "@fediplus/shared";

const redis = new IORedis(config.redis.url, { maxRetriesPerRequest: null });

interface RateLimitConfig {
  max: number;
  windowMs: number;
  keyPrefix?: string;
}

function getClientIp(request: FastifyRequest): string {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  return request.ip;
}

async function checkRateLimit(
  key: string,
  max: number,
  windowMs: number
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const windowSec = Math.ceil(windowMs / 1000);
  const now = Date.now();
  const windowStart = now - windowMs;

  const multi = redis.multi();
  multi.zremrangebyscore(key, 0, windowStart);
  multi.zadd(key, now.toString(), `${now}:${Math.random()}`);
  multi.zcard(key);
  multi.expire(key, windowSec);

  const results = await multi.exec();
  const count = (results?.[2]?.[1] as number) ?? 0;

  return {
    allowed: count <= max,
    remaining: Math.max(0, max - count),
    resetAt: now + windowMs,
  };
}

function setRateLimitHeaders(
  reply: FastifyReply,
  max: number,
  remaining: number,
  resetAt: number
) {
  reply.header("X-RateLimit-Limit", max);
  reply.header("X-RateLimit-Remaining", remaining);
  reply.header("X-RateLimit-Reset", Math.ceil(resetAt / 1000));
}

export function rateLimitMiddleware(opts?: Partial<RateLimitConfig>) {
  return async function rateLimit(
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    const userId = request.user?.userId;
    const ip = getClientIp(request);
    const isAuthenticated = !!userId;

    const limits = isAuthenticated
      ? RATE_LIMITS.user
      : RATE_LIMITS.guest;

    const prefix = opts?.keyPrefix ?? "rl";
    const max = opts?.max ?? limits.perMinute;
    const windowMs = opts?.windowMs ?? 60_000;

    const identifier = isAuthenticated ? userId : ip;
    const key = `${prefix}:${identifier}`;

    const result = await checkRateLimit(key, max, windowMs);
    setRateLimitHeaders(reply, max, result.remaining, result.resetAt);

    if (!result.allowed) {
      reply.header("Retry-After", Math.ceil(windowMs / 1000));
      return reply.status(429).send({
        error: "Too many requests",
        retryAfter: Math.ceil(windowMs / 1000),
      });
    }
  };
}

export function authRateLimitMiddleware() {
  return rateLimitMiddleware({
    max: RATE_LIMITS.auth.perMinute,
    windowMs: 60_000,
    keyPrefix: "rl:auth",
  });
}

export function uploadRateLimitMiddleware() {
  return rateLimitMiddleware({
    max: RATE_LIMITS.uploads.perDay,
    windowMs: 86_400_000,
    keyPrefix: "rl:upload",
  });
}

export function reportRateLimitMiddleware() {
  return rateLimitMiddleware({
    max: RATE_LIMITS.reports.perDay,
    windowMs: 86_400_000,
    keyPrefix: "rl:report",
  });
}
