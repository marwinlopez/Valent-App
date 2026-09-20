import { create } from 'zustand';
import type { DeviceRole, DeviceStatus } from '../types/api';

export interface Session {
  deviceId: string;
  accountId: string;
  role: DeviceRole;
  status: DeviceStatus;
  jwt: string;
}

interface SessionState {
  session: Session | null;
  hydrated: boolean;
  setSession: (session: Session) => void;
  clearSession: () => void;
  setHydrated: (hydrated: boolean) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  session: null,
  hydrated: false,
  setSession: (session) => set({ session }),
  clearSession: () => set({ session: null }),
  setHydrated: (hydrated) => set({ hydrated }),
}));
