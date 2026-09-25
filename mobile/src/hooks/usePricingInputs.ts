import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { getBcvRate, getMargins } from '../services/api/config';

/**
 * The two inputs a price needs besides the product's own cost.
 *
 * Only `DEPARTAMENTO` rules are consulted: a product row carries a department
 * and nothing else that margin rules key on, so a category or subcategory rule
 * has nothing on the product to match against.
 */
export function usePricingInputs() {
  const rateQuery = useQuery({ queryKey: ['bcv-rate'], queryFn: getBcvRate });
  const marginsQuery = useQuery({ queryKey: ['margins'], queryFn: getMargins });

  const margins = marginsQuery.data;

  const marginFor = useCallback(
    (department: string): number | null => {
      const rule = margins?.find(
        (m) => m.level === 'DEPARTAMENTO' && m.level_name === department
      );
      return rule ? rule.percentage : null;
    },
    [margins]
  );

  return {
    bcvRate: rateQuery.data?.rate ?? null,
    marginFor,
    isLoading: rateQuery.isLoading || marginsQuery.isLoading,
    isError: rateQuery.isError || marginsQuery.isError,
  };
}
