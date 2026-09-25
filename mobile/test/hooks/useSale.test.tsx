import { renderHook, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

jest.mock('../../src/services/api/sales', () => ({
  createSale: jest.fn(),
}));

import { createSale } from '../../src/services/api/sales';
import { useSale } from '../../src/hooks/useSale';
import { PRODUCTS_QUERY_KEY } from '../../src/hooks/useProducts';
import type { CreateSaleRequest } from '../../src/types/api';

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const CASH_SALE: CreateSaleRequest = {
  items: [{ barcode: '123', name: 'Leche', quantity: 2, unitPriceUsd: 3 }],
  totalUsd: 6,
  totalVes: 240,
  paymentMethod: 'EFECTIVO_USD',
  bcvRateUsed: 40,
};

const CREDIT_SALE: CreateSaleRequest = { ...CASH_SALE, paymentMethod: 'CREDITO', customerId: 'cust-1' };

describe('useSale', () => {
  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    (createSale as jest.Mock).mockReset().mockResolvedValue({ saleId: 's-1' });
  });

  it('invalidates the catalog after a successful sale', async () => {
    const spy = jest.spyOn(queryClient, 'invalidateQueries');
    const { result } = await renderHook(() => useSale(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(CASH_SALE);
    });

    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: PRODUCTS_QUERY_KEY }));
  });

  it('does not invalidate when the mutation fails', async () => {
    (createSale as jest.Mock).mockRejectedValue(new Error('nope'));
    const spy = jest.spyOn(queryClient, 'invalidateQueries');
    const { result } = await renderHook(() => useSale(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(CASH_SALE).catch(() => undefined);
    });

    expect(spy).not.toHaveBeenCalled();
  });

  it('does not retry a failed sale', async () => {
    // The client here defaults mutations to retrying, so the hook's own
    // `retry: false` is the only thing preventing a second attempt. Without
    // this, the assertion would hold on TanStack's no-retry default for
    // mutations and pass even with `retry: false` deleted — proving nothing
    // about the one setting that stops a lost response becoming two sales.
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: 3 } },
    });
    (createSale as jest.Mock).mockRejectedValue(new Error('network dropped'));
    const { result } = await renderHook(() => useSale(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(CASH_SALE).catch(() => undefined);
    });

    expect(createSale).toHaveBeenCalledTimes(1);
  });

  it('invalidates the customer keys after a successful credit sale', async () => {
    const spy = jest.spyOn(queryClient, 'invalidateQueries');
    const { result } = await renderHook(() => useSale(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(CREDIT_SALE);
    });

    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['customers'] }));
    expect(spy).toHaveBeenCalledWith({ queryKey: ['credit-check'] });
  });

  it('does not invalidate the customer keys after a successful cash sale', async () => {
    const spy = jest.spyOn(queryClient, 'invalidateQueries');
    const { result } = await renderHook(() => useSale(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(CASH_SALE);
    });

    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: PRODUCTS_QUERY_KEY }));
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ['customers'] });
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ['credit-check'] });
  });
});
