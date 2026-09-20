# Mobile Foundation — Design Spec

Date: 2026-09-20
Sub-project: 1 of 8 (see [Roadmap](#roadmap) below)
Status: Approved for planning

## Context

Valent-App's backend (sub-project 0, merged to `master`) exposes a REST API for
device auth (JWT-based, invite-token linking), RBAC, BCV rate, margins,
customers/credit, inventory, and sales. This sub-project builds the Expo
(React Native + TypeScript) mobile app's foundation: the project scaffold,
Material 3 Expressive theming (light/dark), state management, a typed API
client, and a role-based navigation shell — everything every later mobile
sub-project (Auth/device linking, Inventory, POS, Credit/Loyalty, QR,
Dashboard/Config) will be built on top of.

This sub-project does **not** build any business screen. Every screen it
touches is a placeholder ("Próximamente") wired into real navigation and
real auth state, so later sub-projects replace placeholder content without
touching the shell around it.

## Roadmap

0. Backend API — done, merged to `master`
1. **Mobile Foundation** (this spec)
2. Auth + device linking (mobile screens: Home/login, invite-token linking flow)
3. Inventory (list, barcode scanner, product detail/new product)
4. POS / PostVenta (checkout, payment methods, live credit validation)
5. Credit & Loyalty (UI in Configuración over existing backend endpoints)
6. QR client linking (generation, scan, self-service catalog/orders)
7. Dashboard y Configuración

Each sub-project gets its own spec → plan → implementation cycle.

## Goals

- Scaffold an Expo + TypeScript project with strict typing (no `any`) and
  Expo Router file-based navigation.
- Material 3 Expressive theming via React Native Paper, following the
  system's light/dark preference automatically.
- A minimal, reusable UI component set (`src/components/ui`) following
  Atomic Design principles — only what this sub-project's placeholder
  screens actually need, not a speculative full catalog.
- A typed, isolated service layer (`src/services/`) for the backend API and
  secure local session storage, with business logic separated into custom
  hooks (`src/hooks/`) rather than living in screens.
- Role-based bottom-tab navigation: which tabs are visible depends on the
  authenticated device's `role`, read from a persisted session.
- App-wide error handling (Error Boundary) and user feedback (Toast/Snackbar,
  loading skeletons) infrastructure that every later screen can reuse.

## Non-goals (this sub-project)

- No real screens with business content. `Home`, `Dashboard`, `Inventario`,
  `PostVenta`, `Configuración` are all placeholders in this sub-project;
  sub-projects 2–7 replace their content, not their navigation wiring.
- No device linking flow (QR scan, invite-token entry UI, Hardware ID
  capture). That's sub-project 2. This sub-project only builds the session
  store and API client the linking flow will use.
- No `useCreditValidation`/`useSheetsSync` hooks (or any other
  business-specific hook) built speculatively. The hook *pattern* is
  established here via `useAuthStatus` (a hook this sub-project genuinely
  needs); business hooks are added by the sub-project that first consumes
  them (POS, Inventory), each following this same pattern.
- No manual light/dark theme override UI (that belongs in Configuración,
  sub-project 7). This sub-project follows the OS preference only.
- No normalization of the backend's inconsistent response field casing
  (some endpoints return camelCase, some snake_case — a known backend
  follow-up item in the root `CLAUDE.md`). The mobile API client types each
  endpoint's response exactly as the backend currently returns it.

## Stack

- Expo (latest stable SDK), TypeScript (`strict: true`, no `any`)
- Expo Router (file-based routing)
- React Native Paper (Material 3 components + theming)
- Zustand (session/client state) + `expo-secure-store` (JWT persistence)
- TanStack Query (server state / data fetching)
- Jest + `jest-expo` + `@testing-library/react-native` (unit tests for pure
  logic: stores, services, hooks — no component rendering tests in this
  sub-project)
- ESLint + Prettier (Expo's recommended config)

## Project structure

```
app/                            # Expo Router — file-based routes
  _layout.tsx                   # Root layout: ErrorBoundary, PaperProvider,
                                 # QueryClientProvider, ToastProvider, session hydration
  (auth)/
    index.tsx                   # Home — placeholder login/linking screen
  (app)/
    _layout.tsx                 # Bottom tabs, role-gated visibility
    dashboard.tsx                # placeholder
    inventario.tsx               # placeholder
    post-venta.tsx                # placeholder
    configuracion.tsx             # placeholder
src/
  components/
    ui/
      Button.tsx
      TextInput.tsx
      Card.tsx
      Skeleton.tsx
      EmptyState.tsx
  hooks/
    useSession.ts               # thin wrapper over the Zustand session store
    useAuthStatus.ts            # TanStack Query wrapper over GET /auth/me
  services/
    api/
      client.ts                 # typed fetch wrapper, attaches JWT, handles 401
      auth.ts                   # /auth/* calls
    storage/
      secureSession.ts          # expo-secure-store read/write for the JWT
  state/
    sessionStore.ts             # Zustand: { deviceId, accountId, role, jwt, status } | null
  theme/
    theme.ts                    # MD3 light/dark theme definitions
  types/
    api.ts                      # response/request types per backend endpoint
  errors/
    ErrorBoundary.tsx
  feedback/
    ToastProvider.tsx           # Context + Paper Snackbar, exposes useToast()
test/
  state/sessionStore.test.ts
  services/api/client.test.ts
  hooks/useAuthStatus.test.ts
```

## Theming

`PaperProvider` wraps the app in the root layout with a custom MD3 theme
(`src/theme/theme.ts`, extending `MD3LightTheme`/`MD3DarkTheme`). The active
theme is selected via `useColorScheme()` (React Native's system preference
hook) — no manual override in this sub-project.

## Session & API client

- **`sessionStore.ts`** (Zustand): holds `{ deviceId, accountId, role, jwt,
  status } | null`. On app start, the root layout hydrates it from
  `expo-secure-store` (never `AsyncStorage` — the JWT is a secret). Provides
  `setSession`, `clearSession`.
- **`client.ts`**: a typed `fetch` wrapper. Reads
  `process.env.EXPO_PUBLIC_API_URL` as the base URL (falls back to
  `http://localhost:3000` for local dev). Attaches
  `Authorization: Bearer <jwt>` from the session store on every request that
  has one. On a `401` response, clears the session store and lets the root
  layout's redirect-to-Home logic take over (no manual navigation call
  inside the client itself — keep it a pure data layer).
- **`types/api.ts`**: TypeScript interfaces for each endpoint's request/response
  shape, matching the backend's *actual* current field casing per endpoint
  (see Non-goals — no normalization attempted here).
- **`useAuthStatus()`**: a TanStack Query hook wrapping `GET /auth/me`,
  used by the navigation shell to know the current `role`/`status` and to
  detect revocation (`status !== 'ACTIVE'` → clear session, redirect to
  Home).

## Navigation (RBAC)

Expo Router route groups:
- **`(auth)`**: `Home` (placeholder). Shown when there is no valid session.
- **`(app)`**: bottom-tab layout (`_layout.tsx`) whose visible tabs depend
  on `role`:
  - `ADMIN`: Dashboard, Inventario, PostVenta, Configuración
  - `INVENTARIO`: Inventario
  - `POST_VENTA`: PostVenta
  - `CLIENTE_PEDIDOS`: does not use this tab shell at all — sub-project 6
    replaces it with a simplified catalog screen. Since `CLIENTE_PEDIDOS`
    devices are only ever created via the QR-linking flow (sub-project 6,
    not yet built), no session with this role can exist during this
    sub-project's lifetime — the shell doesn't need a fallback for it yet,
    only a `role` branch ready for sub-project 6 to fill in.

The root layout decides which group to mount based on session validity
(hydrated store + `useAuthStatus()`), redirecting to `(auth)` whenever the
session is missing or `status !== 'ACTIVE'`.

## Error handling & feedback

- **`ErrorBoundary.tsx`**: a class component (React requirement) wrapping
  the app tree in the root layout, rendering a simple fallback screen on an
  uncaught render error.
- **`ToastProvider.tsx`**: a Context provider around Paper's `Snackbar`,
  exposing a `useToast()` hook any screen or hook can call to surface
  errors, confirmations, etc.
- **`Skeleton.tsx`**: a reusable loading placeholder component (not provided
  by React Native Paper out of the box) for later data-fetching screens.

## Testing

Jest (`jest-expo` preset) covering pure logic only in this sub-project:
`sessionStore` (set/clear/hydrate behavior), `client.ts` (JWT attachment,
401 handling, base URL resolution — `fetch` mocked), and `useAuthStatus`
(query behavior — API client mocked). No component-rendering tests yet;
visual verification happens by running the app in the simulator/device per
task, per this project's usual UI-change verification practice.

## Future work

- [ ] `useCreditValidation`, `useSheetsSync`, and other business hooks —
      added by the sub-project that first needs them (POS, Inventory),
      following the `useAuthStatus` pattern established here.
- [ ] Manual light/dark theme override — sub-project 7 (Configuración).
- [ ] Normalize backend response field casing, or add a mapping layer in
      `types/api.ts` — tracked as backend debt in the root `CLAUDE.md`;
      revisit once the backend's response-serialization layer
      (recommended in the backend's final review) is built.
- [ ] Hardware ID capture (`expo-application`/`expo-device`) and the actual
      device-linking flow — sub-project 2.
