import {
  Create,
  Update,
  Delete as APDelete,
  Like,
  Undo,
  Announce,
  Follow,
  Block,
  Note,
  type Federation,
  type Recipient,
} from "@fedify/fedify";
import { Temporal } from "@js-temporal/polyfill";
import { eq, and } from "drizzle-orm";
import { db } from "../db/connection.js";
import { users } from "../db/schema/users.js";
import { follows } from "../db/schema/follows.js";
import { posts } from "../db/schema/posts.js";
import { config } from "../config.js";

let _federation: Federation<void> | null = null;

export function setFederation(fed: Federation<void>) {
  _federation = fed;
}

function getFederation(): Federation<void> {
  if (!_federation) throw new Error("Federation not initialized");
  return _federation;
}

async function getLocalUser(userId: string) {
  return db.query.users.findFirst({
    where: and(eq(users.id, userId), eq(users.isLocal, true)),
  });
}

// ── Send Create { Note } to followers ──

export async function sendCreateNote(
  authorId: string,
  post: { id: string; content: string; apId: string | null; createdAt: Date }
) {
  const author = await getLocalUser(authorId);
  if (!author) return;

  const federation = getFederation();
  const ctx = federation.createContext(new URL(config.publicUrl), undefined as void);

  const note = new Note({
    id: post.apId ? new URL(post.apId) : undefined,
    content: post.content,
    attribution: new URL(author.actorUri),
    published: Temporal.Instant.fromEpochMilliseconds(post.createdAt.getTime()),
    url: post.apId ? new URL(post.apId) : undefined,
  });

  const activity = new Create({
    id: new URL(`${config.publicUrl}/activities/create/${post.id}`),
    actor: new URL(author.actorUri),
    object: note,
  });

  await ctx.sendActivity(
    { identifier: author.username },
    "followers",
    activity
  );
}

// ── Send Update { Note } ──

export async function sendUpdateNote(
  authorId: string,
  post: { id: string; content: string; apId: string | null; updatedAt: Date }
) {
  const author = await getLocalUser(authorId);
  if (!author) return;

  const federation = getFederation();
  const ctx = federation.createContext(new URL(config.publicUrl), undefined as void);

  const note = new Note({
    id: post.apId ? new URL(post.apId) : undefined,
    content: post.content,
    attribution: new URL(author.actorUri),
    updated: Temporal.Instant.fromEpochMilliseconds(post.updatedAt.getTime()),
  });

  const activity = new Update({
    id: new URL(`${config.publicUrl}/activities/update/${post.id}/${Date.now()}`),
    actor: new URL(author.actorUri),
    object: note,
  });

  await ctx.sendActivity(
    { identifier: author.username },
    "followers",
    activity
  );
}

// ── Send Delete ──

export async function sendDeleteNote(
  authorId: string,
  postApId: string
) {
  const author = await getLocalUser(authorId);
  if (!author) return;

  const federation = getFederation();
  const ctx = federation.createContext(new URL(config.publicUrl), undefined as void);

  const activity = new APDelete({
    actor: new URL(author.actorUri),
    object: new URL(postApId),
  });

  await ctx.sendActivity(
    { identifier: author.username },
    "followers",
    activity
  );
}

// ── Send Like ──

export async function sendLike(userId: string, postId: string) {
  const user = await getLocalUser(userId);
  if (!user) return;

  const post = await db.query.posts.findFirst({
    where: eq(posts.id, postId),
  });
  if (!post?.apId) return;

  const postAuthor = await db.query.users.findFirst({
    where: eq(users.id, post.authorId),
  });
  if (!postAuthor) return;

  const federation = getFederation();
  const ctx = federation.createContext(new URL(config.publicUrl), undefined as void);

  const activity = new Like({
    id: new URL(`${config.publicUrl}/activities/like/${userId}/${postId}`),
    actor: new URL(user.actorUri),
    object: new URL(post.apId),
  });

  await ctx.sendActivity(
    { identifier: user.username },
    "followers",
    activity
  );
}

// ── Send Undo { Like } ──

