import { create } from "zustand";

export interface Participant {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  encryptionPublicKey: string | null;
}

export interface Conversation {
  id: string;
  createdById: string;
  isGroup: boolean;
  name: string | null;
  encrypted: boolean;
  createdAt: string;
  updatedAt: string;
  participants: Participant[];
  lastMessage: {
    senderId: string;
    createdAt: string;
  } | null;
  unreadCount: number;
}

export interface DecryptedMessage {
  id: string;
  conversationId: string;
  senderId: string;
  plaintext: string;
  createdAt: string;
}

export interface EncryptedMessage {
  id: string;
  conversationId: string;
  senderId: string;
  ciphertext: string;
  ephemeralPublicKey: string;
  iv: string;
  createdAt: string;
}

interface MessageState {
  conversations: Conversation[];
  activeConversationId: string | null;
  messages: DecryptedMessage[];
  unreadTotal: number;
  setConversations: (conversations: Conversation[]) => void;
  setActiveConversation: (id: string | null) => void;
  setMessages: (messages: DecryptedMessage[]) => void;
  appendMessage: (message: DecryptedMessage) => void;
  setUnreadTotal: (count: number) => void;
  decrementUnread: (count: number) => void;
}

export const useMessageStore = create<MessageState>()((set) => ({
  conversations: [],
  activeConversationId: null,
  messages: [],
  unreadTotal: 0,
  setConversations: (conversations) => {
    const unreadTotal = conversations.reduce(
      (sum, c) => sum + c.unreadCount,
      0
    );
    set({ conversations, unreadTotal });
  },
  setActiveConversation: (id) => set({ activeConversationId: id }),
  setMessages: (messages) => set({ messages }),
  appendMessage: (message) =>
    set((state) => ({
      messages: [...state.messages, message],
    })),
  setUnreadTotal: (unreadTotal) => set({ unreadTotal }),
  decrementUnread: (count) =>
    set((state) => ({
      unreadTotal: Math.max(0, state.unreadTotal - count),
    })),
}));
