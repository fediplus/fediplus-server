"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Device } from "mediasoup-client";
import type {
  Transport,
  Producer,
  Consumer,
  RtpCapabilities,
} from "mediasoup-client/types";
import { useAuthStore } from "@/stores/auth";
import { useHangoutStore } from "@/stores/hangouts";

function getWsUrl(hangoutId: string, token: string) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/v1/hangouts/${hangoutId}/ws?token=${encodeURIComponent(token)}`;
}

export interface ChatMessageData {
  id: string;
  userId: string;
  username: string;
  displayName?: string;
  text: string;
  timestamp: string;
}

interface SignalingMessage {
  type: string;
  data?: Record<string, unknown>;
  id?: string;
}

export function useMediasoup(hangoutId: string | null) {
  const token = useAuthStore((s) => s.token);
  const userId = useAuthStore((s) => s.user?.id);
  const {
    setLocalStream,
    addRemoteStream,
    removeRemoteStream,
    setConnected,
    setMuted,
    setCameraOff,
    setScreenSharing,
  } = useHangoutStore();

  const wsRef = useRef<WebSocket | null>(null);
  const deviceRef = useRef<Device | null>(null);
  const sendTransportRef = useRef<Transport | null>(null);
  const recvTransportRef = useRef<Transport | null>(null);
  const producersRef = useRef<Map<string, Producer>>(new Map());
  const consumersRef = useRef<Map<string, Consumer>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const pendingRequests = useRef<Map<string, (data: Record<string, unknown>) => void>>(new Map());
  const requestIdCounter = useRef(0);
  const hangoutChatCallbackRef = useRef<((msg: ChatMessageData) => void) | null>(null);
  const liveChatCallbackRef = useRef<((msg: ChatMessageData) => void) | null>(null);

  const sendRequest = useCallback(
    (type: string, data?: Record<string, unknown>): Promise<Record<string, unknown>> => {
      return new Promise((resolve, reject) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          reject(new Error("WebSocket not connected"));
          return;
        }
        const id = String(++requestIdCounter.current);
        pendingRequests.current.set(id, resolve);
        ws.send(JSON.stringify({ type, data, id }));

        // Timeout after 10s
        setTimeout(() => {
          if (pendingRequests.current.has(id)) {
            pendingRequests.current.delete(id);
            reject(new Error(`Request ${type} timed out`));
          }
        }, 10000);
      });
    },
    []
  );

  const consumeProducer = useCallback(
    async (producerId: string, producerUserId: string) => {
      if (!deviceRef.current || !recvTransportRef.current) return;

      const response = await sendRequest("consume", {
        producerId,
        rtpCapabilities: deviceRef.current.rtpCapabilities as unknown as Record<string, unknown>,
      });

      const respData = (response.data ?? response) as Record<string, unknown>;

      const consumer = await recvTransportRef.current.consume({
        id: respData.consumerId as string,
        producerId,
        kind: (respData.kind as string) as "audio" | "video",
        rtpParameters: respData.rtpParameters as unknown as import("mediasoup-client/types").RtpParameters,
      });

      consumersRef.current.set(consumer.id, consumer);

      // Add track to remote stream
      const store = useHangoutStore.getState();
      let stream = store.remoteStreams.get(producerUserId);
      if (!stream) {
        stream = new MediaStream();
        addRemoteStream(producerUserId, stream);
      }
      stream.addTrack(consumer.track);

      // Resume the consumer
      await sendRequest("resumeConsumer", { consumerId: consumer.id });
    },
    [sendRequest, addRemoteStream]
  );

  const connect = useCallback(async () => {
    if (!hangoutId || !token) return;

    const ws = new WebSocket(getWsUrl(hangoutId, token));
    wsRef.current = ws;

    // Set up notification handler immediately (before open completes)
    ws.onmessage = (event) => {
      const message: SignalingMessage = JSON.parse(event.data);

      // Check if this is a response to a pending request
      if (message.id && pendingRequests.current.has(message.id)) {
        const resolve = pendingRequests.current.get(message.id)!;
        pendingRequests.current.delete(message.id);
        resolve(message as unknown as Record<string, unknown>);
        return;
      }

      // Handle server-initiated notifications
      switch (message.type) {
        case "newProducer": {
          const { producerId, userId: producerUserId } = message.data as {
            producerId: string;
            userId: string;
          };
          consumeProducer(producerId, producerUserId);
          break;
        }

        case "producerClosed": {
          const { consumerId } = message.data as { consumerId: string };
          const consumer = consumersRef.current.get(consumerId);
          if (consumer) {
            consumer.close();
            consumersRef.current.delete(consumerId);
          }
          break;
        }

        case "producerPaused": {
          const { producerId: pausedId } = message.data as { producerId: string };
          // Find and pause the consumer that corresponds to this producer
          for (const consumer of consumersRef.current.values()) {
            if (consumer.producerId === pausedId) {
              consumer.pause();
              break;
            }
          }
          break;
        }

        case "producerResumed": {
          const { producerId: resumedId } = message.data as { producerId: string };
          for (const consumer of consumersRef.current.values()) {
            if (consumer.producerId === resumedId) {
              consumer.resume();
              break;
            }
          }
          break;
        }

        case "participantJoined": {
          // New participant connected â€” they will produce tracks shortly
          // which will trigger newProducer events
          break;
        }

        case "participantLeft": {
          const { userId: leftUserId } = message.data as { userId: string };
          removeRemoteStream(leftUserId);
          break;
        }

        case "chatMessage": {
          // Legacy fallback â€” treat as hangout chat
          const chatMsg = message.data as ChatMessageData;
          hangoutChatCallbackRef.current?.(chatMsg);
          break;
        }

        case "hangoutChat": {
          const hMsg = message.data as ChatMessageData;
          hangoutChatCallbackRef.current?.(hMsg);
          break;
        }

        case "liveChatMessage": {
          const lMsg = message.data as ChatMessageData;
          liveChatCallbackRef.current?.(lMsg);
          break;
        }
      }
    };

    ws.onclose = () => {
      setConnected(false);
    };

    // Wait for WebSocket to open, then complete the full setup
    await new Promise<void>((resolve, reject) => {
      ws.onerror = () => {
        reject(new Error("WebSocket connection failed"));
      };

      ws.onopen = async () => {
        try {
          // Get router RTP capabilities
          const capResponse = await sendRequest("getRouterRtpCapabilities");
          const capData = (capResponse.data ?? capResponse) as Record<string, unknown>;
          const rtpCapabilities = capData.rtpCapabilities as unknown as RtpCapabilities;

          // Create device
          const device = new Device();
          await device.load({ routerRtpCapabilities: rtpCapabilities });
          deviceRef.current = device;

          // Create send transport
          const sendResponse = await sendRequest("createWebRtcTransport", {
            producing: true,
          });
          const sendData = (sendResponse.data ?? sendResponse) as Record<string, unknown>;

          const sendTransport = device.createSendTransport({
            id: sendData.id as string,
            iceParameters: sendData.iceParameters as unknown as import("mediasoup-client/types").IceParameters,
            iceCandidates: sendData.iceCandidates as unknown as import("mediasoup-client/types").IceCandidate[],
            dtlsParameters: sendData.dtlsParameters as unknown as import("mediasoup-client/types").DtlsParameters,
            iceServers: (sendData.iceServers as Array<RTCIceServer>) ?? [],
          });

          sendTransport.on("connect", async ({ dtlsParameters }, callback, errback) => {
            try {
              await sendRequest("connectTransport", {
                dtlsParameters: dtlsParameters as unknown as Record<string, unknown>,
                producing: true,
              });
              callback();
            } catch (err) {
              errback(err as Error);
            }
          });

          sendTransport.on("produce", async ({ kind, rtpParameters, appData }, callback, errback) => {
            try {
              const response = await sendRequest("produce", {
                kind,
                rtpParameters: rtpParameters as unknown as Record<string, unknown>,
                appData: appData as Record<string, unknown>,
              });
              const prodData = (response.data ?? response) as Record<string, unknown>;
              const producerId = prodData.producerId as string;
              callback({ id: producerId });
            } catch (err) {
              errback(err as Error);
            }
          });

          sendTransportRef.current = sendTransport;

          // Create recv transport
          const recvResponse = await sendRequest("createWebRtcTransport", {
            producing: false,
          });
          const recvData = (recvResponse.data ?? recvResponse) as Record<string, unknown>;

          const recvTransport = device.createRecvTransport({
            id: recvData.id as string,
            iceParameters: recvData.iceParameters as unknown as import("mediasoup-client/types").IceParameters,
            iceCandidates: recvData.iceCandidates as unknown as import("mediasoup-client/types").IceCandidate[],
            dtlsParameters: recvData.dtlsParameters as unknown as import("mediasoup-client/types").DtlsParameters,
            iceServers: (recvData.iceServers as Array<RTCIceServer>) ?? [],
          });

          recvTransport.on("connect", async ({ dtlsParameters }, callback, errback) => {
            try {
              await sendRequest("connectTransport", {
                dtlsParameters: dtlsParameters as unknown as Record<string, unknown>,
                producing: false,
              });
              callback();
            } catch (err) {
              errback(err as Error);
            }
          });

          recvTransportRef.current = recvTransport;

          // Get local media â€” try audio+video, fall back to audio-only or video-only
          let stream: MediaStream | null = null;
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              audio: true,
              video: true,
            });
          } catch {
            // Camera may be unavailable â€” try audio only
            try {
              stream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: false,
              });
            } catch {
              // Audio also failed â€” try video only
              try {
                stream = await navigator.mediaDevices.getUserMedia({
                  audio: false,
                  video: true,
                });
              } catch {
                // No media at all â€” still allow joining to watch/chat
                console.warn("No camera or microphone available");
              }
            }
          }

          if (stream) {
            localStreamRef.current = stream;
            setLocalStream(stream);

            // Produce audio and video
            const audioTrack = stream.getAudioTracks()[0];
            const videoTrack = stream.getVideoTracks()[0];

            if (audioTrack) {
              const audioProducer = await sendTransport.produce({
                track: audioTrack,
              });
              producersRef.current.set("audio", audioProducer);
            }

            if (videoTrack) {
              const videoProducer = await sendTransport.produce({
                track: videoTrack,
              });
              producersRef.current.set("video", videoProducer);
            }
          }

          setConnected(true);

          // Consume existing participants
          const participantsResponse = await sendRequest("getParticipants");
          const pData = (participantsResponse.data ?? participantsResponse) as Record<string, unknown>;
          const participants = pData.participants as Array<{
            userId: string;
            producers: Array<{ id: string; kind: string }>;
          }>;

          if (participants) {
            for (const p of participants) {
              for (const prod of p.producers) {
                await consumeProducer(prod.id, p.userId);
              }
            }
          }

          resolve();
        } catch (err) {
          console.error("Failed to connect to hangout:", err);
          reject(err);
        }
      };
    });
  }, [
    hangoutId,
    token,
    sendRequest,
    consumeProducer,
    setLocalStream,
    setConnected,
    removeRemoteStream,
  ]);

  const disconnect = useCallback(() => {
    // Close producers
    for (const producer of producersRef.current.values()) {
      producer.close();
    }
    producersRef.current.clear();

    // Close consumers
    for (const consumer of consumersRef.current.values()) {
      consumer.close();
    }
    consumersRef.current.clear();

    // Close transports
    sendTransportRef.current?.close();
    recvTransportRef.current?.close();
    sendTransportRef.current = null;
    recvTransportRef.current = null;

    // Stop local media
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setLocalStream(null);

    // Stop screen share
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;

    // Close WebSocket
    wsRef.current?.close();
    wsRef.current = null;

    setConnected(false);
  }, [setLocalStream, setConnected]);

  const toggleMute = useCallback(async () => {
    const audioProducer = producersRef.current.get("audio");
    if (!audioProducer) return;

    if (audioProducer.paused) {
      audioProducer.resume();
      await sendRequest("resumeProducer", { producerId: audioProducer.id });
      setMuted(false);
    } else {
      audioProducer.pause();
      await sendRequest("pauseProducer", { producerId: audioProducer.id });
      setMuted(true);
    }

    // Update server media state for DB/SSE
    await fetch(`/api/v1/hangouts/${hangoutId}/media`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ isMuted: audioProducer.paused }),
    });
  }, [hangoutId, token, setMuted, sendRequest]);

  const toggleCamera = useCallback(async () => {
    const videoProducer = producersRef.current.get("video");
    if (!videoProducer) return;

    if (videoProducer.paused) {
      videoProducer.resume();
      await sendRequest("resumeProducer", { producerId: videoProducer.id });
      setCameraOff(false);
    } else {
      videoProducer.pause();
      await sendRequest("pauseProducer", { producerId: videoProducer.id });
      setCameraOff(true);
    }

    await fetch(`/api/v1/hangouts/${hangoutId}/media`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ isCameraOff: videoProducer.paused }),
    });
  }, [hangoutId, token, setCameraOff, sendRequest]);

  const shareScreen = useCallback(async () => {
    if (!sendTransportRef.current) return;

    if (screenStreamRef.current) {
      // Stop screen sharing
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
      const screenProducer = producersRef.current.get("screen");
      if (screenProducer) {
        screenProducer.close();
        producersRef.current.delete("screen");
      }
      setScreenSharing(false);

      await fetch(`/api/v1/hangouts/${hangoutId}/media`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ isScreenSharing: false }),
      });
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      screenStreamRef.current = stream;

      const screenTrack = stream.getVideoTracks()[0];
      const screenProducer = await sendTransportRef.current.produce({
        track: screenTrack,
        appData: { screen: true },
      });

      producersRef.current.set("screen", screenProducer);
      setScreenSharing(true);

      // When user stops sharing via browser UI
      screenTrack.onended = () => {
        screenProducer.close();
        producersRef.current.delete("screen");
        screenStreamRef.current = null;
        setScreenSharing(false);

        fetch(`/api/v1/hangouts/${hangoutId}/media`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ isScreenSharing: false }),
        });
      };

      await fetch(`/api/v1/hangouts/${hangoutId}/media`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ isScreenSharing: true }),
      });
    } catch {
      // User cancelled screen share dialog
    }
  }, [hangoutId, token, setScreenSharing]);

  const sendChatMessage = useCallback(
    (text: string) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "hangoutChat", data: { text } }));
    },
    []
  );

  const sendLiveChatMessage = useCallback(
    (text: string) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "liveChatMessage", data: { text } }));
    },
    []
  );

  const onChatMessage = useCallback(
    (callback: (msg: ChatMessageData) => void) => {
      hangoutChatCallbackRef.current = callback;
    },
    []
  );

  const onLiveChatMessage = useCallback(
    (callback: (msg: ChatMessageData) => void) => {
      liveChatCallbackRef.current = callback;
    },
    []
  );

  const loadChatHistory = useCallback(async (): Promise<ChatMessageData[]> => {
    try {
      const response = await sendRequest("getHangoutChatHistory");
      const data = (response.data ?? response) as Record<string, unknown>;
      return (data.messages as ChatMessageData[]) ?? [];
    } catch {
      return [];
    }
  }, [sendRequest]);

  const loadLiveChatHistory = useCallback(async (): Promise<ChatMessageData[]> => {
    try {
      const response = await sendRequest("getLiveChatHistory");
      const data = (response.data ?? response) as Record<string, unknown>;
      return (data.messages as ChatMessageData[]) ?? [];
    } catch {
      return [];
    }
  }, [sendRequest]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    connect,
    disconnect,
    toggleMute,
    toggleCamera,
    shareScreen,
    sendChatMessage,
    sendLiveChatMessage,
    onChatMessage,
    onLiveChatMessage,
    loadChatHistory,
    loadLiveChatHistory,
  };
}
