jest.mock('../../src/services/storage/secureSession', () => ({
  loadSession: jest.fn(),
  deleteSession: jest.fn(),
}));

import { renderHook, waitFor } from '@testing-library/react-native';
import { useSessionHydration } from '../../src/hooks/useSessionHydration';
import { loadSession, deleteSession } from '../../src/services/storage/secureSession';
import { useSessionStore, type Session } from '../../src/state/sessionStore';

const stored: Session = {
  deviceId: 'd1',
  accountId: 'a1',
  role: 'ADMIN',
  status: 'ACTIVE',
  jwt: 'jwt-value',
};

describe('useSessionHydration', () => {
  beforeEach(() => {
    useSessionStore.setState({ session: null, hydrated: false, endedReason: null });
    (loadSession as jest.Mock).mockReset();
    (deleteSession as jest.Mock).mockReset().mockResolvedValue(undefined);
  });

  it('puts a stored session into the store and reports hydrated', async () => {
    (loadSession as jest.Mock).mockResolvedValue(stored);

    const { result } = await renderHook(() => useSessionHydration());

    await waitFor(() => expect(result.current).toBe(true));
    expect(useSessionStore.getState().session).toEqual(stored);
  });

  it('reports hydrated with no session when nothing is stored', async () => {
    (loadSession as jest.Mock).mockResolvedValue(null);

    const { result } = await renderHook(() => useSessionHydration());

    await waitFor(() => expect(result.current).toBe(true));
    expect(useSessionStore.getState().session).toBeNull();
  });

  it('still reports hydrated when loading the session rejects', async () => {
    // Without this, the root layout's `if (!hydrated) return null` gate would
    // hold forever: a blank app, no crash, no recovery on restart.
    (loadSession as jest.Mock).mockRejectedValue(new Error('secure store unavailable'));

    const { result } = await renderHook(() => useSessionHydration());

    await waitFor(() => expect(result.current).toBe(true));
    expect(useSessionStore.getState().session).toBeNull();
  });

  it('reads storage once, not on every render', async () => {
    (loadSession as jest.Mock).mockResolvedValue(null);

    const { result, rerender } = await renderHook(() => useSessionHydration());
    await waitFor(() => expect(result.current).toBe(true));
    rerender({});

    expect(loadSession).toHaveBeenCalledTimes(1);
  });

  it('deletes a stored non-ACTIVE session instead of adopting it, and records why', async () => {
    (loadSession as jest.Mock).mockResolvedValue({
      deviceId: 'd1',
      accountId: 'a1',
      role: 'ADMIN',
      status: 'REVOKED',
      jwt: 'jwt',
    });

    await renderHook(() => useSessionHydration());

    await waitFor(() => expect(useSessionStore.getState().hydrated).toBe(true));
    expect(useSessionStore.getState().session).toBeNull();
    expect(useSessionStore.getState().endedReason).toBe('REVOKED');
    expect(deleteSession).toHaveBeenCalled();
  });
});
