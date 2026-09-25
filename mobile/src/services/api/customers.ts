import { apiFetch } from './client';
import type { CreditCheckResponse, Customer } from '../../types/api';

export async function listCustomers(): Promise<Customer[]> {
  return apiFetch<Customer[]>('/customers');
}

export async function checkCredit(customerId: string, amount: number): Promise<CreditCheckResponse> {
  return apiFetch<CreditCheckResponse>(
    `/customers/${encodeURIComponent(customerId)}/credit-check?amount=${amount}`
  );
}
