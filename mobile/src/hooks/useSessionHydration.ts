import { useEffect } from 'react';
import { useSessionStore } from '../state/sessionStore';
import { loadSession } from '../services/storage/secureSession';
import { signOut } from '../services/session';

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
      .then(async (session) => {
        if (!session) {
          return;
        }
        if (session.status !== 'ACTIVE') {
          // Nothing else would ever clean this up: both route gates send a
          // non-ACTIVE session to Home, and useRevocationGuard only runs under
          // (app)/, which it never reaches. Drop the dead credential and keep
          // the reason so Home can explain why the device stopped working.
          await signOut(session.status);
          return;
        }
        setSession(session);
      })
      .catch(() => undefined)
      .finally(() => setHydrated(true));
  }, [setSession, setHydrated]);

  return hydrated;
}
