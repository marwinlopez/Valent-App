# Mobile Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Expo/TypeScript mobile app foundation — scaffold, Material 3 theming, UI atoms, secure session storage, typed API client, TanStack Query hooks, error/feedback infrastructure, and a role-based navigation shell with placeholder screens — per `docs/superpowers/specs/2026-09-20-mobile-foundation-design.md`.

**Architecture:** An Expo Router app (`mobile/app/`) with two route groups — `(auth)` (Home placeholder, shown when there's no valid session) and `(app)` (role-gated bottom tabs). Business logic lives in `mobile/src/hooks/*` (backed by TanStack Query) and `mobile/src/services/*` (typed API client + secure storage), never in screen components. Session state is a small Zustand store hydrated from `expo-secure-store` at app start; the root layout wires every cross-cutting provider (theme, query client, toast, error boundary) once.

**Tech Stack:** Expo (latest stable SDK) + TypeScript (`strict: true`, no `any`), Expo Router, React Native Paper (Material 3), Zustand, TanStack Query, `expo-secure-store`, Jest + `jest-expo` + `@testing-library/react-native`.

## Global Constraints

- TypeScript `strict: true` everywhere in `mobile/`; never use `any` — use `unknown` + narrowing or a precise type instead.
- Business logic (data fetching, validation, session decisions) lives in `mobile/src/hooks/*` or `mobile/src/services/*`, never inline in a screen component under `mobile/app/`.
- Every screen renders inside the providers wired once in `mobile/app/_layout.tsx` (theme, query client, toast, error boundary) — no screen sets up its own `QueryClientProvider`/`PaperProvider`/etc.
- The JWT is only ever persisted via `expo-secure-store` (`mobile/src/services/storage/secureSession.ts`) — never `AsyncStorage`, never a Zustand `persist` middleware backed by unencrypted storage.
- No business screens in this plan. `Home`, `Dashboard`, `Inventario`, `Post-Venta`, `Configuración` are placeholders (`EmptyState`) wired into real navigation and real auth state — sub-projects 2–7 replace their content only.
- Automated tests cover pure logic only in this plan (Zustand store, storage module, API client, `useAuthStatus` via `renderHook`) — no visual component-rendering/snapshot tests. Every task that changes what's visible on screen must additionally be verified by running `npx expo start --web` (from `mobile/`) and checking the result in the browser tool, per this project's UI-verification practice.
- Follow the file structure from the spec exactly (`mobile/app/`, `mobile/src/{components,hooks,services,state,theme,types,errors,feedback}/`, `mobile/test/` mirroring `mobile/src/`).

---

## File Structure

```
mobile/                               # new Expo project, sibling to backend/
  app/
    _layout.tsx
    index.tsx                         # redirect gate (session -> first tab | Home)
    (auth)/
      _layout.tsx
      index.tsx                       # Home placeholder
    (app)/
      _layout.tsx                     # role-gated Tabs
      dashboard.tsx
      inventario.tsx
      post-venta.tsx
      configuracion.tsx
  src/
    components/ui/
      Button.tsx
      TextInput.tsx
      Card.tsx
      Skeleton.tsx
      EmptyState.tsx
    hooks/
      useSession.ts
      useAuthStatus.ts
    services/
      api/client.ts
      storage/secureSession.ts
    state/sessionStore.ts
    theme/theme.ts
    types/api.ts
    errors/ErrorBoundary.tsx
    feedback/ToastProvider.tsx
  test/
    state/sessionStore.test.ts
    services/storage/secureSession.test.ts
    services/api/client.test.ts
    hooks/useAuthStatus.test.tsx
  .env.example
  jest.config.js
```

---

### Task 1: Project scaffold, Jest setup, and a booting root layout

**Files:**
- Create: `mobile/` (via `create-expo-app`, plus the files below)
- Create: `mobile/jest.config.js`
- Create: `mobile/.env.example`
- Create: `mobile/app/_layout.tsx` (temporary minimal version — Task 8 replaces it)
- Create: `mobile/app/index.tsx` (temporary placeholder — Task 8 replaces it)
- Test: `mobile/test/sanity.test.ts`

**Interfaces:**
- Produces: a running Expo project at `mobile/` with TypeScript, Expo Router, and Jest wired up — every later task works inside this project.

- [ ] **Step 1: Scaffold the Expo project**

From the repo root (`D:\Valent-App`):

```bash
npx create-expo-app@latest mobile
```

This is the current, standard Expo scaffolding command — as of recent Expo SDK versions its default template already includes TypeScript and Expo Router pre-wired (`package.json`'s `"main"` field set to `"expo-router/entry"`, `app/` directory present). If the installed version's default template differs (no `app/` directory, no Expo Router), install it explicitly and follow the current official instructions at https://docs.expo.dev/router/installation/ rather than guessing — ask the controller if genuinely stuck.

- [ ] **Step 2: Install additional dependencies**

From `mobile/`:

```bash
npx expo install react-native-paper react-native-safe-area-context expo-secure-store
npm install zustand @tanstack/react-query
npm install --save-dev @testing-library/react-native jest-expo
```

(`npx expo install` picks versions compatible with the installed Expo SDK; plain `npm install` is fine for SDK-agnostic packages like `zustand` and `@tanstack/react-query`.)

- [ ] **Step 3: Create `mobile/jest.config.js`**

```js
module.exports = {
  preset: 'jest-expo',
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|@tanstack/react-query)',
  ],
};
```

- [ ] **Step 4: Create `mobile/.env.example`**

```
EXPO_PUBLIC_API_URL=http://localhost:3000
```

- [ ] **Step 5: Write the sanity test**

```ts
// mobile/test/sanity.test.ts
describe('sanity', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Run the sanity test**

Run: `cd mobile && npx jest test/sanity.test.ts`
Expected: PASS (1 test)

- [ ] **Step 7: Create a temporary minimal root layout, `mobile/app/_layout.tsx`**

```tsx
import { Stack } from 'expo-router';

export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

- [ ] **Step 8: Create a temporary placeholder index route, `mobile/app/index.tsx`**

(If `create-expo-app`'s default template already created example routes under `app/`, delete them first so only this file remains.)

```tsx
import { View, Text, StyleSheet } from 'react-native';

export default function TemporaryIndex() {
  return (
    <View style={styles.container}>
      <Text>Valent App</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
```

- [ ] **Step 9: Verify the app boots**

Run: `cd mobile && npx expo start --web` and open it in the browser tool.
Expected: a blank screen with the text "Valent App" — confirms the scaffold, Expo Router, and TypeScript compile end to end. Stop the dev server after confirming.

- [ ] **Step 10: Commit**

```bash
git add mobile/
git commit -m "feat(mobile): scaffold Expo project with Jest and a booting root layout"
```

---

### Task 2: Material 3 theme (light/dark)

**Files:**
- Create: `mobile/src/theme/theme.ts`
- Modify: `mobile/app/_layout.tsx` (wrap in `PaperProvider`)

**Interfaces:**
- Produces: `lightTheme: MD3Theme`, `darkTheme: MD3Theme` from `src/theme/theme.ts` — Task 8's root layout selects between these via `useColorScheme()`.

- [ ] **Step 1: Create `mobile/src/theme/theme.ts`**

```ts
import { MD3LightTheme, MD3DarkTheme, type MD3Theme } from 'react-native-paper';

export const lightTheme: MD3Theme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: '#2E7D32',
    secondary: '#6D4C41',
  },
};

export const darkTheme: MD3Theme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary: '#81C784',
    secondary: '#BCAAA4',
  },
};
```

(These are starting brand colors — a green/brown retail palette — easy to refine later; the point of this task is the theming *infrastructure*, not final brand colors.)

- [ ] **Step 2: Wire `PaperProvider` into `mobile/app/_layout.tsx`**

```tsx
import { Stack } from 'expo-router';
import { PaperProvider } from 'react-native-paper';
import { useColorScheme } from 'react-native';
import { lightTheme, darkTheme } from '../src/theme/theme';

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <PaperProvider theme={colorScheme === 'dark' ? darkTheme : lightTheme}>
      <Stack screenOptions={{ headerShown: false }} />
    </PaperProvider>
  );
}
```

- [ ] **Step 3: Verify visually**

Run: `cd mobile && npx expo start --web`, open in the browser tool. Use the browser tool's dark-mode emulation (or your OS's) to confirm the background/text colors change between light and dark. Stop the dev server after confirming.

- [ ] **Step 4: Commit**

```bash
git add mobile/src/theme/theme.ts mobile/app/_layout.tsx
git commit -m "feat(mobile): add Material 3 light/dark theme"
```

---

### Task 3: UI component atoms

**Files:**
- Create: `mobile/src/components/ui/Button.tsx`
- Create: `mobile/src/components/ui/TextInput.tsx`
- Create: `mobile/src/components/ui/Card.tsx`
- Create: `mobile/src/components/ui/Skeleton.tsx`
- Create: `mobile/src/components/ui/EmptyState.tsx`

**Interfaces:**
- Produces: `Button`, `TextInput`, `Card`, `Skeleton`, `EmptyState` React components from `src/components/ui/*` — Task 8's placeholder screens import `EmptyState`; later sub-projects import all five.

No automated tests for this task per the Global Constraints (no component-rendering tests in this plan) — verification is `tsc` compiling cleanly now, and visual confirmation happens transitively in Task 8 once `EmptyState` is actually rendered on screen.

- [ ] **Step 1: Create `mobile/src/components/ui/Button.tsx`**

```tsx
import { Button as PaperButton, type ButtonProps as PaperButtonProps } from 'react-native-paper';

export type ButtonProps = PaperButtonProps;

export function Button(props: ButtonProps) {
  return <PaperButton mode="contained" {...props} />;
}
```

- [ ] **Step 2: Create `mobile/src/components/ui/TextInput.tsx`**

```tsx
import { TextInput as PaperTextInput, HelperText } from 'react-native-paper';
import { View } from 'react-native';
import type { ComponentProps } from 'react';

export interface TextInputProps extends ComponentProps<typeof PaperTextInput> {
  errorText?: string;
}

export function TextInput({ errorText, ...props }: TextInputProps) {
  return (
    <View>
      <PaperTextInput mode="outlined" error={Boolean(errorText)} {...props} />
      {errorText ? <HelperText type="error">{errorText}</HelperText> : null}
    </View>
  );
}
```

- [ ] **Step 3: Create `mobile/src/components/ui/Card.tsx`**

```tsx
import { Card as PaperCard, type CardProps as PaperCardProps } from 'react-native-paper';

export type CardProps = PaperCardProps;

export function Card(props: CardProps) {
  return <PaperCard {...props} />;
}
```

- [ ] **Step 4: Create `mobile/src/components/ui/Skeleton.tsx`**

```tsx
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, type ViewStyle } from 'react-native';
import { useTheme } from 'react-native-paper';

interface SkeletonProps {
  height?: number;
  width?: number | `${number}%`;
  style?: ViewStyle;
}

export function Skeleton({ height = 16, width = '100%', style }: SkeletonProps) {
  const theme = useTheme();
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 600, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        styles.base,
        { height, width, opacity, backgroundColor: theme.colors.surfaceVariant },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: 4 },
});
```

- [ ] **Step 5: Create `mobile/src/components/ui/EmptyState.tsx`**

```tsx
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';

interface EmptyStateProps {
  title: string;
  message?: string;
}

export function EmptyState({ title, message }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <Text variant="titleMedium">{title}</Text>
      {message ? <Text variant="bodyMedium">{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
});
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd mobile && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add mobile/src/components/ui/
git commit -m "feat(mobile): add reusable UI atoms (Button, TextInput, Card, Skeleton, EmptyState)"
```

---

### Task 4: API response types, secure session storage, and the session store

**Files:**
- Create: `mobile/src/types/api.ts`
- Create: `mobile/src/state/sessionStore.ts`
- Create: `mobile/src/services/storage/secureSession.ts`
- Test: `mobile/test/state/sessionStore.test.ts`
- Test: `mobile/test/services/storage/secureSession.test.ts`

**Interfaces:**
- Produces: `DeviceRole`, `DeviceStatus`, `AuthMeResponse`, `ApiErrorBody` types from `src/types/api.ts`; `useSessionStore` (Zustand store) and `type Session` from `src/state/sessionStore.ts`; `saveSession`, `loadSession`, `deleteSession` from `src/services/storage/secureSession.ts`. Task 5 (API client) and Task 6 (hooks) depend on all of these.

- [ ] **Step 1: Create `mobile/src/types/api.ts`**

```ts
export type DeviceRole = 'ADMIN' | 'INVENTARIO' | 'POST_VENTA' | 'CLIENTE_PEDIDOS';
export type DeviceStatus = 'PENDING' | 'ACTIVE' | 'REVOKED';

export interface AuthMeResponse {
  role: DeviceRole;
  status: DeviceStatus;
  accountId: string;
  jwt?: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}
```

- [ ] **Step 2: Write the failing test for the session store**

```ts
// mobile/test/state/sessionStore.test.ts
import { useSessionStore } from '../../src/state/sessionStore';

describe('useSessionStore', () => {
  beforeEach(() => {
    useSessionStore.getState().clearSession();
  });

  it('starts with no session', () => {
    expect(useSessionStore.getState().session).toBeNull();
  });

  it('setSession stores the session', () => {
    useSessionStore.getState().setSession({
      deviceId: 'd1',
      accountId: 'a1',
      role: 'ADMIN',
      status: 'ACTIVE',
      jwt: 'jwt',
    });
    expect(useSessionStore.getState().session?.role).toBe('ADMIN');
  });

  it('clearSession removes the session', () => {
    useSessionStore.getState().setSession({
      deviceId: 'd1',
      accountId: 'a1',
      role: 'ADMIN',
      status: 'ACTIVE',
      jwt: 'jwt',
    });
    useSessionStore.getState().clearSession();
    expect(useSessionStore.getState().session).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd mobile && npx jest test/state/sessionStore.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement `mobile/src/state/sessionStore.ts`**

```ts
import { create } from 'zustand';
import type { DeviceRole, DeviceStatus } from '../types/api';

export interface Session {
  deviceId: string;
  accountId: string;
  role: DeviceRole;
  status: DeviceStatus;
  jwt: string;
}

interface SessionState {
  session: Session | null;
  hydrated: boolean;
  setSession: (session: Session) => void;
  clearSession: () => void;
  setHydrated: (hydrated: boolean) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  session: null,
  hydrated: false,
  setSession: (session) => set({ session }),
  clearSession: () => set({ session: null }),
  setHydrated: (hydrated) => set({ hydrated }),
}));
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest test/state/sessionStore.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Write the failing test for secure session storage**

