import type { Job } from "bullmq";
import {
  sendCreateNote,
  sendUpdateNote,
  sendDeleteNote,
  sendLike,
  sendUndoLike,
  sendAnnounce,
  sendFollow,
  sendUndoFollow,
  sendCreateEvent,
  sendUpdateEvent,
  sendDeleteEvent,
  sendDirectMessage,
  sendCreateHangout,
  sendEndHangout,
  sendBlock,
} from "../../federation/outbox.js";

export type FederationJobData =
  | {
      type: "createNote";
      authorId: string;
      post: {
        id: string;
        content: string;
        apId: string | null;
        createdAt: string;
      };
    }
  | {
      type: "updateNote";
      authorId: string;
      post: {
        id: string;
        content: string;
        apId: string | null;
        updatedAt: string;
      };
    }
  | { type: "deleteNote"; authorId: string; postApId: string }
  | { type: "like"; userId: string; postId: string }
  | { type: "undoLike"; userId: string; postId: string }
  | {
      type: "announce";
      userId: string;
      originalPostId: string;
      reshareId: string;
    }
  | {
      type: "follow";
      followerId: string;
      followingId: string;
      followRecordId: string;
    }
  | { type: "undoFollow"; followerId: string; followingId: string }
  | {
      type: "createEvent";
      userId: string;
      event: {
        id: string;
        name: string;
        description: string;
        apId: string | null;
        startDate: string;
        location: string | null;
      };
    }
  | {
      type: "updateEvent";
      userId: string;
      event: {
        id: string;
        name: string;
        description: string;
        apId: string | null;
        startDate: string;
        location: string | null;
      };
    }
  | { type: "deleteEvent"; userId: string; eventApId: string }
  | {
      type: "directMessage";
      userId: string;
      recipientIds: string[];
      encryptedPayload: {
        ciphertext: string;
        ephemeralPublicKey: string;
        iv: string;
      };
    }
  | {
      type: "createHangout";
      userId: string;
      hangout: { id: string; name: string | null; apId: string | null };
    }
  | { type: "endHangout"; userId: string; hangoutApId: string }
  | { type: "block"; blockerId: string; blockedId: string };

export async function processFederationJob(
  job: Job<FederationJobData>
): Promise<void> {
  const data = job.data;

  switch (data.type) {
    case "createNote":
      return sendCreateNote(data.authorId, {
        ...data.post,
        createdAt: new Date(data.post.createdAt),
      });
    case "updateNote":
      return sendUpdateNote(data.authorId, {
        ...data.post,
        updatedAt: new Date(data.post.updatedAt),
      });
    case "deleteNote":
      return sendDeleteNote(data.authorId, data.postApId);
    case "like":
      return sendLike(data.userId, data.postId);
    case "undoLike":
      return sendUndoLike(data.userId, data.postId);
    case "announce":
      return sendAnnounce(data.userId, data.originalPostId, data.reshareId);
    case "follow":
      return sendFollow(data.followerId, data.followingId, data.followRecordId);
    case "undoFollow":
      return sendUndoFollow(data.followerId, data.followingId);
    case "createEvent":
      return sendCreateEvent(data.userId, {
        ...data.event,
        startDate: new Date(data.event.startDate),
      });
    case "updateEvent":
      return sendUpdateEvent(data.userId, {
        ...data.event,
        startDate: new Date(data.event.startDate),
      });
    case "deleteEvent":
      return sendDeleteEvent(data.userId, data.eventApId);
    case "directMessage":
      return sendDirectMessage(
        data.userId,
        data.recipientIds,
        data.encryptedPayload
      );
    case "createHangout":
      return sendCreateHangout(data.userId, data.hangout);
    case "endHangout":
      return sendEndHangout(data.userId, data.hangoutApId);
    case "block":
      return sendBlock(data.blockerId, data.blockedId);
    default:
      console.warn(`[federation-worker] Unknown job type: ${(data as { type: string }).type}`);
  }
}
