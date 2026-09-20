import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Platform adapter over `expo-secure-store`.
 *
 * `expo-secure-store` has no web implementation (its web build is an empty
 * module), so calling `SecureStore.getItemAsync` on web throws. Web is a
 * development/verification target for this app, never a shipping platform
 * (see `mobile/AGENTS.md`), so the web branch is an **in-memory** shim.
 *
 * In-memory — deliberately not `localStorage`/`sessionStorage`: the JWT is a
 * 30-day bearer token and the spec forbids persisting it anywhere unencrypted.
 * An in-memory map satisfies that constraint by construction. The only thing
 * web loses is session survival across a page reload, which is acceptable for
 * a dev-only target.
 */
const memoryStore = new Map<string, string>();

function isWeb(): boolean {
  return Platform.OS === 'web';
}

export async function setItem(key: string, value: string): Promise<void> {
  if (isWeb()) {
    memoryStore.set(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function getItem(key: string): Promise<string | null> {
  if (isWeb()) {
    return memoryStore.get(key) ?? null;
  }
  return SecureStore.getItemAsync(key);
}

export async function deleteItem(key: string): Promise<void> {
  if (isWeb()) {
    memoryStore.delete(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}