```ts
// mobile/test/services/storage/secureSession.test.ts
jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

import * as SecureStore from 'expo-secure-store';
import { saveSession, loadSession, deleteSession } from '../../../src/services/storage/secureSession';

describe('secureSession', () => {
  const session = {
    deviceId: 'd1',
    accountId: 'a1',
    role: 'ADMIN' as const,
    status: 'ACTIVE' as const,
    jwt: 'jwt-value',
  };

  it('saveSession stores the session as JSON', async () => {
    await saveSession(session);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('valent.session', JSON.stringify(session));
  });

  it('loadSession parses a stored session', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(JSON.stringify(session));
    const result = await loadSession();
    expect(result).toEqual(session);
  });

  it('loadSession returns null when nothing is stored', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
    const result = await loadSession();
    expect(result).toBeNull();
  });

  it('deleteSession removes the stored session', async () => {
    await deleteSession();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('valent.session');
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx jest test/services/storage/secureSession.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 8: Implement `mobile/src/services/storage/secureSession.ts`**

```ts
import * as SecureStore from 'expo-secure-store';
import type { Session } from '../../state/sessionStore';

const SESSION_KEY = 'valent.session';

export async function saveSession(session: Session): Promise<void> {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
}

export async function loadSession(): Promise<Session | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  return raw ? (JSON.parse(raw) as Session) : null;
}

