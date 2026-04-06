import {
  createFederation,
  Person,
  Group,
  Service,
  Follow,
  Accept,
  Reject,
  Create,
  Update,
  Note,
  Like,
  Announce,
  Undo,
  Delete,
  Block,
  type Context,
  MemoryKvStore,
  InProcessMessageQueue,
} from "@fedify/fedify";
import { Temporal } from "@js-temporal/polyfill";
import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/connection.js";
import { users, profiles } from "../db/schema/users.js";
import { follows } from "../db/schema/follows.js";
import { posts, reactions } from "../db/schema/posts.js";
import { blocks } from "../db/schema/follows.js";
import { notifications } from "../db/schema/notifications.js";
import { config } from "../config.js";
import { sendEvent } from "../realtime/sse.js";
import { setFederation } from "./outbox.js";

// ── Logging helper ──

const log = {
  info: (msg: string, data?: unknown) =>
    console.log(`[federation] ${msg}`, data ?? ""),
  warn: (msg: string, data?: unknown) =>
    console.warn(`[federation] ${msg}`, data ?? ""),
  error: (msg: string, err?: unknown) =>
    console.error(`[federation] ${msg}`, err ?? ""),
};

// ── Remote user upsert ──

const PROFILE_REFRESH_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

async function upsertRemoteUser(actorUri: string, ctx: Context<unknown>) {
  // Check if already exists
  const existing = await db.query.users.findFirst({
    where: eq(users.actorUri, actorUri),
  });

  if (existing) {
    // Refresh profile if stale (older than 24 hours)
    const age = Date.now() - existing.updatedAt.getTime();
    if (age > PROFILE_REFRESH_INTERVAL) {
      refreshRemoteProfile(actorUri, existing.id, ctx).catch((err) =>
        log.warn(`Failed to refresh profile for ${actorUri}`, err)
      );
    }
    return existing;
  }

  // Fetch the remote actor
  let actor;
  try {
    actor = await ctx.lookupObject(actorUri);
  } catch (err) {
    log.error(`Failed to look up remote actor ${actorUri}`, err);
    return null;
  }

  if (!actor || !(actor instanceof Person || actor instanceof Group || actor instanceof Service)) {
    log.warn(`Remote actor is not a recognized type: ${actorUri}`);
    return null;
  }

  const preferredUsername = actor.preferredUsername ?? actorUri.split("/").pop() ?? "unknown";
  const domain = new URL(actorUri).host;
  const localUsername = `${preferredUsername}@${domain}`;

  const publicKeyPem = "";

  const actorType =
    actor instanceof Group ? "Group" : actor instanceof Service ? "Service" : "Person";

  const [user] = await db
    .insert(users)
    .values({
      username: localUsername.slice(0, 30),
      email: null,
      passwordHash: null,
      isLocal: false,
      domain,
      actorType,
      actorUri,
      inboxUri: actor.inboxId?.href ?? `${actorUri}/inbox`,
      outboxUri: actor.outboxId?.href ?? `${actorUri}/outbox`,
      followersUri: actor.followersId?.href ?? `${actorUri}/followers`,
      followingUri: actor.followingId?.href ?? `${actorUri}/following`,
      publicKey: publicKeyPem,
      privateKey: null,
    })
    .onConflictDoNothing()
    .returning();

  if (!user) {
    // Race condition — fetch again
    return db.query.users.findFirst({ where: eq(users.actorUri, actorUri) });
  }

  // Create a profile for the remote user
  const iconUrl = await getActorIcon(actor);
  const headerUrl = await getActorImage(actor);

  await db.insert(profiles).values({
    userId: user.id,
    displayName: String(actor.name ?? preferredUsername),
    bio: String(actor.summary ?? ""),
    avatarUrl: iconUrl,
    coverUrl: headerUrl,
  });

  log.info(`Stored remote user ${localUsername} (${actorUri})`);
  return user;
}

