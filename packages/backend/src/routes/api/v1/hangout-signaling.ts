import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import jwt from "jsonwebtoken";
import { config } from "../../../config.js";
import type { AuthPayload } from "../../../middleware/auth.js";
import {
  createRoom,
  getRoom,
  getOrCreateParticipant,
  removeParticipant,
  type Room,
  type Participant,
} from "../../../mediasoup/rooms.js";
import { eq } from "drizzle-orm";
import { db } from "../../../db/connection.js";
import { hangouts } from "../../../db/schema/hangouts.js";
import {
  createWebRtcTransport,
  connectTransport,
} from "../../../mediasoup/transports.js";
import { broadcastToUsers } from "../../../realtime/sse.js";
import { hangoutChatMessageSchema } from "@fediplus/shared";
import type {
  DtlsParameters,
  RtpParameters,
  RtpCapabilities,
  MediaKind,
} from "mediasoup/types";

interface SignalingMessage {
  type: string;
  data?: Record<string, unknown>;
  id?: string;
}

export async function hangoutSignalingRoutes(app: FastifyInstance) {
  app.get(
    "/api/v1/hangouts/:id/ws",
    { websocket: true },
    (socket, request) => {
      const { id: hangoutId } = request.params as { id: string };
      const url = new URL(request.url, `http://${request.headers.host}`);
      const token = url.searchParams.get("token");

      if (!token) {
        socket.send(JSON.stringify({ type: "error", data: { message: "Missing token" } }));
        socket.close();
        return;
      }

      let user: AuthPayload;
      try {
        user = jwt.verify(token, config.jwt.secret) as AuthPayload;
      } catch {
        socket.send(JSON.stringify({ type: "error", data: { message: "Invalid token" } }));
        socket.close();
        return;
      }

      // Get or recreate the mediasoup room (handles server restarts)
      let room = getRoom(hangoutId);
      if (room) {
        setupSocket(room, user, hangoutId, socket);
        return;
      }

      // Room not in memory (e.g. server restart). Buffer messages while
      // we verify the hangout in DB and recreate the mediasoup room.
      const pendingMessages: (Buffer | string)[] = [];
      const bufferHandler = (raw: Buffer | string) => {
        pendingMessages.push(raw);
      };
      socket.on("message", bufferHandler);

      db.query.hangouts
        .findFirst({ where: eq(hangouts.id, hangoutId) })
        .then(async (h) => {
          if (!h || h.status === "ended") {
            socket.send(
              JSON.stringify({ type: "error", data: { message: "Room not found" } })
            );
            socket.close();
            return;
          }
          room = await createRoom(hangoutId);
          socket.removeListener("message", bufferHandler);
          setupSocket(room, user, hangoutId, socket);

          // Replay any messages that arrived while we were setting up
          for (const msg of pendingMessages) {
            socket.emit("message", msg);
          }
        })
        .catch(() => {
          socket.send(
            JSON.stringify({ type: "error", data: { message: "Room not found" } })
          );
          socket.close();
        });
    }
  );
}

function setupSocket(
  room: Room,
  user: AuthPayload,
  hangoutId: string,
  socket: WebSocket
) {
  const participant = getOrCreateParticipant(room, user.userId);
  const socketMap = getSocketMap(hangoutId);
  socketMap.set(user.userId, socket);

  // Notify existing participants about the new joiner
  broadcast(socketMap, user.userId, {
    type: "participantJoined",
    data: { userId: user.userId, username: user.username },
  });

  socket.on("message", async (raw: Buffer | string) => {
    try {
      const message: SignalingMessage = JSON.parse(
        typeof raw === "string" ? raw : raw.toString()
      );
      const response = await handleMessage(
        room,
        participant,
        user,
        hangoutId,
        message,
        socketMap
      );
      if (response) {
        socket.send(JSON.stringify({ ...response, id: message.id }));
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      socket.send(
        JSON.stringify({ type: "error", data: { message: errMsg } })
      );
    }
  });

  socket.on("close", () => {
    socketMap.delete(user.userId);
    removeParticipant(room, user.userId);

    // Notify other participants
    broadcast(socketMap, user.userId, {
      type: "participantLeft",
      data: { userId: user.userId, username: user.username },
    });

    // Clean up room socket tracking when room empties
    if (socketMap.size === 0) {
      roomSockets.delete(hangoutId);
      clearRoomChat(hangoutId);
    }
  });
}

// Track WebSocket connections per room
const roomSockets = new Map<string, Map<string, WebSocket>>();

// In-memory chat history per room (last 200 messages)
const MAX_CHAT_HISTORY = 200;

interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  displayName?: string;
  text: string;
  timestamp: string;
}

