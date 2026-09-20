# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

## Web is a development/verification target, not a shipping platform

This app ships to iOS and Android. `npx expo start --web` exists here only so a
change can be seen and verified in a browser during development (this project's
standard UI-verification practice). Nothing web-specific is a shipping concern,
and no sub-project should relitigate this — decided for sub-projects 1–7.

Consequences to honor:

- `app.json` sets `web.output: "single"` (a client-rendered SPA for dev), not
  `"static"` — we do not build or deploy a web bundle.
- `expo-secure-store` has no web implementation. The web branch of
  `src/services/storage/secureStore.ts` is an **in-memory** shim, deliberately
  NOT `localStorage`/`sessionStorage`: the JWT is a 30-day bearer token and
  persisting it unencrypted would violate the spec's hard constraint. In-memory
  satisfies that constraint by construction. The cost — the session does not
  survive a page reload on web — is acceptable for a dev-only target. Do not
  "fix" it with web storage.
- When verifying on web, set a session from the browser console
  (`useSessionStore.getState().setSession(...)`) rather than expecting one to
  have been persisted from a previous reload.

## Session lifecycle

Never call `setSession`/`saveSession` or `clearSession`/`deleteSession`
separately. Use `signIn(session)` / `signOut()` from `src/services/session.ts`,
which pair memory + disk (and, for `signOut`, clear the TanStack Query cache —
query keys carry no `accountId` and this is a multi-tenant product).
