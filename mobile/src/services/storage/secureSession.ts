import { setItem, getItem, deleteItem } from './secureStore';
import type { Session } from '../../state/sessionStore';
import type { DeviceRole, DeviceStatus } from '../../types/api';

const SESSION_KEY = 'valent.session';

const DEVICE_ROLES: readonly DeviceRole[] = ['ADMIN', 'INVENTARIO', 'POST_VENTA', 'CLIENTE_PEDIDOS'];
const DEVICE_STATUSES: readonly DeviceStatus[] = ['PENDING', 'ACTIVE', 'REVOKED'];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Validates a value parsed out of secure storage before it is trusted as a
 * `Session`. A stored blob can be stale (written by an older app version), so
 * every field is checked — including `role`/`status` being values this build
 * actually knows about. An unknown `role` would otherwise reach the tab shell's
 * `TABS_BY_ROLE[role]` lookup and throw on every launch.
 */
export function isValidSession(parsed: unknown): parsed is Session {
  if (typeof parsed !== 'object' || parsed === null) {
    return false;
  }
  const candidate = parsed as Record<string, unknown>;
  return (
    isNonEmptyString(candidate.deviceId) &&
    isNonEmptyString(candidate.accountId) &&
    isNonEmptyString(candidate.jwt) &&
    isNonEmptyString(candidate.role) &&
    DEVICE_ROLES.includes(candidate.role as DeviceRole) &&
    isNonEmptyString(candidate.status) &&
    DEVICE_STATUSES.includes(candidate.status as DeviceStatus)
  );
}

export async function saveSession(session: Session): Promise<void> {
  await setItem(SESSION_KEY, JSON.stringify(session));
}

/**
 * Reads the persisted session. Never throws: a read failure or an unreadable
 * stored value resolves to `null`.
 *
 * Failure is a normal, expected path here — `expo-secure-store` invalidates
 * stored keys when the device's biometric enrollment changes, the stored blob
 * can be truncated, and the value can be from an incompatible older build. When
 * the stored value is unusable it is deleted, so a single bad entry cannot
 * brick every future launch.
 */
export async function loadSession(): Promise<Session | null> {
  let raw: string | null;
  try {
    raw = await getItem(SESSION_KEY);
  } catch {
    await deleteSession().catch(() => undefined);
    return null;
  }

  if (raw === null) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    await deleteSession().catch(() => undefined);
    return null;
  }

  if (!isValidSession(parsed)) {
    await deleteSession().catch(() => undefined);
    return null;
  }

  return parsed;
}

export async function deleteSession(): Promise<void> {
  await deleteItem(SESSION_KEY);
}