// Private hangout chat (participants only)
const roomHangoutChat = new Map<string, ChatMessage[]>();
// Public live chat (visible to stream viewers)
const roomLiveChat = new Map<string, ChatMessage[]>();

function getHangoutChat(hangoutId: string): ChatMessage[] {
  let chat = roomHangoutChat.get(hangoutId);
  if (!chat) {
    chat = [];
    roomHangoutChat.set(hangoutId, chat);
  }
  return chat;
}

function getLiveChat(hangoutId: string): ChatMessage[] {
  let chat = roomLiveChat.get(hangoutId);
  if (!chat) {
    chat = [];
    roomLiveChat.set(hangoutId, chat);
  }
  return chat;
}

export function clearRoomChat(hangoutId: string): void {
  roomHangoutChat.delete(hangoutId);
  roomLiveChat.delete(hangoutId);
}

function getSocketMap(hangoutId: string) {
  let map = roomSockets.get(hangoutId);
  if (!map) {
    map = new Map();
    roomSockets.set(hangoutId, map);
  }
  return map;
}

function broadcast(
  socketMap: Map<string, WebSocket>,
  excludeUserId: string,
  message: Record<string, unknown>
) {
  const payload = JSON.stringify(message);
  for (const [userId, ws] of socketMap) {
    if (userId !== excludeUserId && ws.readyState === 1) {
      ws.send(payload);
    }
  }
}