async function refreshRemoteProfile(
  actorUri: string,
  userId: string,
  ctx: Context<unknown>
) {
  const actor = await ctx.lookupObject(actorUri);
  if (!actor || !(actor instanceof Person || actor instanceof Group || actor instanceof Service)) {
    return;
  }

  const iconUrl = await getActorIcon(actor);
  const headerUrl = await getActorImage(actor);

  await db
    .update(profiles)
    .set({
      displayName: String(actor.name ?? actor.preferredUsername ?? ""),
      bio: String(actor.summary ?? ""),
      avatarUrl: iconUrl ?? undefined,
      coverUrl: headerUrl ?? undefined,
      updatedAt: new Date(),
    })
    .where(eq(profiles.userId, userId));

  await db
    .update(users)
    .set({ updatedAt: new Date() })
    .where(eq(users.id, userId));
}

async function getActorIcon(actor: Person | Group | Service): Promise<string | null> {
  try {
    const icon = await actor.getIcon();
    return icon?.url ? String(icon.url) : null;
  } catch {
    return null;
  }
}

async function getActorImage(actor: Person | Group | Service): Promise<string | null> {
  try {
    const image = await actor.getImage();
    return image?.url ? String(image.url) : null;
  } catch {
    return null;
  }
}

function resolveLocalUsername(uri: URL): string | null {
  const prefix = `${config.publicUrl}/users/`;
  if (uri.href.startsWith(prefix)) {
    return uri.href.slice(prefix.length);
  }
  return null;
}

async function getLocalUserByUsername(username: string) {
  return db.query.users.findFirst({
    where: and(eq(users.username, username), eq(users.isLocal, true)),
  });
}

// ── Federation setup ──

