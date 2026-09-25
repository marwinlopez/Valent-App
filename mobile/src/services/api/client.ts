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
 * Error bodies come from anywhere — a proxy's HTML page, an empty 502 — so a
 * parse failure must not escape as a SyntaxError that isn't an ApiRequestError.
 */
async function readErrorBody(response: Response): Promise<ApiErrorBody | null> {
  return response.json().then((body) => body as ApiErrorBody).catch(() => null);
}

/**
 * Success bodies must parse. A 204 is the only legitimate "no JSON" case;
 * anything else is a real protocol error the caller has to see as an
 * ApiRequestError rather than as a silent `null` typed as `T`.
 */
async function readSuccessBody<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return null as T;
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiRequestError(
      response.status,
      'INVALID_RESPONSE_BODY',
      'The server returned a response that was not valid JSON'
    );
  }
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
    // `.catch`: a failing storage delete must not replace the ApiRequestError
    // with a raw storage error for the one status callers most need to match.
    // Memory and cache are cleared synchronously inside signOut regardless.
    await signOut('EXPIRED').catch(() => undefined);
  }

  if (!response.ok) {
    const body = await readErrorBody(response);
    throw new ApiRequestError(
      response.status,
      body?.error?.code ?? 'UNKNOWN_ERROR',
      body?.error?.message ?? `Request failed with status ${response.status}`
    );
  }

  return readSuccessBody<T>(response);
}
