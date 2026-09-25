import { renderHook, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

jest.mock('../../src/services/api/inventory', () => ({
  createProduct: jest.fn(),
  updateProduct: jest.fn(),
  adjustStock: jest.fn(),
}));

import { createProduct, adjustStock } from '../../src/services/api/inventory';
import { useProductMutations } from '../../src/hooks/useProductMutations';
import { PRODUCTS_QUERY_KEY } from '../../src/hooks/useProducts';

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useProductMutations', () => {
  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    (createProduct as jest.Mock).mockReset().mockResolvedValue({});
    (adjustStock as jest.Mock).mockReset().mockResolvedValue({});
  });

  it('invalidates the catalog after a successful create', async () => {
    const spy = jest.spyOn(queryClient, 'invalidateQueries');
    const { result } = await renderHook(() => useProductMutations(), { wrapper });

    await act(async () => {
      await result.current.create.mutateAsync({
        barcode: '1', name: 'A', brand: 'B', department: 'C', unit: 'u', costUsd: 1, stock: 0,
      });
    });

    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: PRODUCTS_QUERY_KEY }));
  });

  it('invalidates the catalog after a stock adjustment', async () => {
    const spy = jest.spyOn(queryClient, 'invalidateQueries');
    const { result } = await renderHook(() => useProductMutations(), { wrapper });

    await act(async () => {
      await result.current.adjust.mutateAsync({ barcode: '1', delta: 5 });
    });

    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: PRODUCTS_QUERY_KEY }));
  });

  it('does not invalidate when the mutation fails', async () => {
    (createProduct as jest.Mock).mockRejectedValue(new Error('nope'));
    const spy = jest.spyOn(queryClient, 'invalidateQueries');
    const { result } = await renderHook(() => useProductMutations(), { wrapper });

    await act(async () => {
      await result.current.create
        .mutateAsync({
          barcode: '1', name: 'A', brand: 'B', department: 'C', unit: 'u', costUsd: 1, stock: 0,
        })
        .catch(() => undefined);
    });

    expect(spy).not.toHaveBeenCalled();
  });
});
