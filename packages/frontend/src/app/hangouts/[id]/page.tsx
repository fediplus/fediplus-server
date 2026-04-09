"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useAuthStore } from "@/stores/auth";
import { useHangoutStore } from "@/stores/hangouts";
import { useMediasoup, type ChatMessageData } from "@/hooks/useMediasoup";
import { useSSE } from "@/hooks/useSSE";
import { apiFetch } from "@/hooks/useApi";
import { announce } from "@/a11y/announcer";
import styles from "./page.module.css";

interface HangoutDetail {
  id: string;
  name: string | null;
  visibility: "public" | "private";
  status: "waiting" | "active" | "ended";
  createdById: string;
  maxParticipants: number;
  rtmpActive: boolean;
  youtubeBroadcastId: string | null;
  participants: Array<{
    userId: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    isMuted: boolean;
    isCameraOff: boolean;
    isScreenSharing: boolean;
  }>;
  creator?: {
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  } | null;
}

export default function HangoutRoomPage() {
  const params = useParams();
  const router = useRouter();
  const hangoutId = params.id as string;
  const user = useAuthStore((s) => s.user);
  const {
    currentHangout,
    setCurrentHangout,
    localStream,
    remoteStreams,
    isConnected,
    isMuted,
    isCameraOff,
    isScreenSharing,
    addParticipant,
    removeParticipant,
    updateParticipantMedia,
    reset,
  } = useHangoutStore();

  const {
    connect, disconnect, toggleMute, toggleCamera, shareScreen,
    sendChatMessage, sendLiveChatMessage,
    onChatMessage, onLiveChatMessage,
    loadChatHistory, loadLiveChatHistory,
  } = useMediasoup(hangoutId);

  const [joined, setJoined] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showHangoutChat, setShowHangoutChat] = useState(false);
  const [showLiveChat, setShowLiveChat] = useState(false);
  const [showStreamDialog, setShowStreamDialog] = useState(false);
  const [startingBroadcast, setStartingBroadcast] = useState(false);
  const [ytConnected, setYtConnected] = useState(false);
  const [hangoutChatMessages, setHangoutChatMessages] = useState<ChatMessageData[]>([]);
  const [liveChatMessages, setLiveChatMessages] = useState<ChatMessageData[]>([]);
  const [hangoutChatInput, setHangoutChatInput] = useState("");
  const [liveChatInput, setLiveChatInput] = useState("");
  const hangoutChatScrollRef = useRef<HTMLDivElement>(null);
  const liveChatScrollRef = useRef<HTMLDivElement>(null);

  // Load hangout details
  useEffect(() => {
    apiFetch<HangoutDetail>(`/api/v1/hangouts/${hangoutId}`)
      .then((data) => {
        setCurrentHangout({
          ...data,
          participants: data.participants ?? [],
        });
      })
      .catch(() => {
        router.push("/hangouts");
      })
      .finally(() => setLoading(false));

    // Check if YouTube is connected (for direct broadcasting)
    apiFetch<{ connected: boolean }>("/api/v1/youtube/connection")
      .then((yt) => setYtConnected(yt.connected))
      .catch(() => {});

    return () => {
      reset();
    };
  }, [hangoutId, setCurrentHangout, reset, router]);

  // SSE events for hangout
  useSSE(
    useCallback(
      (event: string, data: unknown) => {
        const d = data as Record<string, unknown>;
        if (d.hangoutId !== hangoutId) return;

        switch (event) {
          case "participant_joined": {
            addParticipant({
              userId: d.userId as string,
              username: d.username as string,
              displayName: (d.displayName as string) ?? null,
              avatarUrl: null,
              isMuted: false,
              isCameraOff: false,
              isScreenSharing: false,
            });
            announce(
              `${d.displayName || d.username} joined the hangout`
            );
            break;
          }
          case "participant_left": {
            removeParticipant(d.userId as string);
            announce(`A participant left the hangout`);
            break;
          }
          case "media_state_changed": {
            updateParticipantMedia(d.userId as string, {
              isMuted: d.isMuted as boolean | undefined,
              isCameraOff: d.isCameraOff as boolean | undefined,
              isScreenSharing: d.isScreenSharing as boolean | undefined,
            });
            break;
          }
          case "stream_started": {
            announce("Hangout On Air has started - now streaming live");
            break;
          }
          case "stream_stopped": {
            announce("Live stream has ended");
            break;
          }
          case "hangout_ended": {
            announce("The hangout has ended");
            disconnect();
            router.push("/hangouts");
            break;
          }
        }
      },
      [
        hangoutId,
        addParticipant,
        removeParticipant,
        updateParticipantMedia,
        disconnect,
        router,
      ]
    )
  );

  // Listen for incoming hangout chat messages
  useEffect(() => {
    onChatMessage((msg: ChatMessageData) => {
      setHangoutChatMessages((prev) => [...prev, msg]);
    });
  }, [onChatMessage]);

  // Listen for incoming live chat messages
  useEffect(() => {
    onLiveChatMessage((msg: ChatMessageData) => {
      setLiveChatMessages((prev) => [...prev, msg]);
    });
  }, [onLiveChatMessage]);

  // Auto-scroll hangout chat
  useEffect(() => {
    if (hangoutChatScrollRef.current) {
      hangoutChatScrollRef.current.scrollTop = hangoutChatScrollRef.current.scrollHeight;
    }
  }, [hangoutChatMessages]);

  // Auto-scroll live chat
  useEffect(() => {
    if (liveChatScrollRef.current) {
      liveChatScrollRef.current.scrollTop = liveChatScrollRef.current.scrollHeight;
    }
  }, [liveChatMessages]);

  function handleSendHangoutChat() {
    const text = hangoutChatInput.trim();
    if (!text) return;
    sendChatMessage(text);
    setHangoutChatInput("");
  }

  function handleSendLiveChat() {
    const text = liveChatInput.trim();
    if (!text) return;
    sendLiveChatMessage(text);
    setLiveChatInput("");
  }

  async function handleJoin() {
    try {
      await apiFetch(`/api/v1/hangouts/${hangoutId}/join`, {
        method: "POST",
      });
      setJoined(true);
      await connect();
      // Load chat histories after connecting
      const [hangoutHistory, liveHistory] = await Promise.all([
        loadChatHistory(),
        loadLiveChatHistory(),
      ]);
      if (hangoutHistory.length > 0) setHangoutChatMessages(hangoutHistory);
      if (liveHistory.length > 0) setLiveChatMessages(liveHistory);
      announce("You joined the hangout");
    } catch (err) {
      announce("Failed to join hangout");
    }
  }

  async function handleLeave() {
    try {
      await apiFetch(`/api/v1/hangouts/${hangoutId}/leave`, {
        method: "POST",
      });
    } catch {
      // Ignore
    }
    disconnect();
    reset();
    router.push("/hangouts");
    announce("You left the hangout");
  }

  async function handleEndHangout() {
    try {
      await apiFetch(`/api/v1/hangouts/${hangoutId}`, {
        method: "DELETE",
      });
    } catch {
      // Ignore
    }
    disconnect();
    reset();
    router.push("/hangouts");
  }

  async function handleToggleMute() {
    await toggleMute();
    announce(isMuted ? "You are now unmuted" : "You are now muted");
  }

  async function handleToggleCamera() {
    await toggleCamera();
    announce(
      isCameraOff ? "Camera turned on" : "Camera turned off"
    );
  }

  async function handleShareScreen() {
    await shareScreen();
    announce(
      isScreenSharing
        ? "Screen sharing stopped"
        : "Screen sharing started"
    );
  }

  if (loading) {
    return <p role="status">Loading hangout...</p>;
  }

  if (!currentHangout) {
    return <p>Hangout not found.</p>;
  }

  if (currentHangout.status === "ended") {
    return (
      <div className={styles.joinScreen}>
        <h1 className={styles.joinTitle}>Hangout Ended</h1>
        <Button onClick={() => router.push("/hangouts")}>
          Back to Hangouts
        </Button>
      </div>
    );
  }

  // Not yet joined
  if (!joined) {
    return (
      <div className={styles.joinScreen}>
        <h1 className={styles.joinTitle}>
          {currentHangout.name || "Hangout"}
        </h1>
        <p className={styles.joinMeta}>
          {currentHangout.participants.length} participant
          {currentHangout.participants.length !== 1 ? "s" : ""} &middot;{" "}
          {currentHangout.creator?.displayName ||
            currentHangout.creator?.username ||
            "Unknown"}{" "}
          hosting
        </p>
        {user ? (
          <Button variant="primary" onClick={handleJoin}>
            Join Hangout
          </Button>
        ) : (
          <p>Sign in to join this hangout.</p>
        )}
      </div>
    );
  }

  const isCreator = user?.id === currentHangout.createdById;
  const participants = currentHangout.participants;

  // Determine grid class
  const count = participants.length;
  const gridClass =
    count <= 1
      ? styles.grid1
      : count === 2
        ? styles.grid2
        : count <= 4
          ? styles.grid4
          : count <= 9
            ? styles.grid9
            : styles.grid10;

  return (
    <div className={styles.container}>
      {/* Top bar */}
      <div className={styles.topBar}>
        <div className={styles.hangoutInfo}>
          <span className={styles.hangoutName}>
            {currentHangout.name || "Hangout"}
          </span>
          {currentHangout.rtmpActive && (
            <span className={styles.liveBadge}>LIVE</span>
          )}
        </div>
        <span className={styles.participantCount}>
          {participants.length} / {currentHangout.maxParticipants}
        </span>
      </div>

      {/* Screen-reader accessible participant list */}
      <div className={styles.srOnly} aria-live="polite">
        <h2>Participants</h2>
        <ul>
          {participants.map((p) => (
            <li key={p.userId}>
              {p.displayName || p.username} -{" "}
              {p.isMuted ? "muted" : "unmuted"},{" "}
              {p.isCameraOff ? "camera off" : "camera on"}
              {p.isScreenSharing ? ", screen sharing" : ""}
            </li>
          ))}
        </ul>
      </div>

      {/* Video area */}
      <div className={styles.videoArea}>
        <div className={`${styles.videoGrid} ${gridClass}`}>
          {participants.map((p) => (
            <VideoTile
              key={p.userId}
              participant={p}
              stream={remoteStreams.get(p.userId) ?? null}
              isLocal={p.userId === user?.id}
              localStream={localStream}
            />
          ))}
        </div>

        {/* Hangout Chat panel (private, participants only) */}
        {showHangoutChat && (
          <div className={styles.chatPanel} role="complementary" aria-label="Hangout chat">
            <div className={styles.chatHeader}>
              <span>Hangout Chat</span>
              <button
                onClick={() => setShowHangoutChat(false)}
                aria-label="Close hangout chat"
              >
                &times;
              </button>
            </div>
            <div
              ref={hangoutChatScrollRef}
              className={styles.chatMessages}
              role="log"
              aria-live="polite"
            >
              {hangoutChatMessages.length === 0 && (
                <p className={styles.chatEmpty}>No messages yet. Say hello!</p>
              )}
              {hangoutChatMessages.map((msg) => (
                <div key={msg.id} className={styles.chatMessage}>
                  <span className={styles.chatSender}>
                    {msg.displayName || msg.username}:
                  </span>{" "}
                  {msg.text}
                  <span className={styles.chatTime}>
                    {new Date(msg.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              ))}
            </div>
            <div className={styles.chatInputRow}>
              <input
                className={styles.chatInput}
                value={hangoutChatInput}
                onChange={(e) => setHangoutChatInput(e.target.value)}
                placeholder="Message participants..."
                aria-label="Hangout chat message"
                maxLength={500}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendHangoutChat();
                  }
                }}
              />
              <button
                className={styles.chatSendBtn}
                onClick={handleSendHangoutChat}
                disabled={!hangoutChatInput.trim()}
                aria-label="Send message"
              >
                Send
              </button>
            </div>
          </div>
        )}

        {/* Live Chat panel (public, visible to stream viewers — only when On Air) */}
        {showLiveChat && (
          <div className={`${styles.chatPanel} ${styles.liveChatPanel}`} role="complementary" aria-label="Live chat">
            <div className={`${styles.chatHeader} ${styles.liveChatHeader}`}>
              <span>
                Live Chat
                <span className={styles.chatLiveBadge}>LIVE</span>
              </span>
              <button
                onClick={() => setShowLiveChat(false)}
                aria-label="Close live chat"
              >
                &times;
              </button>
            </div>
            <div
              ref={liveChatScrollRef}
              className={styles.chatMessages}
              role="log"
              aria-live="polite"
            >
              {liveChatMessages.length === 0 && (
                <p className={styles.chatEmpty}>
                  No live chat messages yet. Messages here are visible to stream
                  viewers.
                </p>
              )}
              {liveChatMessages.map((msg) => (
                <div key={msg.id} className={styles.chatMessage}>
                  <span className={styles.chatSender}>
                    {msg.displayName || msg.username}:
                  </span>{" "}
                  {msg.text}
                  <span className={styles.chatTime}>
                    {new Date(msg.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              ))}
            </div>
            <div className={styles.chatInputRow}>
              <input
                className={styles.chatInput}
                value={liveChatInput}
                onChange={(e) => setLiveChatInput(e.target.value)}
                placeholder="Message live viewers..."
                aria-label="Live chat message"
                maxLength={500}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendLiveChat();
                  }
                }}
              />
              <button
                className={styles.chatSendBtn}
                onClick={handleSendLiveChat}
                disabled={!liveChatInput.trim()}
                aria-label="Send live chat message"
              >
                Send
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Local self-view */}
      {localStream && (
        <div className={styles.localVideo}>
          <LocalVideoPreview stream={localStream} />
        </div>
      )}

      {/* Controls bar */}
      <div className={styles.controlsBar} role="toolbar" aria-label="Hangout controls">
        <button
          className={`${styles.controlBtn} ${
            isMuted ? styles.controlInactive : styles.controlActive
          }`}
          onClick={handleToggleMute}
          aria-label={`Toggle microphone, currently ${isMuted ? "muted" : "unmuted"}`}
          title={isMuted ? "Unmute" : "Mute"}
        >
          {isMuted ? "\uD83D\uDD07" : "\uD83C\uDF99"}
        </button>

        <button
          className={`${styles.controlBtn} ${
            isCameraOff ? styles.controlInactive : styles.controlActive
          }`}
          onClick={handleToggleCamera}
          aria-label={`Toggle camera, currently ${isCameraOff ? "off" : "on"}`}
          title={isCameraOff ? "Turn camera on" : "Turn camera off"}
        >
          {isCameraOff ? "\uD83D\uDEAB" : "\uD83D\uDCF7"}
        </button>

        <button
          className={`${styles.controlBtn} ${
            isScreenSharing ? styles.controlScreen : styles.controlScreenOff
          }`}
          onClick={handleShareScreen}
          aria-label={`Toggle screen share, currently ${isScreenSharing ? "sharing" : "not sharing"}`}
          title={isScreenSharing ? "Stop sharing" : "Share screen"}
        >
          {"\uD83D\uDCBB"}
        </button>

        <button
          className={`${styles.controlBtn} ${showHangoutChat ? styles.controlChatActive : ""}`}
          onClick={() => {
            setShowHangoutChat(!showHangoutChat);
            if (!showHangoutChat) setShowLiveChat(false);
          }}
          aria-label={showHangoutChat ? "Close hangout chat" : "Open hangout chat"}
          aria-pressed={showHangoutChat}
          style={{ background: "var(--color-bg-primary)" }}
          title="Hangout Chat"
        >
          {"\uD83D\uDCAC"}
        </button>

        {currentHangout.rtmpActive && (
          <button
            className={`${styles.controlBtn} ${styles.liveChatBtn} ${showLiveChat ? styles.controlChatActive : ""}`}
            onClick={() => {
              setShowLiveChat(!showLiveChat);
              if (!showLiveChat) setShowHangoutChat(false);
            }}
            aria-label={showLiveChat ? "Close live chat" : "Open live chat"}
            aria-pressed={showLiveChat}
            title="Live Chat"
          >
            {"\uD83D\uDCE1"}
          </button>
        )}

        {currentHangout.rtmpActive && currentHangout.youtubeBroadcastId && (
          <button
            className={styles.controlBtn}
            onClick={() => {
              const embedCode =
                `<iframe width="560" height="315" ` +
                `src="https://www.youtube.com/embed/${currentHangout.youtubeBroadcastId}" ` +
                `frameborder="0" allowfullscreen></iframe>`;
              navigator.clipboard.writeText(embedCode).then(() => {
                announce("Embed code copied to clipboard");
              });
            }}
            aria-label="Copy embed code"
            title="Copy embed code"
          >
            {"</>"}
          </button>
        )}

        {isCreator && (
          <button
            className={`${styles.controlBtn} ${styles.streamBtn} ${
              currentHangout.rtmpActive ? styles.streamBtnActive : ""
            }`}
            disabled={startingBroadcast}
            onClick={async () => {
              if (currentHangout.rtmpActive) {
                apiFetch(`/api/v1/hangouts/${hangoutId}/stream`, {
                  method: "DELETE",
                }).then(() => {
                  setCurrentHangout({
                    ...currentHangout,
                    rtmpActive: false,
                  });
                  announce("Broadcast stopped");
                });
              } else if (ytConnected) {
                // Direct broadcast — no dialog, just like original HoA
                setStartingBroadcast(true);
                try {
                  await apiFetch(`/api/v1/hangouts/${hangoutId}/stream`, {
                    method: "POST",
                    body: JSON.stringify({}),
                  });
                  setCurrentHangout({
                    ...currentHangout,
                    rtmpActive: true,
                  });
                  announce("Broadcasting now! Live on your profile and YouTube");
                } catch (err) {
                  announce(
                    err instanceof Error
                      ? err.message
                      : "Failed to start broadcast",
                    "assertive"
                  );
                } finally {
                  setStartingBroadcast(false);
                }
              } else {
                // No YouTube — show the destination picker dialog
                setShowStreamDialog(true);
              }
            }}
            aria-label={
              currentHangout.rtmpActive
                ? "Stop broadcasting"
                : startingBroadcast
                  ? "Starting broadcast…"
                  : "Start broadcasting"
            }
            title={
              currentHangout.rtmpActive
                ? "Stop broadcasting"
                : "Start broadcasting"
            }
          >
            {currentHangout.rtmpActive
              ? "Stop broadcasting"
              : startingBroadcast
                ? "Starting…"
                : "Start broadcasting"}
          </button>
        )}

        {isCreator && !currentHangout.rtmpActive && (
          <button
            className={`${styles.controlBtn} ${styles.broadcastMenuBtn}`}
            onClick={() => setShowStreamDialog(true)}
            aria-label="More broadcast options"
            title="More broadcast options"
          >
            {"\u22EE"}
          </button>
        )}

        <button
          className={`${styles.controlBtn} ${styles.endCallBtn}`}
          onClick={isCreator ? handleEndHangout : handleLeave}
          aria-label={isCreator ? "End hangout for everyone" : "Leave hangout"}
        >
          {isCreator ? "End" : "Leave"}
        </button>
      </div>

      {/* RTMP Stream Dialog */}
      {showStreamDialog && (
        <StreamDialog
          hangoutId={hangoutId}
          hangoutName={currentHangout.name || "Hangout On Air"}
          onClose={() => setShowStreamDialog(false)}
          onStarted={() => {
            setShowStreamDialog(false);
            setCurrentHangout({
              ...currentHangout,
              rtmpActive: true,
            });
            announce("Hangout On Air started - now streaming live");
          }}
        />
      )}
    </div>
  );
}

