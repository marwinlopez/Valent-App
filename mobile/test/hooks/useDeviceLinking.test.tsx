import { renderHook, waitFor, act } from '@testing-library/react-native';
import { useDeviceLinking } from '../../src/hooks/useDeviceLinking';
import { useSessionStore } from '../../src/state/sessionStore';
import { ApiRequestError } from '../../src/services/api/client';

jest.mock('../../src/services/api/auth', () => ({
  linkDevice: jest.fn(),
  readDeviceIdFromJwt: jest.fn(() => 'device-from-jwt'),
}));
jest.mock('../../src/services/device/hardwareId', () => ({
  getHardwareId: jest.fn(async () => 'hw-1'),
  getSuggestedDeviceName: jest.fn(() => 'Pixel 8'),
}));

import { linkDevice } from '../../src/services/api/auth';

const VALID_TOKEN = '11111111-2222-3333-4444-555555555555';

describe('useDeviceLinking', () => {
  beforeEach(() => {
    useSessionStore.getState().clearSession();
    jest.clearAllMocks();
  });

  it('starts idle with a suggested device name', async () => {
    const { result } = await renderHook(() => useDeviceLinking());
    expect(result.current.state).toBe('idle');
    expect(result.current.suggestedName).toBe('Pixel 8');
  });

  it('rejects a token that is not a UUID without calling the API', async () => {
    const { result } = await renderHook(() => useDeviceLinking());

    await act(async () => {
      await result.current.submitToken('not-a-uuid');
    });

    expect(linkDevice).not.toHaveBeenCalled();
    expect(result.current.state).toBe('error');
    expect(result.current.error).toMatch(/código/i);
  });

  it('moves to confirming after a valid token is accepted', async () => {
    const { result } = await renderHook(() => useDeviceLinking());

    await act(async () => {
      await result.current.submitToken(VALID_TOKEN);
    });

    expect(result.current.state).toBe('confirming');
  });

  it('signs in with the deviceId read from the JWT and an ACTIVE status', async () => {
    (linkDevice as jest.Mock).mockResolvedValue({ jwt: 'jwt-value', role: 'INVENTARIO', accountId: 'acc-1' });
    const { result } = await renderHook(() => useDeviceLinking());

    await act(async () => {
      await result.current.submitToken(VALID_TOKEN);
    });
    await act(async () => {
      await result.current.confirmName('Caja 1');
    });

    await waitFor(() => expect(useSessionStore.getState().session).not.toBeNull());
    expect(useSessionStore.getState().session).toEqual({
      deviceId: 'device-from-jwt',
      accountId: 'acc-1',
      role: 'INVENTARIO',
      status: 'ACTIVE',
      jwt: 'jwt-value',
    });
  });

  it.each([
    ['INVALID_INVITE_TOKEN', /inválido|usado|expirado/i],
    ['DEVICE_LIMIT_REACHED', /límite/i],
    ['DEVICE_REVOKED', /revocado/i],
  ])('maps the %s error code to a specific message', async (code, expected) => {
    (linkDevice as jest.Mock).mockRejectedValue(new ApiRequestError(422, code, 'backend message'));
    const { result } = await renderHook(() => useDeviceLinking());

    await act(async () => {
      await result.current.submitToken(VALID_TOKEN);
    });
    await act(async () => {
      await result.current.confirmName('Caja 1');
    });

    expect(result.current.state).toBe('error');
    expect(result.current.error).toMatch(expected);
  });
});
