import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../services/api/client';
import { useSessionStore } from '../state/sessionStore';
import type { AuthMeResponse } from '../types/api';

export function useAuthStatus() {
  const session = useSessionStore((state) => state.session);

  return useQuery({
    queryKey: ['auth', 'me', session?.deviceId],
    queryFn: () => apiFetch<AuthMeResponse>('/auth/me'),
    enabled: Boolean(session?.jwt),
    retry: false,
  });
}
