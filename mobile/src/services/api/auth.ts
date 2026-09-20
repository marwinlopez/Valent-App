import { apiFetch } from './client';
import type { AuthMeResponse } from '../../types/api';

/**
 * `GET /auth/me` — the device's current `role`/`status`, plus a freshly minted
 * JWT for an ACTIVE device (this endpoint IS the rolling-refresh mechanism;
 * see `useRevocationGuard`, which writes the refreshed token back).
 *
 * This module is the endpoint layer the spec describes: hooks call these
 * functions, these functions call `apiFetch`. Later `/auth/*` calls
 * (`POST /auth/link-device`, sub-project 2) belong here too.
 */
export async function getAuthMe(): Promise<AuthMeResponse> {
  return apiFetch<AuthMeResponse>('/auth/me');
}

function base64UrlToString(segment: string): string {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  return atob(padded);
}

/**
 * Reads the `deviceId` claim out of a device JWT's payload.
 *
 * IMPORTANT — the decoded payload is an UNTRUSTED LOCAL HINT ONLY. The
 * signature is not (and cannot be) verified on the client, so this value is
 * used solely as a local identifier / query-cache key. It is NEVER used for
 * an authorization decision: all authorization is enforced server-side by the
 * backend's `requireAuth`/`requireRole`. Do not read any other claim from here
 * — `role`, `accountId` and `status` come from the API's responses, not from
 * this decode.
 *
 * It exists because no backend response carries the `deviceId`:
 * `POST /auth/link-device` returns `{ jwt, role, accountId }` and
 * `GET /auth/me` returns `{ role, status, accountId, jwt? }`.
 *
 * Returns `null` for anything that isn't a JWT with a decodable JSON payload
 * carrying a non-empty string `deviceId`.
 */
export function readDeviceIdFromJwt(jwt: string): string | null {
  const segments = jwt.split('.');
  if (segments.length !== 3) {
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(base64UrlToString(segments[1]));
  } catch {
    return null;
  }

  if (typeof payload !== 'object' || payload === null) {
    return null;
  }

  const deviceId = (payload as Record<string, unknown>).deviceId;
  return typeof deviceId === 'string' && deviceId.length > 0 ? deviceId : null;
}
