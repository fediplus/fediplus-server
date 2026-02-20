import { create } from "zustand";

export interface EventItem {
  id: string;
  name: string;
  description: string;
  location: string | null;
  startDate: string;
  endDate: string | null;
  coverUrl: string | null;
  visibility: "public" | "private";
  partyMode: boolean;
  createdById: string;
  apId: string | null;
  createdAt: string;
  updatedAt: string;
  myRsvp?: string | null;
  creator?: {
    username: string;
    displayName: string;
    avatarUrl: string | null;
  } | null;
  rsvpCounts?: {
    going: number;
    maybe: number;
    not_going: number;
  };
}

interface EventState {
  items: EventItem[];
  cursor: string | null;
  loading: boolean;
  setItems: (items: EventItem[], cursor: string | null) => void;
  appendItems: (items: EventItem[], cursor: string | null) => void;
  prependItem: (item: EventItem) => void;
  setLoading: (loading: boolean) => void;
}

export const useEventStore = create<EventState>()((set) => ({
  items: [],
  cursor: null,
  loading: false,
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
  setLoading: (loading) => set({ loading }),
}));
