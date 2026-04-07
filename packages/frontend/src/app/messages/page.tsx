"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useAuthStore } from "@/stores/auth";
import {
  useMessageStore,
  type Conversation,
  type DecryptedMessage,
  type EncryptedMessage,
} from "@/stores/messages";
import { apiFetch } from "@/hooks/useApi";
import { useSSE } from "@/hooks/useSSE";
import { announce } from "@/a11y/announcer";
import {
  encryptMessage,
  decryptMessage,
  encryptGroupMessage,
  decryptGroupMessage,
} from "@/crypto/e2ee";
import { loadIdentityKey, loadGroupSecret } from "@/crypto/keystore";
import styles from "./page.module.css";

export default function MessagesPage() {
  const user = useAuthStore((s) => s.user);
  const encryptionKey = useAuthStore((s) => s.encryptionKey);
  const setEncryptionKey = useAuthStore((s) => s.setEncryptionKey);
  const {
    conversations,
    activeConversationId,
    messages,
    setConversations,
    setActiveConversation,
    setMessages,
    appendMessage,
    decrementUnread,
  } = useMessageStore();

  const [loading, setLoading] = useState(true);
  const [composerText, setComposerText] = useState("");
  const [sending, setSending] = useState(false);
  const [showNewConv, setShowNewConv] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load identity key from IndexedDB on mount (auto-recovery from login)
  useEffect(() => {
    if (!user) return;

    (async () => {
      try {
        // Try to load from store first, then IndexedDB
        if (!encryptionKey) {
          const key = await loadIdentityKey(user.id);
          if (key) {
            setEncryptionKey(key);
          }
        }
      } catch {
        // Key not available — user may need to re-login
      }
      setLoading(false);
    })();
  }, [user, encryptionKey, setEncryptionKey]);

  // Load conversations
  useEffect(() => {
    if (!user) return;

    apiFetch<{ items: Conversation[] }>("/api/v1/conversations")
      .then((data) => setConversations(data.items))
      .catch(() => {});
  }, [user, setConversations]);

  // Load messages when active conversation changes
  useEffect(() => {
    if (!activeConversationId || !encryptionKey) return;

    (async () => {
      try {
        const data = await apiFetch<{ items: EncryptedMessage[] }>(
          `/api/v1/conversations/${activeConversationId}/messages`
        );
        const decrypted = await decryptMessages(data.items, encryptionKey, activeConversationId);
        setMessages(decrypted);

        // Mark as read
        await apiFetch(`/api/v1/conversations/${activeConversationId}/read`, {
          method: "POST",
        });
        const conv = conversations.find((c) => c.id === activeConversationId);
        if (conv) {
          decrementUnread(conv.unreadCount);
        }
      } catch {
        // Decryption may fail if keys don't match
      }
    })();
  }, [activeConversationId, encryptionKey, setMessages, conversations, decrementUnread]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // SSE for real-time messages
  useSSE(
    useCallback(
      (event: string, data: unknown) => {
        if (event === "new_message" && encryptionKey) {
          const payload = data as {
            conversationId: string;
            message: EncryptedMessage;
          };
          if (payload.conversationId === activeConversationId) {
            (async () => {
              try {
                const [decrypted] = await decryptMessages(
                  [payload.message],
                  encryptionKey,
                  payload.conversationId
                );
                appendMessage(decrypted);

                // Find sender name for announcement
                const conv = conversations.find(
                  (c) => c.id === payload.conversationId
                );
                const sender = conv?.participants.find(
                  (p) => p.userId === payload.message.senderId
                );
                announce(
                  `New message from ${sender?.displayName || sender?.username || "someone"}`
                );
              } catch {
                // Decryption failed
              }
            })();
          }
        }
      },
      [encryptionKey, activeConversationId, appendMessage, conversations]
    )
  );

  async function handleSend() {
    if (!composerText.trim() || !activeConversationId || !encryptionKey || sending)
      return;

    setSending(true);
    try {
      const conv = conversations.find((c) => c.id === activeConversationId);
      if (!conv) return;

      // Try MLS group encryption first, fall back to legacy
      const groupSecret = await loadGroupSecret(activeConversationId, 0);

      let body: Record<string, unknown>;

      if (groupSecret) {
        // MLS epoch-based encryption
        // Counter = number of our messages in the current epoch
        const ourMsgCount = messages.filter(
          (m) => m.senderId === user?.id
        ).length;
        const encrypted = await encryptGroupMessage(
          composerText,
          groupSecret,
          0,
          ourMsgCount
        );
        body = {
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
          epoch: encrypted.epoch,
          mlsCounter: encrypted.counter,
        };
      } else {
        // Legacy per-message ECDH
        const otherParticipant = conv.participants.find(
          (p) => p.userId !== user?.id
        );
        if (!otherParticipant?.encryptionPublicKey) {
          announce("Recipient has not set up encryption yet");
          return;
        }

        const recipientPubKey: JsonWebKey = JSON.parse(
          otherParticipant.encryptionPublicKey
        );
        const encrypted = await encryptMessage(composerText, recipientPubKey);
        body = {
          ciphertext: encrypted.ciphertext,
          ephemeralPublicKey: encrypted.ephemeralPublicKey,
          iv: encrypted.iv,
          epoch: 0,
        };
      }

      const msg = await apiFetch<EncryptedMessage>(
        `/api/v1/conversations/${activeConversationId}/messages`,
        {
          method: "POST",
          body: JSON.stringify(body),
        }
      );

      appendMessage({
        id: msg.id,
        conversationId: msg.conversationId,
        senderId: msg.senderId,
        plaintext: composerText,
        createdAt: msg.createdAt,
      });

      setComposerText("");
    } catch {
      announce("Failed to send message");
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  if (!user) {
    return (
      <div className={styles.container}>
        <p>Please sign in to access messages.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={styles.container}>
        <p role="status">Loading...</p>
      </div>
    );
  }

  if (!encryptionKey) {
    return (
      <div className={styles.container}>
        <Card className={styles.setupCard}>
          <h2 className={styles.setupTitle}>Encryption unavailable</h2>
          <p className={styles.setupDesc}>
            Your encryption keys could not be loaded. Please sign out and sign
            in again to restore access to your encrypted messages.
          </p>
        </Card>
      </div>
    );
  }

  const activeConv = conversations.find((c) => c.id === activeConversationId);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.heading}>Messages</h1>
      </header>

      <div className={styles.panels}>
        {/* Left panel: conversation list */}
        <div
          className={`${styles.panelLeft} ${activeConversationId ? styles.panelLeftHidden : ""}`}
        >
          <Button
            variant="primary"
            size="sm"
            className={styles.newConvBtn}
            onClick={() => setShowNewConv(!showNewConv)}
          >
            New conversation
          </Button>

          {showNewConv && (
            <NewConversationSearch
              onCreated={(conv) => {
                setConversations([conv, ...conversations]);
                setActiveConversation(conv.id);
                setShowNewConv(false);
              }}
            />
          )}

          <div className={styles.convList} role="list" aria-label="Conversations">
            {conversations.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={conv.id === activeConversationId}
                currentUserId={user.id}
                onClick={() => setActiveConversation(conv.id)}
              />
            ))}
          </div>
        </div>

        {/* Right panel: active conversation */}
        <div
          className={`${styles.panelRight} ${activeConversationId ? styles.panelRightActive : ""}`}
        >
          {activeConv ? (
            <>
              <div className={styles.convHeader}>
                <button
                  className={styles.backBtn}
                  onClick={() => setActiveConversation(null)}
                  aria-label="Back to conversations"
                >
                  &larr;
                </button>
                <span className={styles.convTitle}>
                  {getConversationName(activeConv, user.id)}
                </span>
                <span className={styles.lockIcon} aria-label="End-to-end encrypted">
                  &#128274; Encrypted
                </span>
              </div>

              <div className={styles.messagesArea} aria-live="polite">
                {messages.map((msg, i) => {
                  const isMine = msg.senderId === user.id;
                  const sender = activeConv.participants.find(
                    (p) => p.userId === msg.senderId
                  );
                  const showHeader =
                    i === 0 || messages[i - 1].senderId !== msg.senderId;

                  return (
                    <div key={msg.id} className={styles.messageGroup}>
                      {showHeader && !isMine && (
                        <div className={styles.messageGroupHeader}>
                          <span
                            className={styles.messageAvatar}
                            aria-hidden="true"
                          >
                            {sender?.displayName?.charAt(0) ||
                              sender?.username?.charAt(0) ||
                              "?"}
                          </span>
                          <span className={styles.messageSender}>
                            {sender?.displayName || sender?.username}
                          </span>
                          <span className={styles.messageTimestamp}>
                            {new Date(msg.createdAt).toLocaleTimeString(
                              undefined,
                              { hour: "numeric", minute: "2-digit" }
                            )}
                          </span>
                        </div>
                      )}
                      <div
                        className={`${styles.messageBubble} ${isMine ? styles.messageBubbleMine : ""}`}
                      >
                        {msg.plaintext}
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              <div className={styles.composer}>
                <textarea
                  className={styles.composerInput}
                  placeholder="Type a message..."
                  value={composerText}
                  onChange={(e) => setComposerText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={1}
                  aria-label="Message input"
                />
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleSend}
                  disabled={!composerText.trim() || sending}
                >
                  {sending ? "..." : "Send"}
                </Button>
              </div>
            </>
          ) : (
            <div className={styles.emptyPanel}>
              Select a conversation or start a new one
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Helper components ──

function ConversationItem({
  conversation,
  isActive,
  currentUserId,
  onClick,
}: {
  conversation: Conversation;
  isActive: boolean;
  currentUserId: string;
  onClick: () => void;
}) {
  const name = getConversationName(conversation, currentUserId);
  const initials = name.charAt(0).toUpperCase();

  return (
    <div
      className={`${styles.convItem} ${isActive ? styles.convItemActive : ""}`}
      onClick={onClick}
      role="listitem"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      aria-current={isActive ? "true" : undefined}
    >
      <div className={styles.convAvatar} aria-hidden="true">
        {initials}
      </div>
      <div className={styles.convInfo}>
        <div className={styles.convName}>{name}</div>
        <div className={styles.convPreview}>
          {conversation.lastMessage
            ? `Message at ${new Date(conversation.lastMessage.createdAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
            : "No messages yet"}
        </div>
      </div>
      <div className={styles.convMeta}>
        {conversation.lastMessage && (
          <span className={styles.convTime}>
            {formatRelativeTime(conversation.lastMessage.createdAt)}
          </span>
        )}
        {conversation.unreadCount > 0 && (
          <span className={styles.unreadBadge}>
            {conversation.unreadCount}
          </span>
        )}
      </div>
    </div>
  );
}

function NewConversationSearch({
  onCreated,
}: {
  onCreated: (conv: Conversation) => void;
}) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<
    { id: string; username: string; displayName: string }[]
  >([]);

  useEffect(() => {
    if (search.length < 2) {
      setResults([]);
      return;
    }
    const timeout = setTimeout(async () => {
      try {
        const data = await apiFetch<{
          items: { id: string; username: string; displayName: string }[];
        }>(`/api/v1/users/search?q=${encodeURIComponent(search)}`);
        setResults(data.items ?? []);
      } catch {
        setResults([]);
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [search]);

  async function startConversation(userId: string) {
    try {
      const conv = await apiFetch<Conversation>("/api/v1/conversations", {
        method: "POST",
        body: JSON.stringify({ participantIds: [userId] }),
      });
      onCreated(conv);
    } catch {
      announce("Failed to create conversation");
    }
  }

  return (
    <div>
      <input
        className={styles.searchInput}
        placeholder="Search users..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search users to message"
      />
      {results.map((u) => (
        <div
          key={u.id}
          className={styles.userResult}
          onClick={() => startConversation(u.id)}
          role="option"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && startConversation(u.id)}
        >
          <span className={styles.convAvatar} aria-hidden="true">
            {(u.displayName || u.username).charAt(0)}
          </span>
          <span>{u.displayName || u.username}</span>
          <span style={{ color: "var(--color-text-secondary)", fontSize: "var(--text-xs)" }}>
            @{u.username}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Utility functions ──

function getConversationName(conv: Conversation, currentUserId: string): string {
  if (conv.name) return conv.name;
  const others = conv.participants.filter((p) => p.userId !== currentUserId);
  if (others.length === 0) return "Saved Messages";
  return others.map((p) => p.displayName || p.username).join(", ");
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

async function decryptMessages(
  encrypted: EncryptedMessage[],
  privateKey: CryptoKey,
  conversationId: string
): Promise<DecryptedMessage[]> {
  const results: DecryptedMessage[] = [];
  for (const msg of encrypted) {
    try {
      let plaintext: string;

      if (msg.epoch && msg.epoch > 0 && msg.mlsCounter !== undefined && msg.mlsCounter !== null) {
        // MLS epoch-based decryption
        const groupSecret = await loadGroupSecret(conversationId, msg.epoch);
        if (!groupSecret) {
          throw new Error("Missing group secret for epoch");
        }
        plaintext = await decryptGroupMessage(
          msg.ciphertext,
          msg.iv,
          groupSecret,
          msg.epoch,
          msg.mlsCounter
        );
      } else if (msg.ephemeralPublicKey) {
        // Legacy per-message ECDH decryption
        plaintext = await decryptMessage(
          msg.ciphertext,
          msg.ephemeralPublicKey,
          msg.iv,
          privateKey
        );
      } else {
        throw new Error("Unknown encryption format");
      }

      results.push({
        id: msg.id,
        conversationId: msg.conversationId,
        senderId: msg.senderId,
        plaintext,
        createdAt: msg.createdAt,
      });
    } catch {
      results.push({
        id: msg.id,
        conversationId: msg.conversationId,
        senderId: msg.senderId,
        plaintext: "[Unable to decrypt]",
        createdAt: msg.createdAt,
      });
    }
  }
  return results;
}
