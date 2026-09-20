import { QueryClient } from '@tanstack/react-query';

/**
 * The app's single TanStack Query client.
 *
 * It lives in `src/services/` rather than in the root layout so that services
 * (notably `signOut`) can reach it. Query keys in this app do NOT carry the
 * `accountId`, so the cache MUST be cleared on sign-out: this is a multi-tenant
 * product and the same install can be re-linked to a different account.
 */
export const queryClient = new QueryClient();
