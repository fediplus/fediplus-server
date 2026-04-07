import { randomUUID } from "node:crypto";

export function makeUser(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const username = `user_${id.slice(0, 8)}`;
  return {
    id,
    username,
    email: `${username}@example.com`,
    passwordHash: "$2b$12$hashedpasswordplaceholder",
    emailVerified: true,
    isLocal: true,
    domain: null,
    actorType: "Person" as const,
    actorUri: `https://fediplus.test/users/${username}`,
    inboxUri: `https://fediplus.test/users/${username}/inbox`,
    outboxUri: `https://fediplus.test/users/${username}/outbox`,
    followersUri: `https://fediplus.test/users/${username}/followers`,
    followingUri: `https://fediplus.test/users/${username}/following`,
    publicKey: "-----BEGIN PUBLIC KEY-----\nMIIBIj...\n-----END PUBLIC KEY-----",
    privateKey: "-----BEGIN PRIVATE KEY-----\nMIIEv...\n-----END PRIVATE KEY-----",
    encryptionPublicKey: null,
    encryptionPrivateKeyEnc: null,
    role: "user",
    status: "active",
    silenced: false,
    sensitized: false,
    permissions: {
      can_post: true,
      can_comment: true,
      can_follow: true,
      can_react: true,
      can_upload: true,
      can_message: true,
      can_report: true,
      can_create_communities: true,
    },
    adminNote: null,
    suspendedAt: null,
    suspensionReason: null,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    ...overrides,
  };
}

export function makePost(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  return {
    id,
    authorId: randomUUID(),
    content: "Hello, fediverse! #test",
    visibility: "public" as const,
    apId: `https://fediplus.test/posts/${id}`,
    replyToId: null,
    reshareOfId: null,
    hashtags: '["test"]',
    mentions: "[]",
    sensitive: false,
    spoilerText: null,
    editHistory: "[]",
    createdAt: new Date("2025-01-15"),
    updatedAt: new Date("2025-01-15"),
    ...overrides,
  };
}

export function makeCircle(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  return {
    id,
    userId: randomUUID(),
    name: "Friends",
    color: "#4285f4",
    isDefault: false,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    ...overrides,
  };
}

export function makeFollow(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  return {
    id,
    followerId: randomUUID(),
    followingId: randomUUID(),
    status: "accepted" as const,
    apId: null,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    ...overrides,
  };
}

export function makeProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    userId: randomUUID(),
    displayName: "Test User",
    bio: null,
    avatarUrl: null,
    coverUrl: null,
    fields: null,
    location: null,
    website: null,
    ...overrides,
  };
}

export function makeReaction(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    postId: randomUUID(),
    userId: randomUUID(),
    type: "+1" as const,
    createdAt: new Date("2025-01-15"),
    ...overrides,
  };
}