function VideoTile({
  participant,
  stream,
  isLocal,
  localStream,
}: {
  participant: {
    userId: string;
    username: string;
    displayName: string | null;
    isMuted: boolean;
    isCameraOff: boolean;
    isScreenSharing: boolean;
  };
  stream: MediaStream | null;
  isLocal: boolean;
  localStream: MediaStream | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaStream = isLocal ? localStream : stream;

  useEffect(() => {
    if (videoRef.current && mediaStream) {
      videoRef.current.srcObject = mediaStream;
    }
  }, [mediaStream]);

  const name = participant.displayName || participant.username;

  return (
    <div
      className={styles.videoTile}
      tabIndex={0}
      aria-label={`${name}'s video${participant.isMuted ? ", muted" : ""}${participant.isCameraOff ? ", camera off" : ""}`}
    >
      {participant.isCameraOff && !mediaStream ? (
        <div className={styles.cameraOff}>
          {name.charAt(0).toUpperCase()}
        </div>
      ) : (
        <video
          ref={videoRef}
          className={styles.videoElement}
          autoPlay
          playsInline
          muted={isLocal}
          style={isLocal ? { transform: "scaleX(-1)" } : undefined}
        />
      )}
      <div className={styles.videoOverlay}>
        <span className={styles.participantName}>
          {name}
          {isLocal ? " (You)" : ""}
        </span>
        <div className={styles.mediaIcons}>
          {participant.isMuted && (
            <span className={styles.mediaIcon} title="Muted" aria-label="Muted">
              {"\uD83D\uDD07"}
            </span>
          )}
          {participant.isScreenSharing && (
            <span className={styles.mediaIcon} title="Sharing screen" aria-label="Sharing screen">
              {"\uD83D\uDCBB"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function LocalVideoPreview({ stream }: { stream: MediaStream }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      aria-label="Your camera preview"
    />
  );
}

function StreamDialog({
  hangoutId,
  hangoutName,
  onClose,
  onStarted,
}: {
  hangoutId: string;
  hangoutName: string;
  onClose: () => void;
  onStarted: () => void;
}) {
  const [rtmpUrl, setRtmpUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [destinations, setDestinations] = useState<
    Array<{
      id: string;
      name: string;
      platform: string;
      rtmpUrl: string;
      streamKey: string | null;
      isDefault: boolean;
    }>
  >([]);
  const [selectedDestId, setSelectedDestId] = useState<string | null>(null);
  const [loadingDests, setLoadingDests] = useState(true);
  const [useManual, setUseManual] = useState(false);

  // YouTube state
  type StreamMode = "saved" | "youtube" | "manual";
  const [streamMode, setStreamMode] = useState<StreamMode>("saved");
  const [ytConnected, setYtConnected] = useState(false);
  const [ytChannelTitle, setYtChannelTitle] = useState("");


  useEffect(() => {
    // Fetch saved destinations and YouTube connection in parallel
    const destsPromise = apiFetch<typeof destinations>(
      "/api/v1/streaming/destinations"
    )
      .then((dests) => {
        setDestinations(dests);
        const defaultDest = dests.find((d) => d.isDefault);
        if (defaultDest) {
          setSelectedDestId(defaultDest.id);
        } else if (dests.length > 0) {
          setSelectedDestId(dests[0].id);
        }
        return dests;
      })
      .catch(() => [] as typeof destinations);

    const ytPromise = apiFetch<{
      connected: boolean;
      channelTitle?: string;
    }>("/api/v1/youtube/connection")
      .then((yt) => {
        if (yt.connected) {
          setYtConnected(true);
          setYtChannelTitle(yt.channelTitle ?? "");
        }
        return yt;
      })
      .catch(() => ({ connected: false }));

    Promise.all([destsPromise, ytPromise]).then(([dests, yt]) => {
      // Default to the best available mode
      if (yt.connected) {
        setStreamMode("youtube");
      } else if (dests.length > 0) {
        setStreamMode("saved");
      } else {
        setStreamMode("manual");
      }
      setLoadingDests(false);
    });
  }, []);

  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      if (streamMode === "youtube") {
        // Create YouTube broadcast first, then start the stream with returned RTMP
        const broadcast = await apiFetch<{
          broadcastId: string;
          rtmpUrl: string;
          streamKey: string;
        }>("/api/v1/youtube/broadcast", {
          method: "POST",
          body: JSON.stringify({ title: hangoutName }),
        });

        await apiFetch(`/api/v1/hangouts/${hangoutId}/stream`, {
          method: "POST",
          body: JSON.stringify({ rtmpUrl: broadcast.rtmpUrl }),
        });
      } else if (streamMode === "manual" || !selectedDestId) {
        if (!rtmpUrl.trim()) {
          setError("RTMP URL is required");
          setSubmitting(false);
          return;
        }
        await apiFetch(`/api/v1/hangouts/${hangoutId}/stream`, {
          method: "POST",
          body: JSON.stringify({ rtmpUrl }),
        });
      } else {
        const dest = destinations.find((d) => d.id === selectedDestId);
        await apiFetch(`/api/v1/hangouts/${hangoutId}/stream`, {
          method: "POST",
          body: JSON.stringify({
            destinationId: selectedDestId,
            rtmpUrl: dest?.rtmpUrl ?? "",
          }),
        });
      }

      onStarted();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to start stream"
      );
    } finally {
      setSubmitting(false);
    }
  }

  const platformIcons: Record<string, string> = {
    youtube: "\u25B6",
    twitch: "\u{1F7E3}",
    owncast: "\u{1F4E1}",
    custom: "\u{1F517}",
  };

  const hasTabs =
    (destinations.length > 0 ? 1 : 0) +
    (ytConnected ? 1 : 0) +
    1 /* manual */ >
    1;

  const isDisabled =
    submitting ||
    (streamMode === "manual" && !rtmpUrl.trim()) ||
    (streamMode === "saved" && !selectedDestId);

  return (
    <div
      className={styles.dialogOverlay}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="Start Hangout On Air"
    >
      <div className={styles.dialogContent}>
        <h2 className={styles.dialogTitle}>Hangout On Air</h2>

        {loadingDests ? (
          <p role="status">Loading destinations...</p>
        ) : (
          <form onSubmit={handleStart}>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}

            {hasTabs && (
              <div className={styles.destTabs}>
                {ytConnected && (
                  <button
                    type="button"
                    className={`${styles.destTab} ${streamMode === "youtube" ? styles.destTabActive : ""}`}
                    onClick={() => setStreamMode("youtube")}
                  >
                    YouTube
                  </button>
                )}
                {destinations.length > 0 && (
                  <button
                    type="button"
                    className={`${styles.destTab} ${streamMode === "saved" ? styles.destTabActive : ""}`}
                    onClick={() => setStreamMode("saved")}
                  >
                    Saved destinations
                  </button>
                )}
                <button
                  type="button"
                  className={`${styles.destTab} ${streamMode === "manual" ? styles.destTabActive : ""}`}
                  onClick={() => setStreamMode("manual")}
                >
                  Manual URL
                </button>
              </div>
            )}

            {streamMode === "youtube" && (
              <div className={styles.ytBroadcastSection}>
                <p className={styles.ytChannelInfo}>
                  Streaming <strong>{hangoutName}</strong> to{" "}
                  <strong>{ytChannelTitle}</strong> on YouTube
                </p>
              </div>
            )}

            {streamMode === "saved" && destinations.length > 0 && (
              <fieldset className={styles.destFieldset}>
                <legend className="sr-only">Select streaming destination</legend>
                {destinations.map((dest) => (
                  <label
                    key={dest.id}
                    className={`${styles.destOption} ${
                      selectedDestId === dest.id ? styles.destOptionSelected : ""
                    }`}
                  >
                    <input
                      type="radio"
                      name="destination"
                      value={dest.id}
                      checked={selectedDestId === dest.id}
                      onChange={() => setSelectedDestId(dest.id)}
                      className="sr-only"
                    />
                    <span className={styles.destIcon}>
                      {platformIcons[dest.platform] ?? "\u{1F517}"}
                    </span>
                    <div className={styles.destInfo}>
                      <span className={styles.destName}>{dest.name}</span>
                      <span className={styles.destPlatform}>
                        {dest.platform.charAt(0).toUpperCase() +
                          dest.platform.slice(1)}
                        {dest.isDefault ? " \u2022 Default" : ""}
                      </span>
                    </div>
                  </label>
                ))}
              </fieldset>
            )}

            {streamMode === "manual" && (
              <>
                <p className={styles.destHint}>
                  Enter the RTMP ingest URL from YouTube, Owncast, or any
                  RTMP-compatible platform.
                </p>
                <Input
                  label="RTMP URL"
                  value={rtmpUrl}
                  onChange={(e) => setRtmpUrl(e.target.value)}
                  placeholder="rtmp://..."
                  required
                />
              </>
            )}

            <div className={styles.dialogActions}>
              <Button type="button" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={isDisabled}
              >
                {submitting ? "Starting..." : "Go Live"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
