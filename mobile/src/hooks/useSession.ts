import { useSessionStore } from '../state/sessionStore';

export function useSession() {
  return useSessionStore((state) => state.session);
}
