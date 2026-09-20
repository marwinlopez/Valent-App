import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStatus } from '../../src/hooks/useAuthStatus';
import { useSessionStore } from '../../src/state/sessionStore';

jest.mock('../../src/services/api/client', () => ({
  apiFetch: jest.fn(),
}));
import { apiFetch } from '../../src/services/api/client';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useAuthStatus', () => {
  beforeEach(() => {
    useSessionStore.getState().clearSession();
    (apiFetch as jest.Mock).mockReset();
  });

  it('is disabled when there is no session', async () => {
    const { result } = await renderHook(() => useAuthStatus(), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('fetches /auth/me when a session with a jwt exists', async () => {
    useSessionStore.getState().setSession({
      deviceId: 'd1',
      accountId: 'a1',
      role: 'ADMIN',
      status: 'ACTIVE',
      jwt: 'jwt',
    });
    (apiFetch as jest.Mock).mockResolvedValue({ role: 'ADMIN', status: 'ACTIVE', accountId: 'a1' });

    const { result } = await renderHook(() => useAuthStatus(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.status).toBe('ACTIVE');
    expect(apiFetch).toHaveBeenCalledWith('/auth/me');
  });
});
