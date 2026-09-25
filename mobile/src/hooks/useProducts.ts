import { useQuery } from '@tanstack/react-query';
import { listProducts } from '../services/api/inventory';

export const PRODUCTS_QUERY_KEY = ['products'] as const;

/** The whole catalog, fetched once and filtered on-device. A few hundred to a
 *  couple thousand rows fit comfortably in memory, search stays instant, and
 *  the Sheets API (quota-limited) sees one request instead of one per
 *  keystroke. */
export function useProducts() {
  return useQuery({ queryKey: PRODUCTS_QUERY_KEY, queryFn: listProducts });
}
