import { useSessionStore, type Session, type SessionEndReason } from '../state/sessionStore';
import { saveSession, deleteSession } from './storage/secureSession';
import { queryClient } from './queryClient';

/**
 * Establishes a session: in memory (Zustand) and on disk (secure storage).
 *
 * Always use this instead of calling `setSession`/`saveSession` separately —
 * a session written to only one of the two either evaporates on restart or
 * outlives the running app.
 */
export async function signIn(session: Session): Promise<void> {
  // Disk first. If this throws, nothing was written to memory either, so the
  // two can't disagree — the app stays cleanly signed out and the caller shows
  // a retryable error, instead of being signed in in memory with nothing on
  // disk (which looks fine until the next launch, when it silently unlinks).
  await saveSession(session);
  useSessionStore.getState().setSession(session);
  // A fresh sign-in must not leave a stale "your device was revoked" banner up.
  useSessionStore.getState().setEndedReason(null);
}

/**
 * Tears a session down completely: memory, disk, and the server-state cache.
 *
 * The cache clear is not optional — query keys carry no `accountId`, so cached
 * rows from the previous account would otherwise be rendered on first paint
 * after the device is re-linked to a different one.
 *
 * `reason`, when given, records why the session ended so Home can explain it.
 */
export async function signOut(reason?: SessionEndReason): Promise<void> {
  useSessionStore.getState().clearSession();
  // First reason wins: a revoked device's other in-flight queries all 401 and
  // would otherwise overwrite the accurate banner with the generic "expiró".
  if (reason && !useSessionStore.getState().endedReason) {
    useSessionStore.getState().setEndedReason(reason);
  }
  queryClient.clear();
  await deleteSession();
}
