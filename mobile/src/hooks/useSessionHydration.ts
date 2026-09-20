import { useEffect } from 'react';
import { useSessionStore } from '../state/sessionStore';
import { loadSession } from '../services/storage/secureSession';

/**
 * Hydrates the session store from secure storage once, at app start.
 *
 * Returns whether hydration has finished. It ALWAYS finishes, even when the
 * read fails: the root layout renders nothing until it does, so a rejected
 * hydration that never flipped this flag would leave a permanently blank app
 * with no error and no way to recover across restarts.
 */
export function useSessionHydration(): boolean {
  const setSession = useSessionStore((state) => state.setSession);
  const setHydrated = useSessionStore((state) => state.setHydrated);
  const hydrated = useSessionStore((state) => state.hydrated);

  useEffect(() => {
    loadSession()
      .then((session) => {
        if (session) {
          setSession(session);
        }
      })
      .catch(() => undefined)
      .finally(() => setHydrated(true));
  }, [setSession, setHydrated]);

  return hydrated;
}
