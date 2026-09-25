import { useQuery } from '@tanstack/react-query';
import { checkCredit, listCustomers } from '../services/api/customers';

export function useCustomers() {
  return useQuery({ queryKey: ['customers'], queryFn: listCustomers });
}

/**
 * The live "does this customer have room for this total" check.
 *
 * `amountUsd`, because that is what the backend compares against the credit
 * limit and what it adds to the debt balance.
 *
 * Disabled until both a customer and a positive amount exist, so selecting a
 * customer on an empty cart doesn't ask the server about a zero sale. This is
 * so nobody waits at the counter to be told no — `POST /sales` re-validates
 * server-side under a row lock, and that remains the real defense.
 */
export function useCreditCheck(customerId: string | null, amountUsd: number) {
  return useQuery({
    queryKey: ['credit-check', customerId, amountUsd],
    queryFn: () => checkCredit(customerId!, amountUsd),
    enabled: Boolean(customerId) && amountUsd > 0,
  });
}
