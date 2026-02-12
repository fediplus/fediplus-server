import { create } from "zustand";

export interface NotificationItem {
  id: string;
  userId: string;
  type: string;
  actorId: string;
  targetId: string | null;
  targetType: string | null;
  read: boolean;
  createdAt: string;
  actor: {
    username: string;
    displayName: string;
    avatarUrl: string | null;
  };
}

interface NotificationState {
  items: NotificationItem[];
  unreadCount: number;
  cursor: string | null;
  setItems: (items: NotificationItem[], cursor: string | null) => void;
  appendItems: (items: NotificationItem[], cursor: string | null) => void;
  prependItem: (item: NotificationItem) => void;
  setUnreadCount: (count: number) => void;
  incrementUnread: () => void;
  clearUnread: () => void;
}

export const useNotificationStore = create<NotificationState>()((set) => ({
  items: [],
  unreadCount: 0,
  cursor: null,
  setItems: (items, cursor) => set({ items, cursor }),
  appendItems: (newItems, cursor) =>
    set((state) => ({
      items: [...state.items, ...newItems],
      cursor,
    })),
  prependItem: (item) =>
    set((state) => ({
      items: [item, ...state.items],
    })),
  setUnreadCount: (unreadCount) => set({ unreadCount }),
  incrementUnread: () =>
    set((state) => ({ unreadCount: state.unreadCount + 1 })),
  clearUnread: () => set({ unreadCount: 0 }),
}));
