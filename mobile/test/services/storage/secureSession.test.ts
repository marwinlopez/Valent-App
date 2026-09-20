jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

import * as SecureStore from 'expo-secure-store';
import {
  saveSession,
  loadSession,
  deleteSession,
  isValidSession,
} from '../../../src/services/storage/secureSession';

describe('secureSession', () => {
  const session = {
    deviceId: 'd1',
    accountId: 'a1',
    role: 'ADMIN' as const,
    status: 'ACTIVE' as const,
    jwt: 'jwt-value',
  };

  beforeEach(() => {
    (SecureStore.setItemAsync as jest.Mock).mockReset().mockResolvedValue(undefined);
    (SecureStore.getItemAsync as jest.Mock).mockReset().mockResolvedValue(null);
    (SecureStore.deleteItemAsync as jest.Mock).mockReset().mockResolvedValue(undefined);
  });

  it('saveSession stores the session as JSON', async () => {
    await saveSession(session);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('valent.session', JSON.stringify(session));
  });

  it('loadSession parses a stored session', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(JSON.stringify(session));
    const result = await loadSession();
    expect(result).toEqual(session);
  });

  it('loadSession returns null when nothing is stored', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
    expect(await loadSession()).toBeNull();
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('deleteSession removes the stored session', async () => {
    await deleteSession();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('valent.session');
  });

  it('loadSession returns null and deletes the entry when the stored JSON is malformed', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('{"deviceId":"d1","accou');

    expect(await loadSession()).toBeNull();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('valent.session');
  });

  it('loadSession returns null instead of throwing when SecureStore rejects', async () => {
    // e.g. the OS invalidated the key because biometric enrollment changed.
    (SecureStore.getItemAsync as jest.Mock).mockRejectedValue(
      new Error('Could not decrypt the value for key')
    );

    await expect(loadSession()).resolves.toBeNull();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('valent.session');
  });

  it('loadSession rejects a stored session with an unknown role', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(
      JSON.stringify({ ...session, role: 'SUPER_ADMIN' })
    );

    expect(await loadSession()).toBeNull();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('valent.session');
  });

  it('loadSession rejects a stored session with an unknown status', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(
      JSON.stringify({ ...session, status: 'SUSPENDED' })
    );

    expect(await loadSession()).toBeNull();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('valent.session');
  });

  it('loadSession rejects a truncated stored session that is missing fields', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(
      JSON.stringify({ deviceId: 'd1', role: 'ADMIN' })
    );

    expect(await loadSession()).toBeNull();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('valent.session');
  });

  it('loadSession does not throw when deleting the bad entry also fails', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('not json');
    (SecureStore.deleteItemAsync as jest.Mock).mockRejectedValue(new Error('keychain locked'));

    await expect(loadSession()).resolves.toBeNull();
  });
});

describe('isValidSession', () => {
  const valid = {
    deviceId: 'd1',
    accountId: 'a1',
    role: 'INVENTARIO',
    status: 'PENDING',
    jwt: 'jwt-value',
  };

  it('accepts every known role', () => {
    for (const role of ['ADMIN', 'INVENTARIO', 'POST_VENTA', 'CLIENTE_PEDIDOS']) {
      expect(isValidSession({ ...valid, role })).toBe(true);
    }
  });

  it('accepts every known status', () => {
    for (const status of ['PENDING', 'ACTIVE', 'REVOKED']) {
      expect(isValidSession({ ...valid, status })).toBe(true);
    }
  });

  it('rejects non-objects, wrong field types, and empty strings', () => {
    expect(isValidSession(null)).toBe(false);
    expect(isValidSession('a string')).toBe(false);
    expect(isValidSession([])).toBe(false);
    expect(isValidSession({ ...valid, jwt: '' })).toBe(false);
    expect(isValidSession({ ...valid, deviceId: 42 })).toBe(false);
    expect(isValidSession({ ...valid, accountId: null })).toBe(false);
  });
});
