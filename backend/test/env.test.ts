import { describe, it, expect } from 'vitest';
import { loadEnv } from '../src/config/env';

describe('loadEnv', () => {
  it('parses a valid environment', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgres://localhost/test',
      GOOGLE_SERVICE_ACCOUNT_EMAIL: 'svc@example.com',
      GOOGLE_PRIVATE_KEY: 'fake-key',
      JWT_SECRET: 'a'.repeat(20),
      PORT: '4000',
    });
    expect(env.PORT).toBe(4000);
    expect(env.JWT_SECRET).toHaveLength(20);
  });

  it('throws when JWT_SECRET is too short', () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: 'postgres://localhost/test',
        GOOGLE_SERVICE_ACCOUNT_EMAIL: 'svc@example.com',
        GOOGLE_PRIVATE_KEY: 'fake-key',
        JWT_SECRET: 'short',
      })
    ).toThrow();
  });

  it('defaults PORT to 3000 when not set', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgres://localhost/test',
      GOOGLE_SERVICE_ACCOUNT_EMAIL: 'svc@example.com',
      GOOGLE_PRIVATE_KEY: 'fake-key',
      JWT_SECRET: 'a'.repeat(20),
    });
    expect(env.PORT).toBe(3000);
  });
});
