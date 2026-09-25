import { create } from 'zustand';
import type { DeviceRole, DeviceStatus } from '../types/api';

export interface Session {
  deviceId: string;
  accountId: string;
  role: DeviceRole;
  status: DeviceStatus;
  jwt: string;
}

export type SessionEndReason = 'REVOKED' | 'PENDING' | 'EXPIRED';

interface SessionState {
  session: Session | null;
  hydrated: boolean;
  endedReason: SessionEndReason | null;
  setSession: (session: Session) => void;
  clearSession: () => void;
  setHydrated: (hydrated: boolean) => void;
  setEndedReason: (reason: SessionEndReason | null) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  session: null,
  hydrated: false,
  endedReason: null,
  setSession: (session) => set({ session }),
  clearSession: () => set({ session: null }),
  setHydrated: (hydrated) => set({ hydrated }),
  setEndedReason: (endedReason) => set({ endedReason }),
}));
