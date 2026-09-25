import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createSale } from '../services/api/sales';
import { PRODUCTS_QUERY_KEY } from './useProducts';
import type { CreateSaleRequest } from '../types/api';

/**
 * Charging a sale.
 *
 * `retry: false` is the point, not an oversight: `POST /sales` is not
 * idempotent, so an automatic retry after a lost response could record the
 * sale twice and decrement stock twice. A sale whose outcome is unknown is
 * reported as unknown; the operator verifies before charging again.
 *
 * The catalog is invalidated on success because the backend decremented stock
 * as part of the sale, so every cached product quantity is now stale.
 *
 * A CREDITO sale also increments the customer's debt balance server-side, so
 * on that path (and only that path — a cash sale never touches the balance)
 * the customer list and every cached credit-check verdict are invalidated
 * too. Otherwise the register would show a stale, too-low balance and a
 * stale "approved" verdict for the next credit sale rung up right after.
 * The backend still re-validates credit under a row lock at charge time —
 * this is about the UI not lying to the cashier in between, not a second
 * line of defense.
 */
export function useSale() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateSaleRequest) => createSale(body),
    // Explicit, not redundant: TanStack's own default for mutations happens to
    // be no-retry today, so deleting this line changes nothing *right now* —
    // which is exactly why it is easy to delete. It pins the behaviour against
    // a future `mutations: { retry: n }` in the app's shared QueryClient, where
    // the blast radius would be a silently double-charged customer.
    retry: false,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: PRODUCTS_QUERY_KEY });
      if (variables.paymentMethod === 'CREDITO') {
        queryClient.invalidateQueries({ queryKey: ['customers'] });
        queryClient.invalidateQueries({ queryKey: ['credit-check'] });
      }
    },
  });
}
