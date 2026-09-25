import { apiFetch } from './client';
import type { CreateProductRequest, Product, UpdateProductRequest } from '../../types/api';

export async function listProducts(): Promise<Product[]> {
  return apiFetch<Product[]>('/products');
}

export async function createProduct(body: CreateProductRequest): Promise<Product> {
  return apiFetch<Product>('/products', { method: 'POST', body: JSON.stringify(body) });
}

export async function updateProduct(barcode: string, body: UpdateProductRequest): Promise<Product> {
  return apiFetch<Product>(`/products/${encodeURIComponent(barcode)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

/**
 * `requestId` is the idempotency key for the adjustment. The backend's Sheets
 * queue retries a whole task on a 429/5xx, and a stock adjustment accumulates,
 * so without it a retry of a write that landed would apply the delta twice.
 *
 * It is a parameter, not generated here: it has to identify one logical
 * adjustment across every retry of it, and a value minted inside this function
 * would be new on each attempt — exactly what it is meant to prevent.
 */
export async function adjustStock(barcode: string, delta: number, requestId: string): Promise<Product> {
  return apiFetch<Product>(`/products/${encodeURIComponent(barcode)}/stock`, {
    method: 'PATCH',
    body: JSON.stringify({ delta, requestId }),
  });
}
