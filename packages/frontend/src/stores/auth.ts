import { create } from "zustand";
import { persist } from "zustand/middleware";
import { clearKeystore } from "@/crypto/keystore";

interface AuthUser {
  id: string;
  username: string;
  actorType: string;
  actorUri: string;
}

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  /** Transient: decrypted identity private key (not persisted). */
  encryptionKey: CryptoKey | null;
  setAuth: (user: AuthUser, token: string) => void;
  setEncryptionKey: (key: CryptoKey | null) => void;
  logout: () => void;
  isAuthenticated: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      encryptionKey: null,
      setAuth: (user, token) => set({ user, token }),
      setEncryptionKey: (key) => set({ encryptionKey: key }),
      logout: () => {
        clearKeystore().catch(() => {});
        set({ user: null, token: null, encryptionKey: null });
      },
      isAuthenticated: () => !!get().token,
    }),
    {
      name: "fediplus-auth",
      partialize: (state) => ({
        user: state.user,
        token: state.token,
      }),
    }
  )
);
