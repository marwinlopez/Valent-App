import { apiFetch, ApiRequestError } from '../../../src/services/api/client';
import { useSessionStore } from '../../../src/state/sessionStore';

describe('apiFetch', () => {
  beforeEach(() => {
    useSessionStore.getState().clearSession();
    global.fetch = jest.fn();
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
    useSessionStore.getState().setSession({
      deviceId: 'd1',
      accountId: 'a1',
      role: 'ADMIN',
      status: 'ACTIVE',
      jwt: 'test-jwt',
    });
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });

    await apiFetch('/customers');

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer test-jwt');
  });

  it('clears the session on a 401 response', async () => {
    useSessionStore.getState().setSession({
      deviceId: 'd1',
      accountId: 'a1',
      role: 'ADMIN',
      status: 'ACTIVE',
      jwt: 'test-jwt',
    });
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { code: 'UNAUTHORIZED', message: 'Invalid token' } }),
    });

    await expect(apiFetch('/customers')).rejects.toThrow(ApiRequestError);
    expect(useSessionStore.getState().session).toBeNull();
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
});
