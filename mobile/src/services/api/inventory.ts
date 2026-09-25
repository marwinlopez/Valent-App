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

export async function adjustStock(barcode: string, delta: number): Promise<Product> {
  return apiFetch<Product>(`/products/${encodeURIComponent(barcode)}/stock`, {
    method: 'PATCH',
    body: JSON.stringify({ delta }),
  });
}
