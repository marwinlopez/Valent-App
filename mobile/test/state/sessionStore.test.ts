import { useSessionStore } from '../../src/state/sessionStore';

describe('useSessionStore', () => {
  beforeEach(() => {
    useSessionStore.getState().clearSession();
  });

  it('starts with no session', () => {
    expect(useSessionStore.getState().session).toBeNull();
  });

  it('setSession stores the session', () => {
    useSessionStore.getState().setSession({
      deviceId: 'd1',
      accountId: 'a1',
      role: 'ADMIN',
      status: 'ACTIVE',
      jwt: 'jwt',
    });
    expect(useSessionStore.getState().session?.role).toBe('ADMIN');
  });

  it('clearSession removes the session', () => {
    useSessionStore.getState().setSession({
      deviceId: 'd1',
      accountId: 'a1',
      role: 'ADMIN',
      status: 'ACTIVE',
      jwt: 'jwt',
    });
    useSessionStore.getState().clearSession();
    expect(useSessionStore.getState().session).toBeNull();
  });
});
