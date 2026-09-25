jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

import * as SecureStore from 'expo-secure-store';
import { signIn, signOut } from '../../src/services/session';
import { useSessionStore, type Session } from '../../src/state/sessionStore';
import { queryClient } from '../../src/services/queryClient';

const session: Session = {
  deviceId: 'd1',
  accountId: 'a1',
  role: 'ADMIN',
  status: 'ACTIVE',
  jwt: 'jwt-value',
};

describe('session service', () => {
  beforeEach(() => {
    useSessionStore.getState().clearSession();
    queryClient.clear();
    (SecureStore.setItemAsync as jest.Mock).mockReset().mockResolvedValue(undefined);
    (SecureStore.deleteItemAsync as jest.Mock).mockReset().mockResolvedValue(undefined);
  });

  it('signIn writes the session to memory and to secure storage', async () => {
    await signIn(session);

    expect(useSessionStore.getState().session).toEqual(session);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'valent.session',
      JSON.stringify(session)
    );
  });

  it('signOut clears memory, deletes storage, and empties the query cache', async () => {
    await signIn(session);
    queryClient.setQueryData(['products'], [{ barcode: '123' }]);

    await signOut();

    expect(useSessionStore.getState().session).toBeNull();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('valent.session');
    expect(queryClient.getQueryData(['products'])).toBeUndefined();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it('signOut clears memory before the storage delete resolves', async () => {
    await signIn(session);
    let resolveDelete: () => void = () => undefined;
    (SecureStore.deleteItemAsync as jest.Mock).mockReturnValue(
      new Promise<void>((resolve) => {
        resolveDelete = resolve;
      })
    );

    const pending = signOut();
    expect(useSessionStore.getState().session).toBeNull();

    resolveDelete();
    await pending;
  });

  it('signOut records the reason the session ended', async () => {
    await signOut('REVOKED');
    expect(useSessionStore.getState().endedReason).toBe('REVOKED');
  });

  it('signIn clears any previous ended-reason', async () => {
    await signOut('EXPIRED');
    await signIn({ deviceId: 'd1', accountId: 'a1', role: 'ADMIN', status: 'ACTIVE', jwt: 'j' });
    expect(useSessionStore.getState().endedReason).toBeNull();
  });
});
