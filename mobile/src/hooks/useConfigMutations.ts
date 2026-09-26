import { useMutation, useQueryClient } from '@tanstack/react-query';
import { putBcvRate, todayRateDate, upsertMargin } from '../services/api/config';

/**
 * Saving the day's rate and a department's margin. Each invalidates the exact
 * query key `usePricingInputs` reads, so the register and the product screens
 * price with the new value without anyone refreshing by hand.
 */
export function useConfigMutations() {
  const queryClient = useQueryClient();

  // The date is minted here, not taken from the caller: it has to be the UTC
  // date the backend reads "today" as, and a caller that could pass its own
  // could pass a local-time one. See `todayRateDate`.
  const setBcvRate = useMutation({
    mutationFn: (rate: number) => putBcvRate(todayRateDate(), rate),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bcv-rate'] }),
  });

  const saveMargin = useMutation({
    mutationFn: ({ department, percentage }: { department: string; percentage: number }) =>
      upsertMargin(department, percentage),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['margins'] }),
  });

  return { setBcvRate, saveMargin };
}
