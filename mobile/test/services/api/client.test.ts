jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

import * as SecureStore from 'expo-secure-store';
import { apiFetch, ApiRequestError } from '../../../src/services/api/client';
import { useSessionStore } from '../../../src/state/sessionStore';
import { queryClient } from '../../../src/services/queryClient';

const activeSession = {
  deviceId: 'd1',
  accountId: 'a1',
  role: 'ADMIN' as const,
  status: 'ACTIVE' as const,
  jwt: 'test-jwt',
};

describe('apiFetch', () => {
  beforeEach(() => {
    useSessionStore.getState().clearSession();
    queryClient.clear();
    global.fetch = jest.fn();
    (SecureStore.deleteItemAsync as jest.Mock).mockReset().mockResolvedValue(undefined);
  });

  it('uses the default base URL when EXPO_PUBLIC_API_URL is not set', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });

    await apiFetch('/health');

    expect(global.fetch).toHaveBeenCalledWith('http://localhost:3000/health', expect.anything());
  });

  it('attaches the Authorization header when a session has a jwt', async () => {
    useSessionStore.getState().setSession(activeSession);
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });

    await apiFetch('/customers');

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer test-jwt');
  });

  it('defaults Content-Type to application/json', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });

    await apiFetch('/customers');

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect((init.headers as Headers).get('Content-Type')).toBe('application/json');
  });

  it('does not override a caller-supplied Content-Type', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });

    await apiFetch('/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data' },
    });

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect((init.headers as Headers).get('Content-Type')).toBe('multipart/form-data');
  });

  it('clears the session on a 401 response', async () => {
    useSessionStore.getState().setSession(activeSession);
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { code: 'UNAUTHORIZED', message: 'Invalid token' } }),
    });

    await expect(apiFetch('/customers')).rejects.toThrow(ApiRequestError);
    expect(useSessionStore.getState().session).toBeNull();
  });

  it('also deletes the stored session and clears the query cache on a 401', async () => {
    useSessionStore.getState().setSession(activeSession);
    queryClient.setQueryData(['products'], [{ barcode: '123' }]);
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { code: 'DEVICE_REVOKED', message: 'Device revoked' } }),
    });

    await expect(apiFetch('/customers')).rejects.toThrow(ApiRequestError);

    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('valent.session');
    expect(queryClient.getQueryData(['products'])).toBeUndefined();
  });

  it('throws ApiRequestError with the backend error body on a non-2xx response', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ error: { code: 'VALIDATION_ERROR', message: 'Bad input' } }),
    });

    await expect(apiFetch('/customers')).rejects.toMatchObject({
      statusCode: 422,
      code: 'VALIDATION_ERROR',
      message: 'Bad input',
    });
  });

  it('throws ApiRequestError (not a TypeError) when the error body is not an API envelope', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ message: 'Bad Gateway' }),
    });

    await expect(apiFetch('/customers')).rejects.toMatchObject({
      statusCode: 502,
      code: 'UNKNOWN_ERROR',
      message: 'Request failed with status 502',
    });
  });

  it('throws ApiRequestError (not a SyntaxError) when the error body is empty', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new SyntaxError('Unexpected end of JSON input');
      },
    });

    const error: unknown = await apiFetch('/customers').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ statusCode: 500, code: 'UNKNOWN_ERROR' });
  });

  it('resolves to null instead of throwing on a successful empty (204) body', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => {
        throw new SyntaxError('Unexpected end of JSON input');
      },
    });

    await expect(apiFetch('/devices/d1')).resolves.toBeNull();
  });

  it('still throws ApiRequestError on a 401 when clearing storage fails', async () => {
    (SecureStore.deleteItemAsync as jest.Mock).mockRejectedValueOnce(new Error('keychain locked'));
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { code: 'UNAUTHORIZED', message: 'Invalid token' } }),
    });

    await expect(apiFetch('/customers')).rejects.toBeInstanceOf(ApiRequestError);
  });

  it('throws ApiRequestError when a success response body is not valid JSON', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    });

    await expect(apiFetch('/products')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE_BODY',
    });
  });

  it('resolves to null for a 204 with no body', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => {
        throw new SyntaxError('Unexpected end of JSON input');
      },
    });

    await expect(apiFetch('/whatever')).resolves.toBeNull();
  });
});
