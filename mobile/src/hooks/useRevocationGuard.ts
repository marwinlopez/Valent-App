import { useEffect } from 'react';
import { useSession } from './useSession';
import { useAuthStatus } from './useAuthStatus';
import { signIn, signOut } from '../services/session';

/**
 * Keeps the persisted session in sync with what the backend says about this
 * device, from a single `GET /auth/me` result:
 *
 * - `status !== 'ACTIVE'` (revoked or still pending) → sign out completely.
 * - otherwise, if the returned `jwt`/`role`/`status` differ from what's
 *   stored, persist them. `GET /auth/me` re-mints the 30-day JWT on every call
 *   for an ACTIVE device — it IS the rolling-refresh mechanism, so a token
 *   that's never written back means a device used daily still hard-expires on
 *   day 30. The same write picks up an admin-initiated role change, which the
 *   tab shell reads from the stored `session.role`.
 */
export function useRevocationGuard(): void {
  const session = useSession();
  const { data: authStatus } = useAuthStatus();

  useEffect(() => {
    if (!authStatus) {
      return;
    }

    if (authStatus.status !== 'ACTIVE') {
      void signOut(authStatus.status).catch(() => undefined);
      return;
    }

    if (!session) {
      return;
    }

    if (authStatus.accountId !== session.accountId) {
      // A different tenant behind the same JWT is a re-link, not a refresh.
      // Query keys carry no accountId, so silently adopting it would render
      // the previous account's cached rows.
      void signOut('EXPIRED').catch(() => undefined);
      return;
    }

    const jwt = authStatus.jwt ?? session.jwt;
    if (jwt === session.jwt && authStatus.role === session.role && session.status === 'ACTIVE') {
      return;
    }

    void signIn({
      ...session,
      role: authStatus.role,
      status: authStatus.status,
      jwt,
    }).catch(() => undefined);
  }, [authStatus, session]);
}
