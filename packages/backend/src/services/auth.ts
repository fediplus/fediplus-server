import bcrypt from "bcrypt";
import { eq, and } from "drizzle-orm";
import { generateKeyPairSync, randomBytes, createHash } from "node:crypto";
import { db } from "../db/connection.js";
import { users, profiles, emailTokens } from "../db/schema/index.js";
import { circles } from "../db/schema/circles.js";
import { media } from "../db/schema/media.js";
import { config } from "../config.js";
import {
  DEFAULT_CIRCLES_PERSON,
  DEFAULT_CIRCLES_BUSINESS,
  type RegisterInput,
  type LoginInput,
} from "@fediplus/shared";
import { generateToken, type AuthPayload } from "../middleware/auth.js";
import { deleteFile, extractKey } from "./media.js";
import { sendVerificationEmail, sendPasswordResetEmail } from "./email.js";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function registerUser(input: RegisterInput) {
  const existing = await db.query.users.findFirst({
    where: eq(users.username, input.username),
  });
  if (existing) {
    throw Object.assign(new Error("Username already taken"), {
      statusCode: 409,
    });
  }

  const existingEmail = await db.query.users.findFirst({
    where: eq(users.email, input.email),
  });
  if (existingEmail) {
    throw Object.assign(new Error("Email already registered"), {
      statusCode: 409,
    });
  }

  const passwordHash = await bcrypt.hash(input.password, 12);

  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  const actorType = input.actorType ?? "Person";
  const baseUri = `${config.publicUrl}/users/${input.username}`;

  const [user] = await db
    .insert(users)
    .values({
      username: input.username,
      email: input.email,
      passwordHash,
      actorType,
      actorUri: baseUri,
      inboxUri: `${baseUri}/inbox`,
      outboxUri: `${baseUri}/outbox`,
      followersUri: `${baseUri}/followers`,
      followingUri: `${baseUri}/following`,
      publicKey,
      privateKey,
    })
    .returning();

  await db.insert(profiles).values({
    userId: user.id,
    displayName: input.displayName ?? input.username,
  });

  const defaultCircles =
    actorType === "Service" ? DEFAULT_CIRCLES_BUSINESS : DEFAULT_CIRCLES_PERSON;

  await db.insert(circles).values(
    defaultCircles.map((c) => ({
      userId: user.id,
      name: c.name,
      color: c.color,
      isDefault: true,
    }))
  );

  // Generate email verification token
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);

  await db.insert(emailTokens).values({
    userId: user.id,
    tokenHash,
    type: "verification",
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
  });

  await sendVerificationEmail(input.email, rawToken);

  return {
    message: "Check your email to verify your account",
  };
}

export async function deleteAccount(userId: string, password: string) {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user || !user.passwordHash) {
    throw Object.assign(new Error("Account not found"), { statusCode: 404 });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw Object.assign(new Error("Incorrect password"), { statusCode: 401 });
  }

  // Delete media files from storage before DB cascade removes the records
  const mediaRecords = await db
    .select()
    .from(media)
    .where(eq(media.userId, userId));

  for (const record of mediaRecords) {
    await deleteFile(extractKey(record.url));
    if (record.thumbnailUrl) {
      await deleteFile(extractKey(record.thumbnailUrl));
    }
  }

  // Delete user — CASCADE handles all related DB records
  await db.delete(users).where(eq(users.id, userId));
}

export async function loginUser(input: LoginInput) {
  const user = await db.query.users.findFirst({
    where: eq(users.email, input.email),
  });

  if (!user) {
    throw Object.assign(new Error("Invalid email or password"), {
      statusCode: 401,
    });
  }

  const valid = user.passwordHash ? await bcrypt.compare(input.password, user.passwordHash) : false;
  if (!valid) {
    throw Object.assign(new Error("Invalid email or password"), {
      statusCode: 401,
    });
  }

  if (!user.emailVerified) {
    throw Object.assign(new Error("Please verify your email before logging in"), {
      statusCode: 403,
    });
  }

  const token = generateToken({
    userId: user.id,
    username: user.username,
  });

  return {
    user: {
      id: user.id,
      username: user.username,
      actorType: user.actorType,
      actorUri: user.actorUri,
    },
    token,
  };
}

export async function verifyEmail(token: string) {
  const tokenHash = hashToken(token);

  const record = await db.query.emailTokens.findFirst({
    where: and(
      eq(emailTokens.tokenHash, tokenHash),
      eq(emailTokens.type, "verification"),
    ),
  });

  if (!record || record.expiresAt < new Date()) {
    throw Object.assign(new Error("Invalid or expired verification link"), {
      statusCode: 400,
    });
  }

  await db
    .update(users)
    .set({ emailVerified: true })
    .where(eq(users.id, record.userId));

  await db.delete(emailTokens).where(eq(emailTokens.id, record.id));

  return { message: "Email verified successfully" };
}

export async function requestPasswordReset(email: string) {
  const user = await db.query.users.findFirst({
    where: eq(users.email, email),
  });

  // Always return success to avoid leaking whether an email exists
  if (!user) return { message: "If an account exists with that email, a reset link has been sent" };

  // Delete any existing reset tokens for this user
  await db
    .delete(emailTokens)
    .where(and(eq(emailTokens.userId, user.id), eq(emailTokens.type, "reset")));

  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);

  await db.insert(emailTokens).values({
    userId: user.id,
    tokenHash,
    type: "reset",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
  });

  await sendPasswordResetEmail(email, rawToken);

  return { message: "If an account exists with that email, a reset link has been sent" };
}

export async function resetPassword(token: string, newPassword: string) {
  const tokenHash = hashToken(token);

  const record = await db.query.emailTokens.findFirst({
    where: and(
      eq(emailTokens.tokenHash, tokenHash),
      eq(emailTokens.type, "reset"),
    ),
  });

  if (!record || record.expiresAt < new Date()) {
    throw Object.assign(new Error("Invalid or expired reset link"), {
      statusCode: 400,
    });
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);

  await db
    .update(users)
    .set({ passwordHash })
    .where(eq(users.id, record.userId));

  await db.delete(emailTokens).where(eq(emailTokens.id, record.id));

  return { message: "Password reset successfully" };
}

export async function resendVerification(email: string) {
  const user = await db.query.users.findFirst({
    where: eq(users.email, email),
  });

  // Don't leak whether account exists
  if (!user || user.emailVerified) {
    return { message: "If an unverified account exists with that email, a new link has been sent" };
  }

  // Delete existing verification tokens
  await db
    .delete(emailTokens)
    .where(and(eq(emailTokens.userId, user.id), eq(emailTokens.type, "verification")));

  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);

  await db.insert(emailTokens).values({
    userId: user.id,
    tokenHash,
    type: "verification",
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
  });

  await sendVerificationEmail(email, rawToken);

  return { message: "If an unverified account exists with that email, a new link has been sent" };
}
