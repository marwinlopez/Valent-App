jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

import * as SecureStore from 'expo-secure-store';
import { saveSession, loadSession, deleteSession } from '../../../src/services/storage/secureSession';

describe('secureSession', () => {
  const session = {
    deviceId: 'd1',
    accountId: 'a1',
    role: 'ADMIN' as const,
    status: 'ACTIVE' as const,
    jwt: 'jwt-value',
  };

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
    const result = await loadSession();
    expect(result).toBeNull();
  });

  it('deleteSession removes the stored session', async () => {
    await deleteSession();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('valent.session');
  });
});