export async function deleteSession(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_KEY);
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx jest test/services/storage/secureSession.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 10: Commit**

```bash
git add mobile/src/types/api.ts mobile/src/state/sessionStore.ts mobile/src/services/storage/secureSession.ts mobile/test/state/sessionStore.test.ts mobile/test/services/storage/secureSession.test.ts
git commit -m "feat(mobile): add API types, session store, and secure session storage"
```

---

### Task 5: Typed API client

**Files:**
- Create: `mobile/src/services/api/client.ts`
- Test: `mobile/test/services/api/client.test.ts`

**Interfaces:**
- Consumes: `useSessionStore` (Task 4), `ApiErrorBody` (Task 4).
- Produces: `apiFetch<T>(path: string, init?: RequestInit): Promise<T>` and `class ApiRequestError extends Error` with `{ statusCode, code, message }` from `src/services/api/client.ts`. Task 6's `useAuthStatus` depends on `apiFetch`.

- [ ] **Step 1: Write the failing tests**

```ts
// mobile/test/services/api/client.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest test/services/api/client.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `mobile/src/services/api/client.ts`**

```ts
import { useSessionStore } from '../../state/sessionStore';
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

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const jwt = useSessionStore.getState().session?.jwt;
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (jwt) {
    headers.set('Authorization', `Bearer ${jwt}`);
  }

  const response = await fetch(`${getBaseUrl()}${path}`, { ...init, headers });

  if (response.status === 401) {
    useSessionStore.getState().clearSession();
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiRequestError(
      response.status,
      body?.error.code ?? 'UNKNOWN_ERROR',
      body?.error.message ?? `Request failed with status ${response.status}`
    );
  }

  return response.json() as Promise<T>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest test/services/api/client.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add mobile/src/services/api/client.ts mobile/test/services/api/client.test.ts
