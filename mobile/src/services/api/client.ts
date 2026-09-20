import { useSessionStore } from '../../state/sessionStore';
import type { ApiErrorBody } from '../../types/api';

const DEFAULT_BASE_URL = 'http://localhost:3000';

export class ApiRequestError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string
  ) {
    super(message);
  }
}

function getBaseUrl(): string {
  return process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_BASE_URL;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const jwt = useSessionStore.getState().session?.jwt;
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (jwt) {
    headers.set('Authorization', `Bearer ${jwt}`);
  }

  const response = await fetch(`${getBaseUrl()}${path}`, { ...init, headers });

  if (response.status === 401) {
    useSessionStore.getState().clearSession();
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiRequestError(
      response.status,
      body?.error.code ?? 'UNKNOWN_ERROR',
      body?.error.message ?? `Request failed with status ${response.status}`
    );
  }

  return response.json() as Promise<T>;
}
