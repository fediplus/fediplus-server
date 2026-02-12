import {
  createFederation,
  Person,
  Group,
  Service,
  Follow,
  Accept,
  Reject,
  Create,
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
import { eq } from "drizzle-orm";
import { db } from "../db/connection.js";
import { users, profiles } from "../db/schema/users.js";
import { config } from "../config.js";

export function setupFederation() {
  const federation = createFederation({
    kv: new MemoryKvStore(),
    queue: new InProcessMessageQueue(),
  });

  // Actor dispatcher
  federation
    .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
      const user = await db.query.users.findFirst({
        where: eq(users.username, identifier),
      });
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
      const user = await db.query.users.findFirst({
        where: eq(users.username, identifier),
      });
      if (!user) return [];

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

  // Inbox listeners
  federation
    .setInboxListeners("/users/{identifier}/inbox", "/inbox")
    .on(Follow, async (ctx, follow) => {
      const follower = follow.actorId;
      const following = follow.objectId;
      if (!follower || !following) return;

      // Auto-accept follows for now
      const acceptActivity = new Accept({
        actor: following,
        object: follow,
      });

      await ctx.sendActivity(
        { identifier: following.pathname.split("/").pop()! },
        "followers",
        acceptActivity
      );
    })
    .on(Accept, async (_ctx, accept) => {
      // Handle accepted follow
      const followActivity = await accept.getObject();
      if (followActivity instanceof Follow) {
        // Update follow status to accepted
        console.log("Follow accepted:", followActivity.id?.href);
      }
    })
    .on(Undo, async (_ctx, undo) => {
      const object = await undo.getObject();
      if (object instanceof Follow) {
        console.log("Follow undone:", object.id?.href);
      } else if (object instanceof Like) {
        console.log("Like undone:", object.id?.href);
      }
    })
    .on(Create, async (_ctx, create) => {
      const object = await create.getObject();
      if (object instanceof Note) {
        console.log("Received note:", object.id?.href);
      }
    })
    .on(Like, async (_ctx, like) => {
      console.log("Received like:", like.objectId?.href);
    })
    .on(Announce, async (_ctx, announce) => {
      console.log("Received announce:", announce.objectId?.href);
    })
    .on(Delete, async (_ctx, del) => {
      console.log("Received delete:", del.objectId?.href);
    })
    .on(Block, async (_ctx, block) => {
      console.log("Received block from:", block.actorId?.href);
    });

  return federation;
}

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
