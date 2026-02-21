import type {
  Router,
  WebRtcTransport,
  PlainTransport,
  Producer,
  Consumer,
  RtpCodecCapability,
} from "mediasoup/types";
import { getNextWorker } from "./workers.js";

export interface Participant {
  userId: string;
  sendTransport?: WebRtcTransport;
  recvTransport?: WebRtcTransport;
  producers: Map<string, Producer>;
  consumers: Map<string, Consumer>;
}

export interface Room {
  router: Router;
  participants: Map<string, Participant>;
  plainTransport?: PlainTransport;
}

const rooms = new Map<string, Room>();

// preferredPayloadType is assigned by the Router; we omit it here
const mediaCodecs = [
  {
    kind: "audio" as const,
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: "video" as const,
    mimeType: "video/VP8",
    clockRate: 90000,
    parameters: {},
  },
  {
    kind: "video" as const,
    mimeType: "video/VP9",
    clockRate: 90000,
    parameters: {
      "profile-id": 2,
    },
  },
  {
    kind: "video" as const,
    mimeType: "video/H264",
    clockRate: 90000,
    parameters: {
      "packetization-mode": 1,
      "profile-level-id": "42e01f",
      "level-asymmetry-allowed": 1,
    },
  },
] satisfies Array<Omit<RtpCodecCapability, "preferredPayloadType">>;

export async function createRoom(hangoutId: string): Promise<Room> {
  const existing = rooms.get(hangoutId);
  if (existing) return existing;

  const worker = getNextWorker();
  const router = await worker.createRouter({
    mediaCodecs: mediaCodecs as RtpCodecCapability[],
  });

  const room: Room = {
    router,
    participants: new Map(),
  };

  rooms.set(hangoutId, room);
  return room;
}

export function getRoom(hangoutId: string): Room | undefined {
  return rooms.get(hangoutId);
}

export function closeRoom(hangoutId: string): void {
  const room = rooms.get(hangoutId);
  if (!room) return;

  // Close all transports and the router
  for (const participant of room.participants.values()) {
    participant.sendTransport?.close();
    participant.recvTransport?.close();
  }

  room.plainTransport?.close();
  room.router.close();
  rooms.delete(hangoutId);
}

export function getOrCreateParticipant(
  room: Room,
  userId: string
): Participant {
  let participant = room.participants.get(userId);
  if (!participant) {
    participant = {
      userId,
      producers: new Map(),
      consumers: new Map(),
    };
    room.participants.set(userId, participant);
  }
  return participant;
}

export function removeParticipant(room: Room, userId: string): void {
  const participant = room.participants.get(userId);
  if (!participant) return;

  for (const producer of participant.producers.values()) {
    producer.close();
  }
  for (const consumer of participant.consumers.values()) {
    consumer.close();
  }
  participant.sendTransport?.close();
  participant.recvTransport?.close();
  room.participants.delete(userId);
}
