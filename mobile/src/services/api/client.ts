import { useSessionStore } from '../../state/sessionStore';
import { signOut } from '../session';
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

/**
 * Parses a JSON body, tolerating one that isn't there or isn't JSON — a 204,
 * or an intermediary's HTML error page. `response.json()` rejects with a
 * `SyntaxError` in those cases, which is not an `ApiRequestError` and would
 * escape every caller's error handling.
 */
async function readJsonBody(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const jwt = useSessionStore.getState().session?.jwt;
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (jwt) {
    headers.set('Authorization', `Bearer ${jwt}`);
  }

  const response = await fetch(`${getBaseUrl()}${path}`, { ...init, headers });

  if (response.status === 401) {
    // The JWT is dead: drop it from memory AND from disk, and clear the
    // server-state cache. No navigation call here — the route gates react to
    // the now-empty session store (the client stays a pure data layer).
    await signOut();
  }

  if (!response.ok) {
    const body = (await readJsonBody(response)) as ApiErrorBody | null;
    throw new ApiRequestError(
      response.status,
      body?.error?.code ?? 'UNKNOWN_ERROR',
      body?.error?.message ?? `Request failed with status ${response.status}`
    );
  }

  return (await readJsonBody(response)) as T;
}
