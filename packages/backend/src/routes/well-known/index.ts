import type { FastifyInstance } from "fastify";
import { eq, sql } from "drizzle-orm";
import { db } from "../../db/connection.js";
import { users } from "../../db/schema/users.js";
import { posts } from "../../db/schema/posts.js";
import { config } from "../../config.js";

export async function wellKnownRoutes(app: FastifyInstance) {
  // WebFinger - handled by Fedify integration, but we add a fallback
  app.get("/.well-known/webfinger", async (request, reply) => {
    const { resource } = request.query as { resource?: string };
    if (!resource) {
      return reply.status(400).send({ error: "Missing resource parameter" });
    }

    const match = resource.match(/^acct:([^@]+)@(.+)$/);
    if (!match) {
      return reply.status(400).send({ error: "Invalid resource format" });
    }

    const [, username, domain] = match;
    if (domain !== config.domain) {
      return reply.status(404).send({ error: "Unknown domain" });
    }

    const user = await db.query.users.findFirst({
      where: eq(users.username, username),
    });
    if (!user) {
      return reply.status(404).send({ error: "User not found" });
    }

    return reply
      .header("Content-Type", "application/jrd+json")
      .send({
        subject: `acct:${username}@${domain}`,
        aliases: [user.actorUri],
        links: [
          {
            rel: "self",
            type: "application/activity+json",
            href: user.actorUri,
          },
          {
            rel: "http://webfinger.net/rel/profile-page",
            type: "text/html",
            href: `${config.publicUrl}/@${username}`,
          },
        ],
      });
  });

  // NodeInfo
  app.get("/.well-known/nodeinfo", async (_request, reply) => {
    return reply.send({
      links: [
        {
          rel: "http://nodeinfo.diaspora.software/ns/schema/2.1",
          href: `${config.publicUrl}/nodeinfo/2.1`,
        },
      ],
    });
  });

  app.get("/nodeinfo/2.1", async (_request, reply) => {
    const [userCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users);

    const [postCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(posts);

    return reply
      .header("Content-Type", "application/json; profile=\"http://nodeinfo.diaspora.software/ns/schema/2.1#\"")
      .send({
        version: "2.1",
        software: {
          name: "fediplus",
          version: "0.1.0",
          repository: "https://github.com/nicholasgasior/fediplus",
        },
        protocols: ["activitypub"],
        usage: {
          users: {
            total: userCount.count,
            activeMonth: userCount.count,
            activeHalfyear: userCount.count,
          },
          localPosts: postCount.count,
        },
        openRegistrations: true,
        metadata: {
          nodeName: "Fedi+",
          nodeDescription: "Google+ reborn on the Fediverse",
        },
      });
  });
}
