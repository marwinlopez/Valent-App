import { apiFetch } from './client';
import type { CreateSaleRequest } from '../../types/api';

export async function createSale(body: CreateSaleRequest): Promise<{ saleId: string }> {
  return apiFetch<{ saleId: string }>('/sales', { method: 'POST', body: JSON.stringify(body) });
}