git commit -m "feat(mobile): add typed API client with JWT attachment and 401 handling"
```

---

### Task 6: TanStack Query setup and session/auth-status hooks

**Files:**
- Create: `mobile/src/hooks/useSession.ts`
- Create: `mobile/src/hooks/useAuthStatus.ts`
- Test: `mobile/test/hooks/useAuthStatus.test.tsx`

**Interfaces:**
- Consumes: `apiFetch` (Task 5), `useSessionStore` (Task 4), `AuthMeResponse` (Task 4).
- Produces: `useSession(): Session | null` and `useAuthStatus(): UseQueryResult<AuthMeResponse>` from `src/hooks/*`. Task 8's `(app)/_layout.tsx` depends on both.

- [ ] **Step 1: Implement `mobile/src/hooks/useSession.ts`**

```ts
import { useSessionStore } from '../state/sessionStore';

export function useSession() {
  return useSessionStore((state) => state.session);
}
```

- [ ] **Step 2: Write the failing test for `useAuthStatus`**

```tsx
// mobile/test/hooks/useAuthStatus.test.tsx
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStatus } from '../../src/hooks/useAuthStatus';
import { useSessionStore } from '../../src/state/sessionStore';

jest.mock('../../src/services/api/client', () => ({
  apiFetch: jest.fn(),
}));
import { apiFetch } from '../../src/services/api/client';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useAuthStatus', () => {
  beforeEach(() => {
    useSessionStore.getState().clearSession();
    (apiFetch as jest.Mock).mockReset();
  });

  it('is disabled when there is no session', () => {
    const { result } = renderHook(() => useAuthStatus(), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('fetches /auth/me when a session with a jwt exists', async () => {
    useSessionStore.getState().setSession({
      deviceId: 'd1',
      accountId: 'a1',
      role: 'ADMIN',
      status: 'ACTIVE',
      jwt: 'jwt',
    });
    (apiFetch as jest.Mock).mockResolvedValue({ role: 'ADMIN', status: 'ACTIVE', accountId: 'a1' });

    const { result } = renderHook(() => useAuthStatus(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.status).toBe('ACTIVE');
    expect(apiFetch).toHaveBeenCalledWith('/auth/me');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd mobile && npx jest test/hooks/useAuthStatus.test.tsx`
Expected: FAIL — `src/hooks/useAuthStatus.ts` does not exist.

- [ ] **Step 4: Implement `mobile/src/hooks/useAuthStatus.ts`**

```ts
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../services/api/client';
import { useSessionStore } from '../state/sessionStore';
import type { AuthMeResponse } from '../types/api';

export function useAuthStatus() {
  const session = useSessionStore((state) => state.session);

  return useQuery({
    queryKey: ['auth', 'me', session?.deviceId],
    queryFn: () => apiFetch<AuthMeResponse>('/auth/me'),
    enabled: Boolean(session?.jwt),
    retry: false,
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest test/hooks/useAuthStatus.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add mobile/src/hooks/ mobile/test/hooks/
git commit -m "feat(mobile): add useSession and useAuthStatus hooks"
```

---

### Task 7: Error boundary and toast feedback

**Files:**
- Create: `mobile/src/errors/ErrorBoundary.tsx`
- Create: `mobile/src/feedback/ToastProvider.tsx`

**Interfaces:**
- Produces: `ErrorBoundary` (class component) from `src/errors/ErrorBoundary.tsx`; `ToastProvider` and `useToast(): { showToast: (message: string) => void }` from `src/feedback/ToastProvider.tsx`. Task 8's root layout wraps the app in both.

No automated tests for this task per the Global Constraints — verify visually in Task 8 once both are wired into the root layout (a toast can be triggered from the placeholder Home screen during that task's own verification step).

- [ ] **Step 1: Create `mobile/src/errors/ErrorBoundary.tsx`**

```tsx
import { Component, type ReactNode } from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error('Unhandled error caught by ErrorBoundary:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Algo salió mal</Text>
          <Text>Por favor reinicia la aplicación.</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 18, fontWeight: 'bold', marginBottom: 8 },
});
```

- [ ] **Step 2: Create `mobile/src/feedback/ToastProvider.tsx`**

```tsx
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Snackbar } from 'react-native-paper';

interface ToastContextValue {
  showToast: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);

  const showToast = useCallback((next: string) => setMessage(next), []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <Snackbar visible={message !== null} onDismiss={() => setMessage(null)} duration={3000}>
        {message}
      </Snackbar>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd mobile && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add mobile/src/errors/ mobile/src/feedback/
git commit -m "feat(mobile): add ErrorBoundary and toast feedback provider"
```

---

### Task 8: RBAC navigation shell, final root layout, and placeholder screens

**Files:**
- Modify: `mobile/app/_layout.tsx` (final version — providers + hydration gate)
- Modify: `mobile/app/index.tsx` (becomes the redirect gate, replacing Task 1's temporary placeholder)
- Create: `mobile/app/(auth)/_layout.tsx`
- Create: `mobile/app/(auth)/index.tsx` (Home placeholder)
- Create: `mobile/app/(app)/_layout.tsx` (role-gated Tabs)
- Create: `mobile/app/(app)/dashboard.tsx`
- Create: `mobile/app/(app)/inventario.tsx`
- Create: `mobile/app/(app)/post-venta.tsx`
- Create: `mobile/app/(app)/configuracion.tsx`

**Interfaces:**
- Consumes: `lightTheme`/`darkTheme` (Task 2), `EmptyState` (Task 3), `useSessionStore`/`Session` (Task 4), `loadSession` (Task 4), `useSession`/`useAuthStatus` (Task 6), `ErrorBoundary`/`ToastProvider` (Task 7).
- This is the final integration task for this plan — no later task in this plan depends on it.

No automated tests for this task (navigation/integration, not pure logic) — verify entirely by running the app and manually setting a session for each role (see Step 9).

- [ ] **Step 1: Replace `mobile/app/_layout.tsx` with the final version**

```tsx
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { PaperProvider } from 'react-native-paper';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useColorScheme } from 'react-native';
import { ErrorBoundary } from '../src/errors/ErrorBoundary';
import { ToastProvider } from '../src/feedback/ToastProvider';
import { lightTheme, darkTheme } from '../src/theme/theme';
import { useSessionStore } from '../src/state/sessionStore';
import { loadSession } from '../src/services/storage/secureSession';

const queryClient = new QueryClient();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const setSession = useSessionStore((state) => state.setSession);
  const setHydrated = useSessionStore((state) => state.setHydrated);
  const hydrated = useSessionStore((state) => state.hydrated);

  useEffect(() => {
    loadSession().then((session) => {
      if (session) setSession(session);
      setHydrated(true);
    });
  }, [setSession, setHydrated]);

  if (!hydrated) {
    return null;
  }

  return (
    <ErrorBoundary>
      <PaperProvider theme={colorScheme === 'dark' ? darkTheme : lightTheme}>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <Stack screenOptions={{ headerShown: false }} />
          </ToastProvider>
        </QueryClientProvider>
      </PaperProvider>
    </ErrorBoundary>
  );
}
```

- [ ] **Step 2: Replace `mobile/app/index.tsx` with the redirect gate**

```tsx
import { Redirect } from 'expo-router';
import { useSessionStore } from '../src/state/sessionStore';
import type { DeviceRole } from '../src/types/api';

const FIRST_TAB_BY_ROLE: Record<DeviceRole, string> = {
  ADMIN: '/(app)/dashboard',
  INVENTARIO: '/(app)/inventario',
  POST_VENTA: '/(app)/post-venta',
  CLIENTE_PEDIDOS: '/(auth)', // no shell yet — sub-project 6 replaces this
};

export default function Index() {
  const session = useSessionStore((state) => state.session);

  return <Redirect href={session ? FIRST_TAB_BY_ROLE[session.role] : '/(auth)'} />;
}
```

- [ ] **Step 3: Create `mobile/app/(auth)/_layout.tsx`**

```tsx
import { Stack } from 'expo-router';

export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

- [ ] **Step 4: Create `mobile/app/(auth)/index.tsx`**

```tsx
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';

export default function Home() {
  return (
    <View style={styles.container}>
      <Text variant="headlineSmall">Valent App</Text>
      <Text variant="bodyMedium">Vinculación de dispositivo — próximamente</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
});
```

- [ ] **Step 5: Create `mobile/app/(app)/_layout.tsx`**

```tsx
import { Redirect, Tabs } from 'expo-router';
import { useEffect } from 'react';
import { useSession } from '../../src/hooks/useSession';
import { useAuthStatus } from '../../src/hooks/useAuthStatus';
import { useSessionStore } from '../../src/state/sessionStore';
import { deleteSession } from '../../src/services/storage/secureSession';
import type { DeviceRole } from '../../src/types/api';

const TABS_BY_ROLE: Record<DeviceRole, string[]> = {
  ADMIN: ['dashboard', 'inventario', 'post-venta', 'configuracion'],
  INVENTARIO: ['inventario'],
  POST_VENTA: ['post-venta'],
  CLIENTE_PEDIDOS: [],
};

export default function AppLayout() {
  const session = useSession();
  const clearSession = useSessionStore((state) => state.clearSession);
  const { data: authStatus } = useAuthStatus();

  useEffect(() => {
    if (authStatus && authStatus.status !== 'ACTIVE') {
      clearSession();
      deleteSession();
    }
  }, [authStatus, clearSession]);

  if (!session) {
    return <Redirect href="/(auth)" />;
  }

  const visibleTabs = TABS_BY_ROLE[session.role];

  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen
        name="dashboard"
        options={{ href: visibleTabs.includes('dashboard') ? undefined : null, title: 'Dashboard' }}
      />
      <Tabs.Screen
        name="inventario"
        options={{ href: visibleTabs.includes('inventario') ? undefined : null, title: 'Inventario' }}
      />
      <Tabs.Screen
        name="post-venta"
        options={{ href: visibleTabs.includes('post-venta') ? undefined : null, title: 'Post-Venta' }}
      />
      <Tabs.Screen
        name="configuracion"
        options={{ href: visibleTabs.includes('configuracion') ? undefined : null, title: 'Configuración' }}
      />
    </Tabs>
  );
}
```

- [ ] **Step 6: Create the four placeholder tab screens**

```tsx
// mobile/app/(app)/dashboard.tsx
import { EmptyState } from '../../src/components/ui/EmptyState';

export default function Dashboard() {
  return <EmptyState title="Dashboard" message="Próximamente" />;
}
```

```tsx
// mobile/app/(app)/inventario.tsx
import { EmptyState } from '../../src/components/ui/EmptyState';

export default function Inventario() {
  return <EmptyState title="Inventario" message="Próximamente" />;
}
```

```tsx
// mobile/app/(app)/post-venta.tsx
import { EmptyState } from '../../src/components/ui/EmptyState';

export default function PostVenta() {
  return <EmptyState title="Post-Venta" message="Próximamente" />;
}
```

```tsx
// mobile/app/(app)/configuracion.tsx
import { EmptyState } from '../../src/components/ui/EmptyState';

export default function Configuracion() {
  return <EmptyState title="Configuración" message="Próximamente" />;
}
```

- [ ] **Step 7: Verify TypeScript compiles**

Run: `cd mobile && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Run the full test suite**

Run: `npx jest`
Expected: all tests across Tasks 1–6 pass (sanity, sessionStore, secureSession, client, useAuthStatus).

- [ ] **Step 9: Verify visually, for each role**

Run: `cd mobile && npx expo start --web`, open in the browser tool.

- With no session (default state): confirm you land on the Home placeholder (`/(auth)`).
- Use the browser tool's JS console (or a temporary `console.log`/breakpoint) to call
  `require('./src/state/sessionStore').useSessionStore.getState().setSession({ deviceId: 'd1', accountId: 'a1', role: 'ADMIN', status: 'ACTIVE', jwt: 'fake' })`
  (adjust the import path/module resolution for however the web bundle exposes it, or temporarily add a debug button to `(auth)/index.tsx` that calls `setSession` with a hardcoded ADMIN session, then remove the button before committing) and confirm: you land on Dashboard, and all four tabs (Dashboard, Inventario, Post-Venta, Configuración) are visible.
- Repeat with `role: 'INVENTARIO'`: confirm only the Inventario tab is visible and you land there.
- Repeat with `role: 'POST_VENTA'`: confirm only the Post-Venta tab is visible and you land there.
- Confirm dark/light theme still applies correctly across all these screens.

Stop the dev server after confirming. This is manual, exploratory verification — there is no automated test for it in this plan (per Global Constraints), but it's required before this task is considered done.

- [ ] **Step 10: Commit**

```bash
git add mobile/app/
git commit -m "feat(mobile): add RBAC navigation shell and placeholder screens"
```

---

## Self-Review Notes

- **Spec coverage:** scaffold (Task 1), theme (Task 2), UI atoms (Task 3), session store + secure storage + API types (Task 4), API client (Task 5), TanStack Query hooks (Task 6), error/feedback infra (Task 7), RBAC navigation + placeholders (Task 8) — every section of the spec has a task.
- **Type consistency checked:** `Session` (Task 4) is used identically by `secureSession.ts` (Task 4), `client.ts` (Task 5), `useSession`/`useAuthStatus` (Task 6), and `(app)/_layout.tsx`/`index.tsx` (Task 8). `DeviceRole` (Task 4) matches the `TABS_BY_ROLE`/`FIRST_TAB_BY_ROLE` record keys in Task 8. `apiFetch`'s signature (Task 5) matches its use in `useAuthStatus` (Task 6).
- **No placeholders:** every step has real, runnable code; the *screens* themselves are intentionally placeholder UI per the spec's Non-goals, but the code implementing them is complete, not a TBD.
