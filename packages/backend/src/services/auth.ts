import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import { generateKeyPairSync } from "node:crypto";
import { db } from "../db/connection.js";
import { users, profiles } from "../db/schema/index.js";
import { circles } from "../db/schema/circles.js";
import { config } from "../config.js";
import {
  DEFAULT_CIRCLES_PERSON,
  DEFAULT_CIRCLES_BUSINESS,
  type RegisterInput,
  type LoginInput,
} from "@fediplus/shared";
import { generateToken, type AuthPayload } from "../middleware/auth.js";

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

export async function loginUser(input: LoginInput) {
  const user = await db.query.users.findFirst({
    where: eq(users.email, input.email),
  });

  if (!user) {
    throw Object.assign(new Error("Invalid email or password"), {
      statusCode: 401,
    });
  }

  const valid = await bcrypt.compare(input.password, user.passwordHash);
  if (!valid) {
    throw Object.assign(new Error("Invalid email or password"), {
      statusCode: 401,
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
