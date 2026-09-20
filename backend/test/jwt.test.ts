// backend/test/jwt.test.ts
import { describe, it, expect } from 'vitest';
import { signDeviceToken, verifyDeviceToken } from '../src/modules/auth/jwt';

describe('device tokens', () => {
  const secret = 'a'.repeat(20);

  it('round-trips a valid payload', () => {
    const token = signDeviceToken({ deviceId: 'd1', accountId: 'a1', role: 'ADMIN' }, secret);
    const payload = verifyDeviceToken(token, secret);
    expect(payload).toEqual({ deviceId: 'd1', accountId: 'a1', role: 'ADMIN' });
  });

  it('throws on a token signed with a different secret', () => {
    const token = signDeviceToken({ deviceId: 'd1', accountId: 'a1', role: 'ADMIN' }, secret);
    expect(() => verifyDeviceToken(token, 'b'.repeat(20))).toThrow();
  });

  it('throws on a malformed token', () => {
    expect(() => verifyDeviceToken('not-a-token', secret)).toThrow();
  });
});
