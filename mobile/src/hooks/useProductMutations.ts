import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createProduct, updateProduct, adjustStock } from '../services/api/inventory';
import { PRODUCTS_QUERY_KEY } from './useProducts';
import type { CreateProductRequest, UpdateProductRequest } from '../types/api';

/**
 * Create, update and stock-adjust, each invalidating the cached catalog on
 * success so the list and the detail screen stay consistent without any screen
 * having to push the change around by hand.
 */
export function useProductMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: PRODUCTS_QUERY_KEY });

  const create = useMutation({
    mutationFn: (body: CreateProductRequest) => createProduct(body),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ barcode, body }: { barcode: string; body: UpdateProductRequest }) =>
      updateProduct(barcode, body),
    onSuccess: invalidate,
  });

  /* `requestId` comes from the caller: it identifies one logical adjustment
     and has to survive re-renders and retries of it, so it is minted once at
     the call site (in the press handler) rather than here. */
  const adjust = useMutation({
    mutationFn: ({ barcode, delta, requestId }: { barcode: string; delta: number; requestId: string }) =>
      adjustStock(barcode, delta, requestId),
    onSuccess: invalidate,
  });

  return { create, update, adjust };
}
