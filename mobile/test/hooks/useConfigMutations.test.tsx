import { renderHook, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

jest.mock('../../src/services/api/config', () => ({
  ...jest.requireActual('../../src/services/api/config'),
  putBcvRate: jest.fn(),
  upsertMargin: jest.fn(),
}));

import { putBcvRate, upsertMargin, todayRateDate } from '../../src/services/api/config';
import { useConfigMutations } from '../../src/hooks/useConfigMutations';

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useConfigMutations', () => {
  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    (putBcvRate as jest.Mock).mockReset().mockResolvedValue({ rateDate: '2026-09-26', rate: 36.5 });
    (upsertMargin as jest.Mock).mockReset().mockResolvedValue({});
  });

  it('saves the rate for the UTC date the backend reads, so the caller cannot pick another', async () => {
    const { result } = await renderHook(() => useConfigMutations(), { wrapper });

    await act(async () => {
      await result.current.setBcvRate.mutateAsync(36.5);
    });

    expect(putBcvRate).toHaveBeenCalledWith(todayRateDate(), 36.5);
  });

  it('invalidates the rate after saving it', async () => {
    const spy = jest.spyOn(queryClient, 'invalidateQueries');
    const { result } = await renderHook(() => useConfigMutations(), { wrapper });

    await act(async () => {
      await result.current.setBcvRate.mutateAsync(36.5);
    });

    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['bcv-rate'] }));
  });

  it('saves a margin for the department and invalidates the margins', async () => {
    const spy = jest.spyOn(queryClient, 'invalidateQueries');
    const { result } = await renderHook(() => useConfigMutations(), { wrapper });

    await act(async () => {
      await result.current.saveMargin.mutateAsync({ department: 'Lacteos', percentage: 30 });
    });

    expect(upsertMargin).toHaveBeenCalledWith('Lacteos', 30);
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['margins'] }));
  });

  it('does not invalidate when saving fails', async () => {
    (putBcvRate as jest.Mock).mockRejectedValue(new Error('nope'));
    (upsertMargin as jest.Mock).mockRejectedValue(new Error('nope'));
    const spy = jest.spyOn(queryClient, 'invalidateQueries');
    const { result } = await renderHook(() => useConfigMutations(), { wrapper });

    await act(async () => {
      await result.current.setBcvRate.mutateAsync(36.5).catch(() => undefined);
      await result.current.saveMargin
        .mutateAsync({ department: 'Lacteos', percentage: 30 })
        .catch(() => undefined);
    });

    expect(spy).not.toHaveBeenCalled();
  });
});
