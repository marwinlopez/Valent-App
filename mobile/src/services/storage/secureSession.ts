import * as SecureStore from 'expo-secure-store';
import type { Session } from '../../state/sessionStore';

const SESSION_KEY = 'valent.session';

export async function saveSession(session: Session): Promise<void> {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
}

export async function loadSession(): Promise<Session | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  return raw ? (JSON.parse(raw) as Session) : null;
}

export async function deleteSession(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_KEY);
}
