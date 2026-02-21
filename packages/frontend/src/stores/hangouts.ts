import { create } from "zustand";

interface HangoutParticipant {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  isMuted: boolean;
  isCameraOff: boolean;
  isScreenSharing: boolean;
}

interface Hangout {
  id: string;
  name: string | null;
  visibility: "public" | "private";
  status: "waiting" | "active" | "ended";
  createdById: string;
  maxParticipants: number;
  rtmpActive: boolean;
  participants: HangoutParticipant[];
  creator?: {
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  } | null;
}

interface HangoutState {
  activeHangouts: Hangout[];
  currentHangout: Hangout | null;
  localStream: MediaStream | null;
  remoteStreams: Map<string, MediaStream>;
  isConnected: boolean;
  isMuted: boolean;
  isCameraOff: boolean;
  isScreenSharing: boolean;

  setActiveHangouts: (hangouts: Hangout[]) => void;
  setCurrentHangout: (hangout: Hangout | null) => void;
  addParticipant: (participant: HangoutParticipant) => void;
  removeParticipant: (userId: string) => void;
  updateParticipantMedia: (
    userId: string,
    state: Partial<Pick<HangoutParticipant, "isMuted" | "isCameraOff" | "isScreenSharing">>
  ) => void;
  setLocalStream: (stream: MediaStream | null) => void;
  addRemoteStream: (userId: string, stream: MediaStream) => void;
  removeRemoteStream: (userId: string) => void;
  setConnected: (connected: boolean) => void;
  setMuted: (muted: boolean) => void;
  setCameraOff: (off: boolean) => void;
  setScreenSharing: (sharing: boolean) => void;
  reset: () => void;
}

export const useHangoutStore = create<HangoutState>()((set) => ({
  activeHangouts: [],
  currentHangout: null,
  localStream: null,
  remoteStreams: new Map(),
  isConnected: false,
  isMuted: false,
  isCameraOff: false,
  isScreenSharing: false,

  setActiveHangouts: (hangouts) => set({ activeHangouts: hangouts }),

  setCurrentHangout: (hangout) => set({ currentHangout: hangout }),

  addParticipant: (participant) =>
    set((state) => {
      if (!state.currentHangout) return state;
      const exists = state.currentHangout.participants.some(
        (p) => p.userId === participant.userId
      );
      if (exists) return state;
      return {
        currentHangout: {
          ...state.currentHangout,
          participants: [...state.currentHangout.participants, participant],
        },
      };
    }),

  removeParticipant: (userId) =>
    set((state) => {
      if (!state.currentHangout) return state;
      return {
        currentHangout: {
          ...state.currentHangout,
          participants: state.currentHangout.participants.filter(
            (p) => p.userId !== userId
          ),
        },
      };
    }),

  updateParticipantMedia: (userId, mediaState) =>
    set((state) => {
      if (!state.currentHangout) return state;
      return {
        currentHangout: {
          ...state.currentHangout,
          participants: state.currentHangout.participants.map((p) =>
            p.userId === userId ? { ...p, ...mediaState } : p
          ),
        },
      };
    }),

  setLocalStream: (stream) => set({ localStream: stream }),

  addRemoteStream: (userId, stream) =>
    set((state) => {
      const newMap = new Map(state.remoteStreams);
      newMap.set(userId, stream);
      return { remoteStreams: newMap };
    }),

  removeRemoteStream: (userId) =>
    set((state) => {
      const newMap = new Map(state.remoteStreams);
      newMap.delete(userId);
      return { remoteStreams: newMap };
    }),

  setConnected: (connected) => set({ isConnected: connected }),
  setMuted: (muted) => set({ isMuted: muted }),
  setCameraOff: (off) => set({ isCameraOff: off }),
  setScreenSharing: (sharing) => set({ isScreenSharing: sharing }),

  reset: () =>
    set({
      currentHangout: null,
      localStream: null,
      remoteStreams: new Map(),
      isConnected: false,
      isMuted: false,
      isCameraOff: false,
      isScreenSharing: false,
    }),
}));