export async function sendUndoLike(userId: string, postId: string) {
  const user = await getLocalUser(userId);
  if (!user) return;

  const post = await db.query.posts.findFirst({
    where: eq(posts.id, postId),
  });
  if (!post?.apId) return;

  const federation = getFederation();
  const ctx = federation.createContext(new URL(config.publicUrl), undefined as void);

  const activity = new Undo({
    actor: new URL(user.actorUri),
    object: new Like({
      id: new URL(`${config.publicUrl}/activities/like/${userId}/${postId}`),
      actor: new URL(user.actorUri),
      object: new URL(post.apId),
    }),
  });

  await ctx.sendActivity(
    { identifier: user.username },
    "followers",
    activity
  );
}

// ── Send Announce (reshare) ──

export async function sendAnnounce(
  userId: string,
  originalPostId: string,
  reshareId: string
) {
  const user = await getLocalUser(userId);
  if (!user) return;

  const original = await db.query.posts.findFirst({
    where: eq(posts.id, originalPostId),
  });
  if (!original?.apId) return;

  const federation = getFederation();
  const ctx = federation.createContext(new URL(config.publicUrl), undefined as void);

  const activity = new Announce({
    id: new URL(`${config.publicUrl}/activities/announce/${reshareId}`),
    actor: new URL(user.actorUri),
    object: new URL(original.apId),
  });

  await ctx.sendActivity(
    { identifier: user.username },
    "followers",
    activity
  );
}

// ── Send Follow ──

export async function sendFollow(
  followerId: string,
  followingId: string,
  followRecordId: string
) {
  const follower = await getLocalUser(followerId);
  if (!follower) return;

  const following = await db.query.users.findFirst({
    where: eq(users.id, followingId),
  });
  if (!following) return;

  // Only send AP Follow for remote users
  if (following.isLocal) return;

  const federation = getFederation();
  const ctx = federation.createContext(new URL(config.publicUrl), undefined as void);

  const activity = new Follow({
    id: new URL(`${config.publicUrl}/activities/follow/${followRecordId}`),
    actor: new URL(follower.actorUri),
    object: new URL(following.actorUri),
  });

  // Update the follow record with the AP ID
  await db
    .update(follows)
    .set({ apId: activity.id?.href ?? null })
    .where(eq(follows.id, followRecordId));

  await ctx.sendActivity(
    { identifier: follower.username },
    "followers",
    activity
  );
}

// ── Send Undo { Follow } ──

export async function sendUndoFollow(
  followerId: string,
  followingId: string
) {
  const follower = await getLocalUser(followerId);
  if (!follower) return;

  const following = await db.query.users.findFirst({
    where: eq(users.id, followingId),
  });
  if (!following || following.isLocal) return;

  const federation = getFederation();
  const ctx = federation.createContext(new URL(config.publicUrl), undefined as void);

  const activity = new Undo({
    actor: new URL(follower.actorUri),
    object: new Follow({
      actor: new URL(follower.actorUri),
      object: new URL(following.actorUri),
    }),
  });

  await ctx.sendActivity(
    { identifier: follower.username },
    "followers",
    activity
  );
}

// ── Send Create Event (as Note) ──

