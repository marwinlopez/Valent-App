import { useSessionStore, type Session } from '../state/sessionStore';
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
  useSessionStore.getState().setSession(session);
  await saveSession(session);
}

/**
 * Tears a session down completely: memory, disk, and the server-state cache.
 *
 * The cache clear is not optional — query keys carry no `accountId`, so cached
 * rows from the previous account would otherwise be rendered on first paint
 * after the device is re-linked to a different one.
 */
export async function signOut(): Promise<void> {
  useSessionStore.getState().clearSession();
  queryClient.clear();
  await deleteSession();
}