async function handleMessage(
  room: Room,
  participant: Participant,
  user: AuthPayload,
  hangoutId: string,
  message: SignalingMessage,
  socketMap: Map<string, WebSocket>
): Promise<Record<string, unknown> | null> {
  switch (message.type) {
    case "getRouterRtpCapabilities": {
      return {
        type: "routerRtpCapabilities",
        data: { rtpCapabilities: room.router.rtpCapabilities },
      };
    }

    case "createWebRtcTransport": {
      const { producing } = (message.data ?? {}) as { producing?: boolean };
      const { transport, params } = await createWebRtcTransport(room.router);

      if (producing) {
        participant.sendTransport = transport;
      } else {
        participant.recvTransport = transport;
      }

      return {
        type: "webRtcTransportCreated",
        data: {
          ...params,
          producing: !!producing,
        },
      };
    }

    case "connectTransport": {
      const { dtlsParameters, producing } = message.data as {
        dtlsParameters: DtlsParameters;
        producing: boolean;
      };

      const transport = producing
        ? participant.sendTransport
        : participant.recvTransport;

      if (!transport) {
        return {
          type: "error",
          data: { message: "Transport not found" },
        };
      }

      await connectTransport(transport, dtlsParameters);
      return { type: "transportConnected", data: { producing } };
    }

    case "produce": {
      const { kind, rtpParameters, appData } = message.data as {
        kind: MediaKind;
        rtpParameters: RtpParameters;
        appData?: Record<string, unknown>;
      };

      if (!participant.sendTransport) {
        return { type: "error", data: { message: "Send transport not found" } };
      }

      const producer = await participant.sendTransport.produce({
        kind,
        rtpParameters,
        appData: { ...appData, userId: user.userId },
      });

      participant.producers.set(producer.id, producer);

      producer.on("transportclose", () => {
        participant.producers.delete(producer.id);
      });

      // Notify other participants about the new producer
      broadcast(socketMap, user.userId, {
        type: "newProducer",
        data: {
          producerId: producer.id,
          userId: user.userId,
          username: user.username,
          kind: producer.kind,
        },
      });

      return {
        type: "produced",
        data: { producerId: producer.id },
      };
    }

    case "consume": {
      const { producerId, rtpCapabilities } = message.data as {
        producerId: string;
        rtpCapabilities: RtpCapabilities;
      };

      if (!room.router.canConsume({ producerId, rtpCapabilities })) {
        return { type: "error", data: { message: "Cannot consume" } };
      }

      if (!participant.recvTransport) {
        return {
          type: "error",
          data: { message: "Recv transport not found" },
        };
      }

      const consumer = await participant.recvTransport.consume({
        producerId,
        rtpCapabilities,
        paused: true,
      });

      participant.consumers.set(consumer.id, consumer);

      consumer.on("transportclose", () => {
        participant.consumers.delete(consumer.id);
      });

      consumer.on("producerclose", () => {
        participant.consumers.delete(consumer.id);
        const ws = socketMap.get(user.userId);
        if (ws && ws.readyState === 1) {
          ws.send(
            JSON.stringify({
              type: "producerClosed",
              data: { consumerId: consumer.id, producerId },
            })
          );
        }
      });

      return {
        type: "consumed",
        data: {
          consumerId: consumer.id,
          producerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
        },
      };
    }

    case "resumeConsumer": {
      const { consumerId } = message.data as { consumerId: string };
      const consumer = participant.consumers.get(consumerId);
      if (!consumer) {
        return { type: "error", data: { message: "Consumer not found" } };
      }
      await consumer.resume();
      return { type: "consumerResumed", data: { consumerId } };
    }

    case "pauseProducer": {
      const { producerId } = message.data as { producerId: string };
      const producer = participant.producers.get(producerId);
      if (!producer) {
        return { type: "error", data: { message: "Producer not found" } };
      }
      await producer.pause();

      // Notify other participants so they can pause the corresponding consumer
      broadcast(socketMap, user.userId, {
        type: "producerPaused",
        data: { producerId, userId: user.userId },
      });

      return { type: "producerPaused", data: { producerId } };
    }

    case "resumeProducer": {
      const { producerId } = message.data as { producerId: string };
      const producer = participant.producers.get(producerId);
      if (!producer) {
        return { type: "error", data: { message: "Producer not found" } };
      }
      await producer.resume();

      broadcast(socketMap, user.userId, {
        type: "producerResumed",
        data: { producerId, userId: user.userId },
      });

      return { type: "producerResumed", data: { producerId } };
    }

    case "closeProducer": {
      const { producerId } = message.data as { producerId: string };
      const producer = participant.producers.get(producerId);
      if (!producer) {
        return { type: "error", data: { message: "Producer not found" } };
      }
      producer.close();
      participant.producers.delete(producerId);
      return { type: "producerClosed", data: { producerId } };
    }

    case "getParticipants": {
      const participants: Array<{
        userId: string;
        producers: Array<{ id: string; kind: string }>;
      }> = [];

      for (const [uid, p] of room.participants) {
        if (uid === user.userId) continue;
        const producers = Array.from(p.producers.values()).map((prod) => ({
          id: prod.id,
          kind: prod.kind,
        }));
        if (producers.length > 0) {
          participants.push({ userId: uid, producers });
        }
      }

      return {
        type: "participants",
        data: { participants },
      };
    }

    case "hangoutChat": {
      const parsed = hangoutChatMessageSchema.safeParse(message.data);
      if (!parsed.success) {
        return { type: "error", data: { message: "Invalid chat message" } };
      }

      const chatMsg: ChatMessage = {
        id: crypto.randomUUID(),
        userId: user.userId,
        username: user.username,
        text: parsed.data.text,
        timestamp: new Date().toISOString(),
      };

      // Store in private hangout chat history
      const hChat = getHangoutChat(hangoutId);
      hChat.push(chatMsg);
      if (hChat.length > MAX_CHAT_HISTORY) {
        hChat.shift();
      }

      // Broadcast to all participants only (private)
      const hangoutPayload = JSON.stringify({
        type: "hangoutChat",
        data: chatMsg,
      });
      for (const [, ws] of socketMap) {
        if (ws.readyState === 1) {
          ws.send(hangoutPayload);
        }
      }

      return null; // Already sent to all
    }

    case "liveChatMessage": {
      const parsed = hangoutChatMessageSchema.safeParse(message.data);
      if (!parsed.success) {
        return { type: "error", data: { message: "Invalid chat message" } };
      }

      const chatMsg: ChatMessage = {
        id: crypto.randomUUID(),
        userId: user.userId,
        username: user.username,
        text: parsed.data.text,
        timestamp: new Date().toISOString(),
      };

      // Store in public live chat history
      const lChat = getLiveChat(hangoutId);
      lChat.push(chatMsg);
      if (lChat.length > MAX_CHAT_HISTORY) {
        lChat.shift();
      }

      // Broadcast to all participants in the room
      const livePayload = JSON.stringify({
        type: "liveChatMessage",
        data: chatMsg,
      });
      for (const [, ws] of socketMap) {
        if (ws.readyState === 1) {
          ws.send(livePayload);
        }
      }

      // Also broadcast via SSE for external live stream viewers
      broadcastToUsers(
        Array.from(socketMap.keys()),
        "hangout_live_chat",
        { hangoutId, message: chatMsg }
      );

      return null; // Already sent to all
    }

    case "getHangoutChatHistory": {
      const hChat = getHangoutChat(hangoutId);
      return {
        type: "hangoutChatHistory",
        data: { messages: hChat },
      };
    }

    case "getLiveChatHistory": {
      const lChat = getLiveChat(hangoutId);
      return {
        type: "liveChatHistory",
        data: { messages: lChat },
      };
    }

    default:
      return { type: "error", data: { message: `Unknown message type: ${message.type}` } };
  }
}