export async function sendCreateEvent(
  userId: string,
  event: {
    id: string;
    name: string;
    description: string;
    apId: string | null;
    startDate: Date;
    location: string | null;
  }
) {
  const author = await getLocalUser(userId);
  if (!author) return;

  const federation = getFederation();
  const ctx = federation.createContext(new URL(config.publicUrl), undefined as void);

  // Represent event as a Note with structured content
  const content = [
    `<h2>${event.name}</h2>`,
    event.description ? `<p>${event.description}</p>` : "",
    `<p>Start: ${event.startDate.toISOString()}</p>`,
    event.location ? `<p>Location: ${event.location}</p>` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const note = new Note({
    id: event.apId ? new URL(event.apId) : undefined,
    content,
    attribution: new URL(author.actorUri),
    published: Temporal.Instant.fromEpochMilliseconds(Date.now()),
    url: event.apId ? new URL(event.apId) : undefined,
  });

  const activity = new Create({
    id: new URL(`${config.publicUrl}/activities/create-event/${event.id}`),
    actor: new URL(author.actorUri),
    object: note,
  });

  await ctx.sendActivity(
    { identifier: author.username },
    "followers",
    activity
  );
}

// ── Send Update Event ──

export async function sendUpdateEvent(
  userId: string,
  event: {
    id: string;
    name: string;
    description: string;
    apId: string | null;
    startDate: Date;
    location: string | null;
  }
) {
  const author = await getLocalUser(userId);
  if (!author) return;

  const federation = getFederation();
  const ctx = federation.createContext(new URL(config.publicUrl), undefined as void);

  const content = [
    `<h2>${event.name}</h2>`,
    event.description ? `<p>${event.description}</p>` : "",
    `<p>Start: ${event.startDate.toISOString()}</p>`,
    event.location ? `<p>Location: ${event.location}</p>` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const note = new Note({
    id: event.apId ? new URL(event.apId) : undefined,
    content,
    attribution: new URL(author.actorUri),
    updated: Temporal.Instant.fromEpochMilliseconds(Date.now()),
  });

  const activity = new Update({
    id: new URL(`${config.publicUrl}/activities/update-event/${event.id}/${Date.now()}`),
    actor: new URL(author.actorUri),
    object: note,
  });

  await ctx.sendActivity(
    { identifier: author.username },
    "followers",
    activity
  );
}

// ── Send Delete Event ──

export async function sendDeleteEvent(userId: string, eventApId: string) {
  const author = await getLocalUser(userId);
  if (!author) return;

  const federation = getFederation();
  const ctx = federation.createContext(new URL(config.publicUrl), undefined as void);

  const activity = new APDelete({
    actor: new URL(author.actorUri),
    object: new URL(eventApId),
  });

  await ctx.sendActivity(
    { identifier: author.username },
    "followers",
    activity
  );
}

// ── Send Direct Message (encrypted) ──

export async function sendDirectMessage(
  userId: string,
  recipientIds: string[],
  encryptedPayload: {
    ciphertext: string;
    ephemeralPublicKey: string;
    iv: string;
  }
) {
  const sender = await getLocalUser(userId);
  if (!sender) return;

  // Resolve recipients to their actor URIs and inbox URIs
  const recipients = await Promise.all(
    recipientIds.map((id) =>
      db.query.users.findFirst({ where: eq(users.id, id) })
    )
  );

  const remoteRecipients: Recipient[] = recipients
    .filter((r): r is NonNullable<typeof r> => r != null && !r.isLocal)
    .map((r) => ({
      id: new URL(r.actorUri),
      inboxId: new URL(r.inboxUri),
    }));

  if (remoteRecipients.length === 0) return;

  const federation = getFederation();
  const ctx = federation.createContext(new URL(config.publicUrl), undefined as void);

  // Wrap encrypted payload in a Note for federation
  const content = JSON.stringify(encryptedPayload);

  const note = new Note({
    content,
    attribution: new URL(sender.actorUri),
    tos: remoteRecipients.map((r) => r.id!),
    published: Temporal.Instant.fromEpochMilliseconds(Date.now()),
  });

  const activity = new Create({
    id: new URL(`${config.publicUrl}/activities/dm/${crypto.randomUUID()}`),
    actor: new URL(sender.actorUri),
    object: note,
    tos: remoteRecipients.map((r) => r.id!),
  });

  await ctx.sendActivity(
    { identifier: sender.username },
    remoteRecipients,
    activity
  );
}

// ── Send Block ──

export async function sendBlock(blockerId: string, blockedId: string) {
  const blocker = await getLocalUser(blockerId);
  if (!blocker) return;

  const blocked = await db.query.users.findFirst({
    where: eq(users.id, blockedId),
  });
  if (!blocked || blocked.isLocal) return;

  const federation = getFederation();
  const ctx = federation.createContext(new URL(config.publicUrl), undefined as void);

  const activity = new Block({
    actor: new URL(blocker.actorUri),
    object: new URL(blocked.actorUri),
  });

  await ctx.sendActivity(
    { identifier: blocker.username },
    "followers",
    activity
  );
}
