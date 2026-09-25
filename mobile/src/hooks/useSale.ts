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
 */
export function useSale() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateSaleRequest) => createSale(body),
    retry: false,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PRODUCTS_QUERY_KEY }),
  });
}
