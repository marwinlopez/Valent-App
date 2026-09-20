import { useQuery } from '@tanstack/react-query';
import { getAuthMe } from '../services/api/auth';
import { useSessionStore } from '../state/sessionStore';

export function useAuthStatus() {
  const session = useSessionStore((state) => state.session);

  return useQuery({
    queryKey: ['auth', 'me', session?.deviceId],
    queryFn: getAuthMe,
    enabled: Boolean(session?.jwt),
    retry: false,
  });
}
