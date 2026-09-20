jest.mock('react-native', () => ({ Platform: { OS: 'web' } }));
jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

import * as SecureStore from 'expo-secure-store';
import { setItem, getItem, deleteItem } from '../../../src/services/storage/secureStore';

describe('secureStore on web', () => {
  beforeEach(async () => {
    await deleteItem('k');
    (SecureStore.setItemAsync as jest.Mock).mockClear();
    (SecureStore.getItemAsync as jest.Mock).mockClear();
    (SecureStore.deleteItemAsync as jest.Mock).mockClear();
  });

  it('round-trips a value in memory without touching expo-secure-store', async () => {
    await setItem('k', 'v');

    expect(await getItem('k')).toBe('v');
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
  });

  it('returns null for a key that was never set', async () => {
    expect(await getItem('missing')).toBeNull();
  });

  it('deleteItem removes the in-memory value', async () => {
    await setItem('k', 'v');
    await deleteItem('k');

    expect(await getItem('k')).toBeNull();
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('does not write the value to any web storage', async () => {
    await setItem('valent.session', 'a-jwt-bearing-session');

    const globalWithStorage = globalThis as { localStorage?: Storage; sessionStorage?: Storage };
    expect(globalWithStorage.localStorage?.getItem('valent.session') ?? null).toBeNull();
    expect(globalWithStorage.sessionStorage?.getItem('valent.session') ?? null).toBeNull();
  });
});
