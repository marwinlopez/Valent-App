jest.mock('../../../src/services/api/client', () => ({
  apiFetch: jest.fn(),
}));

import { apiFetch } from '../../../src/services/api/client';
import { getAuthMe, readDeviceIdFromJwt } from '../../../src/services/api/auth';

function makeJwt(payload: unknown): string {
  const encode = (value: string) =>
    btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${encode('{"alg":"HS256"}')}.${encode(JSON.stringify(payload))}.signature`;
}

describe('getAuthMe', () => {
  beforeEach(() => {
    (apiFetch as jest.Mock).mockReset();
  });

  it('calls GET /auth/me through the api client', async () => {
    (apiFetch as jest.Mock).mockResolvedValue({ role: 'ADMIN', status: 'ACTIVE', accountId: 'a1' });

    await expect(getAuthMe()).resolves.toEqual({
      role: 'ADMIN',
      status: 'ACTIVE',
      accountId: 'a1',
    });
    expect(apiFetch).toHaveBeenCalledWith('/auth/me');
  });
});

describe('readDeviceIdFromJwt', () => {
  it('reads the deviceId claim from a well-formed token', () => {
    const jwt = makeJwt({ deviceId: 'device-42', accountId: 'a1', role: 'ADMIN' });
    expect(readDeviceIdFromJwt(jwt)).toBe('device-42');
  });

  it('decodes a payload whose base64url needs padding and substitution', () => {
    // 'a'.repeat(n) tuned so the payload segment is not a multiple of 4 chars.
    const jwt = makeJwt({ deviceId: 'd', accountId: 'aaa', role: 'INVENTARIO' });
    expect(readDeviceIdFromJwt(jwt)).toBe('d');
  });

  it('returns null when the token does not have three segments', () => {
    expect(readDeviceIdFromJwt('not-a-jwt')).toBeNull();
    expect(readDeviceIdFromJwt('')).toBeNull();
  });

  it('returns null when the payload is not decodable JSON', () => {
    expect(readDeviceIdFromJwt('header.!!!not-base64!!!.signature')).toBeNull();
  });

  it('returns null when the payload carries no usable deviceId', () => {
    expect(readDeviceIdFromJwt(makeJwt({ accountId: 'a1' }))).toBeNull();
    expect(readDeviceIdFromJwt(makeJwt({ deviceId: '' }))).toBeNull();
    expect(readDeviceIdFromJwt(makeJwt({ deviceId: 42 }))).toBeNull();
    expect(readDeviceIdFromJwt(makeJwt('a string payload'))).toBeNull();
  });
});
