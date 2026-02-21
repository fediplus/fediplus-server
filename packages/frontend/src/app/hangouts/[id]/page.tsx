"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useAuthStore } from "@/stores/auth";
import { useHangoutStore } from "@/stores/hangouts";
import { useMediasoup } from "@/hooks/useMediasoup";
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

  const { connect, disconnect, toggleMute, toggleCamera, shareScreen } =
    useMediasoup(hangoutId);

  const [joined, setJoined] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showChat, setShowChat] = useState(false);
  const [showStreamDialog, setShowStreamDialog] = useState(false);
  const [chatMessages, setChatMessages] = useState<
    Array<{ sender: string; text: string }>
  >([]);
  const [chatInput, setChatInput] = useState("");

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

  async function handleJoin() {
    try {
      await apiFetch(`/api/v1/hangouts/${hangoutId}/join`, {
        method: "POST",
      });
      setJoined(true);
      await connect();
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

        {/* Chat panel */}
        {showChat && (
          <div className={styles.chatPanel} role="complementary" aria-label="Text chat">
            <div className={styles.chatHeader}>
              <span>Chat</span>
              <button
                onClick={() => setShowChat(false)}
                aria-label="Close chat"
              >
                &times;
              </button>
            </div>
            <div
              className={styles.chatMessages}
              role="log"
              aria-live="polite"
            >
              {chatMessages.map((msg, i) => (
                <div key={i} className={styles.chatMessage}>
                  <span className={styles.chatSender}>{msg.sender}:</span>
                  {msg.text}
                </div>
              ))}
            </div>
            <div className={styles.chatInputRow}>
              <input
                className={styles.chatInput}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Type a message..."
                aria-label="Chat message"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && chatInput.trim()) {
                    setChatMessages((prev) => [
                      ...prev,
                      {
                        sender: user?.username ?? "You",
                        text: chatInput.trim(),
                      },
                    ]);
                    setChatInput("");
                  }
                }}
              />
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
          className={styles.controlBtn}
          onClick={() => setShowChat(!showChat)}
          aria-label={showChat ? "Close chat" : "Open chat"}
          aria-pressed={showChat}
          style={{ background: "var(--color-bg-primary)" }}
        >
          {"\uD83D\uDCAC"}
        </button>

        {isCreator && (
          <button
            className={`${styles.controlBtn} ${styles.streamBtn} ${
              currentHangout.rtmpActive ? styles.streamBtnActive : ""
            }`}
            onClick={() => {
              if (currentHangout.rtmpActive) {
                apiFetch(`/api/v1/hangouts/${hangoutId}/stream`, {
                  method: "DELETE",
                }).then(() => {
                  setCurrentHangout({
                    ...currentHangout,
                    rtmpActive: false,
                  });
                  announce("Live stream stopped");
                });
              } else {
                setShowStreamDialog(true);
              }
            }}
            aria-label={
              currentHangout.rtmpActive
                ? "Stop live stream"
                : "Start Hangout On Air"
            }
            title={
              currentHangout.rtmpActive
                ? "Stop streaming"
                : "Hangout On Air"
            }
          >
            {currentHangout.rtmpActive ? "Stop LIVE" : "On Air"}
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
  onClose,
  onStarted,
}: {
  hangoutId: string;
  onClose: () => void;
  onStarted: () => void;
}) {
  const [rtmpUrl, setRtmpUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      await apiFetch(`/api/v1/hangouts/${hangoutId}/stream`, {
        method: "POST",
        body: JSON.stringify({ rtmpUrl }),
      });
      onStarted();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to start stream"
      );
    } finally {
      setSubmitting(false);
    }
  }

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
        <p>
          Enter the RTMP ingest URL from YouTube, Owncast, or any RTMP-compatible platform.
        </p>
        <form onSubmit={handleStart}>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <Input
            label="RTMP URL"
            value={rtmpUrl}
            onChange={(e) => setRtmpUrl(e.target.value)}
            placeholder="rtmp://..."
            required
          />
          <div className={styles.dialogActions}>
            <Button type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={submitting || !rtmpUrl.trim()}
            >
              {submitting ? "Starting..." : "Go Live"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