export function setupFederation() {
  const federation = createFederation<void>({
    kv: new MemoryKvStore(),
    queue: new InProcessMessageQueue(),
  });

  // Actor dispatcher
  federation
    .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
      const user = await getLocalUserByUsername(identifier);
      if (!user) return null;

      const profile = await db.query.profiles.findFirst({
        where: eq(profiles.userId, user.id),
      });

      const ActorClass =
        user.actorType === "Group"
          ? Group
          : user.actorType === "Service"
            ? Service
            : Person;

      const actor = new ActorClass({
        id: ctx.getActorUri(identifier),
        preferredUsername: user.username,
        name: profile?.displayName || user.username,
        summary: profile?.bio || undefined,
        inbox: new URL(`${config.publicUrl}/users/${identifier}/inbox`),
        outbox: new URL(`${config.publicUrl}/users/${identifier}/outbox`),
        followers: new URL(
          `${config.publicUrl}/users/${identifier}/followers`
        ),
        following: new URL(
          `${config.publicUrl}/users/${identifier}/following`
        ),
        url: new URL(`${config.publicUrl}/@${identifier}`),
        manuallyApprovesFollowers: false,
        published: Temporal.Instant.fromEpochMilliseconds(user.createdAt.getTime()),
      });

      return actor;
    })
    .setKeyPairsDispatcher(async (_ctx, identifier) => {
      const user = await getLocalUserByUsername(identifier);
      if (!user || !user.privateKey) return [];

      return [
        {
          publicKey: await crypto.subtle.importKey(
            "spki",
            pemToArrayBuffer(user.publicKey),
            { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
            true,
            ["verify"]
          ),
          privateKey: await crypto.subtle.importKey(
            "pkcs8",
            pemToArrayBuffer(user.privateKey),
            { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
            true,
            ["sign"]
          ),
        },
      ];
    });

  // ── Outbox dispatcher ──
  federation.setOutboxDispatcher(
    "/users/{identifier}/outbox",
    async (_ctx, identifier, _cursor) => {
      const user = await getLocalUserByUsername(identifier);
      if (!user) return null;

      const userPosts = await db
        .select()
        .from(posts)
        .where(and(eq(posts.authorId, user.id), eq(posts.visibility, "public")))
        .orderBy(desc(posts.createdAt))
        .limit(20);

      const items = userPosts.map(
        (post) =>
          new Create({
            actor: new URL(user.actorUri),
            object: new Note({
              id: post.apId ? new URL(post.apId) : undefined,
              content: post.content,
              attribution: new URL(user.actorUri),
              published: Temporal.Instant.fromEpochMilliseconds(
                post.createdAt.getTime()
              ),
            }),
          })
      );

      return { items };
    }
  );

  // ── Followers collection dispatcher ──
  federation.setFollowersDispatcher(
    "/users/{identifier}/followers",
    async (_ctx, identifier, _cursor) => {
      const user = await getLocalUserByUsername(identifier);
      if (!user) return null;

      const followerRows = await db
        .select({
          actorUri: users.actorUri,
          inboxUri: users.inboxUri,
        })
        .from(follows)
        .innerJoin(users, eq(follows.followerId, users.id))
        .where(
          and(eq(follows.followingId, user.id), eq(follows.status, "accepted"))
        );

      const items = followerRows.map((r) => new Person({
        id: new URL(r.actorUri),
        inbox: new URL(r.inboxUri),
      }));
      return { items };
    }
  );

  // ── Following collection dispatcher ──
  federation.setFollowingDispatcher(
    "/users/{identifier}/following",
    async (_ctx, identifier, _cursor) => {
      const user = await getLocalUserByUsername(identifier);
      if (!user) return null;

      const followingRows = await db
        .select({
          actorUri: users.actorUri,
          inboxUri: users.inboxUri,
        })
        .from(follows)
        .innerJoin(users, eq(follows.followingId, users.id))
        .where(
          and(eq(follows.followerId, user.id), eq(follows.status, "accepted"))
        );

      const items = followingRows.map((r) => new Person({
        id: new URL(r.actorUri),
        inbox: new URL(r.inboxUri),
      }));
      return { items };
    }
  );

  // ── Inbox listeners ──
  federation
    .setInboxListeners("/users/{identifier}/inbox", "/inbox")

    // ── Follow ──
    .on(Follow, async (ctx, follow) => {
      try {
        const followerUri = follow.actorId;
        const followingUri = follow.objectId;
        if (!followerUri || !followingUri) return;

        const localUsername = resolveLocalUsername(followingUri);
        if (!localUsername) return;

        const localUser = await getLocalUserByUsername(localUsername);
        if (!localUser) return;

        const remoteUser = await upsertRemoteUser(followerUri.href, ctx);
        if (!remoteUser) return;

        // Persist the follow
        const existing = await db.query.follows.findFirst({
          where: and(
            eq(follows.followerId, remoteUser.id),
            eq(follows.followingId, localUser.id)
          ),
        });

        if (!existing) {
          await db.insert(follows).values({
            followerId: remoteUser.id,
            followingId: localUser.id,
            status: "accepted",
            apId: follow.id?.href ?? null,
          });
        }

        // Create notification
        await db.insert(notifications).values({
          userId: localUser.id,
          type: "follow",
          actorId: remoteUser.id,
        });

        // SSE
        sendEvent(localUser.id, "notification", {
          type: "follow",
          actor: { username: remoteUser.username },
        });

        // Send Accept
        const acceptActivity = new Accept({
          actor: followingUri,
          object: follow,
        });

        await ctx.sendActivity(
          { identifier: localUsername },
          "followers",
          acceptActivity
        );

        log.info(`Accepted follow from ${remoteUser.username} → ${localUsername}`);
      } catch (err) {
        log.error("Error handling Follow activity", err);
      }
    })

    // ── Accept ──
    .on(Accept, async (_ctx, accept) => {
      try {
        const followActivity = await accept.getObject();
        if (!(followActivity instanceof Follow)) return;

        const apId = followActivity.id?.href;
        if (!apId) return;

        // Update follow status to accepted
        await db
          .update(follows)
          .set({ status: "accepted", updatedAt: new Date() })
          .where(eq(follows.apId, apId));

        // Notify the follower that their request was accepted
        const followRecord = await db.query.follows.findFirst({
          where: eq(follows.apId, apId),
        });
        if (followRecord) {
          const followedUser = await db.query.users.findFirst({
            where: eq(users.id, followRecord.followingId),
          });
          if (followedUser) {
            await db.insert(notifications).values({
              userId: followRecord.followerId,
              type: "follow_accepted",
              actorId: followRecord.followingId,
            });
            sendEvent(followRecord.followerId, "notification", {
              type: "follow_accepted",
              actor: { username: followedUser.username },
            });
          }
        }

        log.info(`Follow accepted: ${apId}`);
      } catch (err) {
        log.error("Error handling Accept activity", err);
      }
    })

    // ── Reject ──
    .on(Reject, async (_ctx, reject) => {
      try {
        const followActivity = await reject.getObject();
        if (!(followActivity instanceof Follow)) return;

        const apId = followActivity.id?.href;
        if (!apId) return;

        // Update follow status to rejected
        await db
          .update(follows)
          .set({ status: "rejected", updatedAt: new Date() })
          .where(eq(follows.apId, apId));

        log.info(`Follow rejected: ${apId}`);
      } catch (err) {
        log.error("Error handling Reject activity", err);
      }
    })

    // ── Undo ──
    .on(Undo, async (ctx, undo) => {
      try {
        const actorUri = undo.actorId;
        if (!actorUri) return;

        const object = await undo.getObject();

        if (object instanceof Follow) {
          const followerUser = await db.query.users.findFirst({
            where: eq(users.actorUri, actorUri.href),
          });
          const followingUri = object.objectId;
          if (!followerUser || !followingUri) return;

          const followedUser = await db.query.users.findFirst({
            where: eq(users.actorUri, followingUri.href),
          });
          if (!followedUser) return;

          await db
            .delete(follows)
            .where(
              and(
                eq(follows.followerId, followerUser.id),
                eq(follows.followingId, followedUser.id)
              )
            );

          log.info(`Undo Follow: ${followerUser.username} unfollowed ${followedUser.username}`);
        } else if (object instanceof Like) {
          const likerUser = await db.query.users.findFirst({
            where: eq(users.actorUri, actorUri.href),
          });
          const postUri = object.objectId;
          if (!likerUser || !postUri) return;

          const post = await db.query.posts.findFirst({
            where: eq(posts.apId, postUri.href),
          });
          if (!post) return;

          await db
            .delete(reactions)
            .where(
              and(
                eq(reactions.postId, post.id),
                eq(reactions.userId, likerUser.id)
              )
            );

          log.info(`Undo Like: ${likerUser.username} unliked post ${post.id}`);
        } else if (object instanceof Announce) {
          const sharerUser = await db.query.users.findFirst({
            where: eq(users.actorUri, actorUri.href),
          });
          if (!sharerUser) return;

          const originalUri = object.objectId;
          if (!originalUri) return;

          const originalPost = await db.query.posts.findFirst({
            where: eq(posts.apId, originalUri.href),
          });
          if (!originalPost) return;

          // Delete the reshare post
          const reshare = await db.query.posts.findFirst({
            where: and(
              eq(posts.authorId, sharerUser.id),
              eq(posts.reshareOfId, originalPost.id)
            ),
          });
          if (reshare) {
            await db.delete(posts).where(eq(posts.id, reshare.id));
            log.info(`Undo Announce: ${sharerUser.username} unshared post ${originalPost.id}`);
          }
        } else if (object instanceof Block) {
          const blockerUser = await db.query.users.findFirst({
            where: eq(users.actorUri, actorUri.href),
          });
          if (!blockerUser) return;

          const blockedUri = object.objectId;
          if (!blockedUri) return;

          const blockedUser = await db.query.users.findFirst({
            where: eq(users.actorUri, blockedUri.href),
          });
          if (!blockedUser) return;

          await db
            .delete(blocks)
            .where(
              and(
                eq(blocks.blockerId, blockerUser.id),
                eq(blocks.blockedId, blockedUser.id)
              )
            );

          log.info(`Undo Block: ${blockerUser.username} unblocked ${blockedUser.username}`);
        }
      } catch (err) {
        log.error("Error handling Undo activity", err);
      }
    })

    // ── Create (Note) ──
    .on(Create, async (ctx, create) => {
      try {
        const object = await create.getObject();
        if (!(object instanceof Note)) return;

        const actorUri = create.actorId ?? object.attributionId;
        if (!actorUri) return;

        const remoteUser = await upsertRemoteUser(actorUri.href, ctx);
        if (!remoteUser) return;

        // Check for duplicate
        if (object.id) {
          const existing = await db.query.posts.findFirst({
            where: eq(posts.apId, object.id.href),
          });
          if (existing) return;
        }

        // Check if it's a reply
        const inReplyTo = object.replyTargetId;
        let replyToId: string | null = null;
        let parentPost: typeof posts.$inferSelect | null = null;

        if (inReplyTo) {
          const found = await db.query.posts.findFirst({
            where: eq(posts.apId, inReplyTo.href),
          });
          if (found) {
            replyToId = found.id;
            parentPost = found;
          }
        }

        // Determine visibility from addressing
        let visibility: "public" | "direct" | "followers" | "circles" = "public";
        const toUris = create.toIds?.map((u) => u.href) ?? [];
        const ccUris = create.ccIds?.map((u) => u.href) ?? [];
        const allAddressed = [...toUris, ...ccUris];

        const isPublic = allAddressed.some(
          (u) =>
            u === "https://www.w3.org/ns/activitystreams#Public" ||
            u === "as:Public"
        );

        if (!isPublic) {
          // If followers URI is in `to`, it's followers-only
          if (remoteUser.followersUri && toUris.includes(remoteUser.followersUri)) {
            visibility = "followers";
          } else {
            visibility = "direct"; // Treat as direct/limited
          }
        } else if (
          ccUris.includes("https://www.w3.org/ns/activitystreams#Public") ||
          ccUris.includes("as:Public")
        ) {
          // Public is in cc, not to — treat as unlisted (store as public)
          visibility = "public";
        }

        // Extract hashtags from content
        const content = String(object.content ?? "");
        const hashtagMatches = content.match(/#[\w]+/g) ?? [];
        const hashtags = JSON.stringify(hashtagMatches.map((t) => t.slice(1)));

        // Store the post
        const [newPost] = await db
          .insert(posts)
          .values({
            authorId: remoteUser.id,
            content,
            visibility,
            apId: object.id?.href ?? null,
            replyToId,
            hashtags,
            mentions: "[]",
            sensitive: object.sensitive ?? false,
            spoilerText: object.summary ? String(object.summary) : null,
          })
          .onConflictDoNothing()
          .returning();

        if (!newPost) return;

        // Notify parent post author if it's a reply to a local post
        if (parentPost) {
          const parentAuthor = await db.query.users.findFirst({
            where: and(eq(users.id, parentPost.authorId), eq(users.isLocal, true)),
          });
          if (parentAuthor) {
            await db.insert(notifications).values({
              userId: parentAuthor.id,
              type: "comment",
              actorId: remoteUser.id,
              targetId: parentPost.id,
              targetType: "post",
            });
            sendEvent(parentAuthor.id, "notification", {
              type: "comment",
              postId: parentPost.id,
              actor: { username: remoteUser.username },
            });
          }
        }

        // Check mentions for local users
        const mentionRegex = /@(\w+)@/g;
        let match;
        while ((match = mentionRegex.exec(content)) !== null) {
          const mentionedUser = await getLocalUserByUsername(match[1]);
          if (mentionedUser && mentionedUser.id !== remoteUser.id) {
            await db.insert(notifications).values({
              userId: mentionedUser.id,
              type: "mention",
              actorId: remoteUser.id,
              targetId: newPost.id,
              targetType: "post",
            });
            sendEvent(mentionedUser.id, "notification", {
              type: "mention",
              postId: newPost.id,
              actor: { username: remoteUser.username },
            });
          }
        }

        // Also check Fedify-parsed mention links (href-based)
        const hrefMentionRegex = /href=["']https?:\/\/[^"']*\/users\/([^"']+)["']/g;
        while ((match = hrefMentionRegex.exec(content)) !== null) {
          const mentionedUser = await getLocalUserByUsername(match[1]);
          if (mentionedUser && mentionedUser.id !== remoteUser.id) {
            // Avoid duplicate notifications
            const existingNotif = await db.query.notifications.findFirst({
              where: and(
                eq(notifications.userId, mentionedUser.id),
                eq(notifications.type, "mention"),
                eq(notifications.targetId, newPost.id)
              ),
            });
            if (!existingNotif) {
              await db.insert(notifications).values({
                userId: mentionedUser.id,
                type: "mention",
                actorId: remoteUser.id,
                targetId: newPost.id,
                targetType: "post",
              });
              sendEvent(mentionedUser.id, "notification", {
                type: "mention",
                postId: newPost.id,
                actor: { username: remoteUser.username },
              });
            }
          }
        }

        log.info(`Stored remote post ${newPost.id} from ${remoteUser.username}`);
      } catch (err) {
        log.error("Error handling Create activity", err);
      }
    })

    // ── Update (Note) ──
    .on(Update, async (ctx, update) => {
      try {
        const object = await update.getObject();
        if (!(object instanceof Note)) return;

        const actorUri = update.actorId ?? object.attributionId;
        if (!actorUri) return;

        const remoteUser = await db.query.users.findFirst({
          where: eq(users.actorUri, actorUri.href),
        });
        if (!remoteUser) return;

        const postUri = object.id?.href;
        if (!postUri) return;

        const existingPost = await db.query.posts.findFirst({
          where: and(
            eq(posts.apId, postUri),
            eq(posts.authorId, remoteUser.id)
          ),
        });
        if (!existingPost) return;

        // Build edit history
        const oldHistory = existingPost.editHistory
          ? JSON.parse(existingPost.editHistory as string)
          : [];
        oldHistory.push({
          content: existingPost.content,
          editedAt: existingPost.updatedAt.toISOString(),
        });

        const newContent = String(object.content ?? existingPost.content);
        const hashtagMatches = newContent.match(/#[\w]+/g) ?? [];
        const hashtags = JSON.stringify(hashtagMatches.map((t) => t.slice(1)));

        await db
          .update(posts)
          .set({
            content: newContent,
            hashtags,
            sensitive: object.sensitive ?? existingPost.sensitive,
            spoilerText: object.summary ? String(object.summary) : existingPost.spoilerText,
            editHistory: JSON.stringify(oldHistory),
            updatedAt: new Date(),
          })
          .where(eq(posts.id, existingPost.id));

        log.info(`Updated remote post ${existingPost.id} from ${remoteUser.username}`);
      } catch (err) {
        log.error("Error handling Update activity", err);
      }
    })

    // ── Like ──
    .on(Like, async (ctx, like) => {
      try {
        const actorUri = like.actorId;
        const objectUri = like.objectId;
        if (!actorUri || !objectUri) return;

        const remoteUser = await upsertRemoteUser(actorUri.href, ctx);
        if (!remoteUser) return;

        const post = await db.query.posts.findFirst({
          where: eq(posts.apId, objectUri.href),
        });
        if (!post) return;

        // Check for existing reaction
        const existing = await db.query.reactions.findFirst({
          where: and(
            eq(reactions.postId, post.id),
            eq(reactions.userId, remoteUser.id)
          ),
        });
        if (existing) return;

        await db.insert(reactions).values({
          postId: post.id,
          userId: remoteUser.id,
          type: "+1",
        });

        // Notify post author if local
        const postAuthor = await db.query.users.findFirst({
          where: and(eq(users.id, post.authorId), eq(users.isLocal, true)),
        });
        if (postAuthor) {
          await db.insert(notifications).values({
            userId: postAuthor.id,
            type: "reaction",
            actorId: remoteUser.id,
            targetId: post.id,
            targetType: "post",
          });
          sendEvent(postAuthor.id, "notification", {
            type: "reaction",
            postId: post.id,
            actor: { username: remoteUser.username },
          });
        }

        log.info(`Reaction from ${remoteUser.username} on post ${post.id}`);
      } catch (err) {
        log.error("Error handling Like activity", err);
      }
    })

    // ── Announce (reshare) ──
    .on(Announce, async (ctx, announce) => {
      try {
        const actorUri = announce.actorId;
        const objectUri = announce.objectId;
        if (!actorUri || !objectUri) return;

        const remoteUser = await upsertRemoteUser(actorUri.href, ctx);
        if (!remoteUser) return;

        let originalPost = await db.query.posts.findFirst({
          where: eq(posts.apId, objectUri.href),
        });

        // If we don't have the original post, fetch it from the remote server
        if (!originalPost) {
          try {
            const remoteObject = await ctx.lookupObject(objectUri);
            if (remoteObject instanceof Note) {
              const noteActorUri = remoteObject.attributionId;
              if (noteActorUri) {
                const noteAuthor = await upsertRemoteUser(noteActorUri.href, ctx);
                if (noteAuthor) {
                  const content = String(remoteObject.content ?? "");
                  const hashtagMatches = content.match(/#[\w]+/g) ?? [];
                  const hashtags = JSON.stringify(hashtagMatches.map((t) => t.slice(1)));
                  const [fetched] = await db
                    .insert(posts)
                    .values({
                      authorId: noteAuthor.id,
                      content,
                      visibility: "public",
                      apId: remoteObject.id?.href ?? null,
                      hashtags,
                      mentions: "[]",
                      sensitive: remoteObject.sensitive ?? false,
                      spoilerText: remoteObject.summary ? String(remoteObject.summary) : null,
                    })
                    .onConflictDoNothing()
                    .returning();
                  originalPost = fetched ?? null;
                }
              }
            }
          } catch (err) {
            log.warn(`Failed to fetch announced post ${objectUri.href}`, err);
          }
        }

        if (!originalPost) return;

        // Prevent duplicate
        const existing = await db.query.posts.findFirst({
          where: and(
            eq(posts.authorId, remoteUser.id),
            eq(posts.reshareOfId, originalPost.id)
          ),
        });
        if (existing) return;

        const [reshare] = await db
          .insert(posts)
          .values({
            authorId: remoteUser.id,
            content: "",
            visibility: "public",
            reshareOfId: originalPost.id,
            apId: announce.id?.href ?? null,
            hashtags: "[]",
            mentions: "[]",
          })
          .returning();

        // Notify original author if local
        const originalAuthor = await db.query.users.findFirst({
          where: and(
            eq(users.id, originalPost.authorId),
            eq(users.isLocal, true)
          ),
        });
        if (originalAuthor) {
          await db.insert(notifications).values({
            userId: originalAuthor.id,
            type: "reshare",
            actorId: remoteUser.id,
            targetId: originalPost.id,
            targetType: "post",
          });
          sendEvent(originalAuthor.id, "notification", {
            type: "reshare",
            postId: originalPost.id,
            actor: { username: remoteUser.username },
          });
        }

        log.info(`Reshare by ${remoteUser.username} of post ${originalPost.id}`);
      } catch (err) {
        log.error("Error handling Announce activity", err);
      }
    })

    // ── Delete ──
    .on(Delete, async (_ctx, del) => {
      try {
        const actorUri = del.actorId;
        const objectUri = del.objectId;
        if (!actorUri || !objectUri) return;

        const actor = await db.query.users.findFirst({
          where: eq(users.actorUri, actorUri.href),
        });
        if (!actor) return;

        // Try to delete a post
        const post = await db.query.posts.findFirst({
          where: and(
            eq(posts.apId, objectUri.href),
            eq(posts.authorId, actor.id)
          ),
        });
        if (post) {
          await db.delete(posts).where(eq(posts.id, post.id));
          log.info(`Deleted remote post ${post.id} by ${actor.username}`);
        }
      } catch (err) {
        log.error("Error handling Delete activity", err);
      }
    })

    // ── Block ──
    .on(Block, async (ctx, block) => {
      try {
        const actorUri = block.actorId;
        const objectUri = block.objectId;
        if (!actorUri || !objectUri) return;

        const blocker = await upsertRemoteUser(actorUri.href, ctx);
        if (!blocker) return;

        const blocked = await db.query.users.findFirst({
          where: eq(users.actorUri, objectUri.href),
        });
        if (!blocked) return;

        // Insert block
        const existingBlock = await db.query.blocks.findFirst({
          where: and(
            eq(blocks.blockerId, blocker.id),
            eq(blocks.blockedId, blocked.id)
          ),
        });
        if (!existingBlock) {
          await db.insert(blocks).values({
            blockerId: blocker.id,
            blockedId: blocked.id,
          });
        }

        // Clean up follow relationships
        await db
          .delete(follows)
          .where(
            and(
              eq(follows.followerId, blocker.id),
              eq(follows.followingId, blocked.id)
            )
          );
        await db
          .delete(follows)
          .where(
            and(
              eq(follows.followerId, blocked.id),
              eq(follows.followingId, blocker.id)
            )
          );

        log.info(`Block: ${blocker.username} blocked ${blocked.username}`);
      } catch (err) {
        log.error("Error handling Block activity", err);
      }
    });

  // Register federation instance for outbox module
  setFederation(federation);

  return federation;
}

// ── Utility functions ──

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const lines = pem
    .replace(/-----BEGIN [\w\s]+-----/, "")
    .replace(/-----END [\w\s]+-----/, "")
    .replace(/\s/g, "");
  const binary = atob(lines);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

