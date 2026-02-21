import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import jwt from "jsonwebtoken";
import { config } from "../../../config.js";
import type { AuthPayload } from "../../../middleware/auth.js";
import {
  getRoom,
  getOrCreateParticipant,
  removeParticipant,
  type Room,
  type Participant,
} from "../../../mediasoup/rooms.js";
import {
  createWebRtcTransport,
  connectTransport,
} from "../../../mediasoup/transports.js";
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

      const room = getRoom(hangoutId);
      if (!room) {
        socket.send(JSON.stringify({ type: "error", data: { message: "Room not found" } }));
        socket.close();
        return;
      }

      const participant = getOrCreateParticipant(room, user.userId);

      // Track all sockets in the room for broadcasting
      const socketMap = getSocketMap(hangoutId);
      socketMap.set(user.userId, socket);

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
      });
    }
  );
}

// Track WebSocket connections per room
const roomSockets = new Map<string, Map<string, WebSocket>>();

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

    default:
      return { type: "error", data: { message: `Unknown message type: ${message.type}` } };
  }
}
