jest.mock('../../src/hooks/useAuthStatus', () => ({
  useAuthStatus: jest.fn(),
}));
jest.mock('../../src/services/session', () => ({
  signIn: jest.fn(),
  signOut: jest.fn(),
}));

import { renderHook, waitFor } from '@testing-library/react-native';
import { useRevocationGuard } from '../../src/hooks/useRevocationGuard';
import { useAuthStatus } from '../../src/hooks/useAuthStatus';
import { signIn, signOut } from '../../src/services/session';
import { useSessionStore, type Session } from '../../src/state/sessionStore';
import type { AuthMeResponse } from '../../src/types/api';

const stored: Session = {
  deviceId: 'd1',
  accountId: 'a1',
  role: 'ADMIN',
  status: 'ACTIVE',
  jwt: 'old-jwt',
};

function mockAuthStatus(data: AuthMeResponse | undefined) {
  (useAuthStatus as jest.Mock).mockReturnValue({ data });
}

describe('useRevocationGuard', () => {
  beforeEach(() => {
    useSessionStore.setState({ session: stored, hydrated: true });
    (signIn as jest.Mock).mockReset().mockResolvedValue(undefined);
    (signOut as jest.Mock).mockReset().mockResolvedValue(undefined);
    (useAuthStatus as jest.Mock).mockReset();
  });

  it('does nothing while /auth/me has not answered', async () => {
    mockAuthStatus(undefined);

    await renderHook(() => useRevocationGuard());

    expect(signOut).not.toHaveBeenCalled();
    expect(signIn).not.toHaveBeenCalled();
  });

  it('signs out when the device is REVOKED', async () => {
    mockAuthStatus({ role: 'ADMIN', status: 'REVOKED', accountId: 'a1' });

    await renderHook(() => useRevocationGuard());

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    expect(signIn).not.toHaveBeenCalled();
  });

  it('signs out when the device is only PENDING', async () => {
    mockAuthStatus({ role: 'ADMIN', status: 'PENDING', accountId: 'a1' });

    await renderHook(() => useRevocationGuard());

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });

  it('persists the refreshed jwt returned by /auth/me', async () => {
    mockAuthStatus({ role: 'ADMIN', status: 'ACTIVE', accountId: 'a1', jwt: 'fresh-jwt' });

    await renderHook(() => useRevocationGuard());

    await waitFor(() => expect(signIn).toHaveBeenCalledTimes(1));
    expect(signIn).toHaveBeenCalledWith({ ...stored, jwt: 'fresh-jwt' });
    expect(signOut).not.toHaveBeenCalled();
  });

  it('persists an admin-initiated role change', async () => {
    mockAuthStatus({ role: 'INVENTARIO', status: 'ACTIVE', accountId: 'a1' });

    await renderHook(() => useRevocationGuard());

    await waitFor(() => expect(signIn).toHaveBeenCalledTimes(1));
    expect(signIn).toHaveBeenCalledWith({ ...stored, role: 'INVENTARIO', jwt: 'old-jwt' });
  });

  it('promotes a stored PENDING session once the device is ACTIVE', async () => {
    const pending: Session = { ...stored, status: 'PENDING' };
    useSessionStore.setState({ session: pending, hydrated: true });
    mockAuthStatus({ role: 'ADMIN', status: 'ACTIVE', accountId: 'a1' });

    await renderHook(() => useRevocationGuard());

    await waitFor(() => expect(signIn).toHaveBeenCalledTimes(1));
    expect(signIn).toHaveBeenCalledWith({ ...pending, status: 'ACTIVE' });
  });

  it('writes nothing when the response matches the stored session', async () => {
    mockAuthStatus({ role: 'ADMIN', status: 'ACTIVE', accountId: 'a1', jwt: 'old-jwt' });

    await renderHook(() => useRevocationGuard());

    expect(signIn).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it('writes nothing when there is no session to update', async () => {
    useSessionStore.setState({ session: null, hydrated: true });
    mockAuthStatus({ role: 'ADMIN', status: 'ACTIVE', accountId: 'a1', jwt: 'fresh-jwt' });

    await renderHook(() => useRevocationGuard());

    expect(signIn).not.toHaveBeenCalled();
  });
});
