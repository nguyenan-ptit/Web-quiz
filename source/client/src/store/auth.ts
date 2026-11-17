import { create } from 'zustand';
import type { User } from '../types';
import { authApi, getToken } from '../mock/api';

interface AuthState {
  user: User | null;
  token: string | null;
  ready: boolean;
  init: () => Promise<void>;
  setSession: (token: string, user: User) => void;
  setUser: (user: User) => void;
  clear: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  token: null,
  ready: false,
  async init() {
    const token = getToken();
    if (!token) return set({ ready: true });
    try {
      const user = await authApi.me();
      set({ user, token, ready: true });
    } catch {
      await authApi.logout();
      set({ user: null, token: null, ready: true });
    }
  },
  setSession: (token, user) => set({ token, user }),
  setUser: (user) => set({ user }),
  clear: () => set({ user: null, token: null }),
}));
