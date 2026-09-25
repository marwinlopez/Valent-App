import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

jest.mock('../../src/services/api/config', () => ({
  getBcvRate: jest.fn(),
  getMargins: jest.fn(),
}));

import { getBcvRate, getMargins } from '../../src/services/api/config';
import { usePricingInputs } from '../../src/hooks/usePricingInputs';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('usePricingInputs', () => {
  beforeEach(() => {
    (getBcvRate as jest.Mock).mockReset();
    (getMargins as jest.Mock).mockReset();
  });

  it('resolves the margin for a department', async () => {
    (getBcvRate as jest.Mock).mockResolvedValue({ rateDate: '2026-09-24', rate: 40 });
    (getMargins as jest.Mock).mockResolvedValue([
      { id: '1', level: 'DEPARTAMENTO', level_name: 'Lacteos', percentage: 25 },
      { id: '2', level: 'DEPARTAMENTO', level_name: 'Granos', percentage: 10 },
    ]);

    const { result } = await renderHook(() => usePricingInputs(), { wrapper });

    await waitFor(() => expect(result.current.bcvRate).toBe(40));
    expect(result.current.marginFor('Lacteos')).toBe(25);
  });

  it('returns a null margin for a department with no rule', async () => {
    (getBcvRate as jest.Mock).mockResolvedValue({ rateDate: '2026-09-24', rate: 40 });
    (getMargins as jest.Mock).mockResolvedValue([]);

    const { result } = await renderHook(() => usePricingInputs(), { wrapper });

    await waitFor(() => expect(result.current.bcvRate).toBe(40));
    expect(result.current.marginFor('Lacteos')).toBeNull();
  });

  it('exposes a null rate when none is set for the day', async () => {
    (getBcvRate as jest.Mock).mockResolvedValue(null);
    (getMargins as jest.Mock).mockResolvedValue([]);

    const { result } = await renderHook(() => usePricingInputs(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.bcvRate).toBeNull();
  });

  it('ignores non-department rules when resolving a margin', async () => {
    (getBcvRate as jest.Mock).mockResolvedValue({ rateDate: '2026-09-24', rate: 40 });
    (getMargins as jest.Mock).mockResolvedValue([
      { id: '1', level: 'CATEGORIA', level_name: 'Lacteos', percentage: 99 },
    ]);

    const { result } = await renderHook(() => usePricingInputs(), { wrapper });

    await waitFor(() => expect(result.current.bcvRate).toBe(40));
    expect(result.current.marginFor('Lacteos')).toBeNull();
  });
});
