import type { ApiRequestError } from './api/client';

/**
 * Spanish lead-in per sale error code. Deliberately a short fragment, not a
 * full sentence: `saleErrorMessage` appends the backend's own message after
 * it, and the backend's message is what actually carries the specifics a
 * fixed string can't -- see the spec's two explicit requirements:
 *   - INSUFFICIENT_STOCK: "the backend names the product" (and how many are
 *     available vs requested)
 *   - CREDIT_DENIED: "show the backend's `reason`, not a generic failure"
 *
 * Exported so the credit pre-check (post-venta.tsx) can reuse the same
 * "Spanish lead-in + backend detail" wording for CREDIT_DENIED instead of a
 * second, independently-worded copy of it.
 */
export const SALE_ERROR_PREFIX: Record<string, string> = {
  INSUFFICIENT_STOCK: 'Existencia insuficiente',
  PRODUCT_NOT_FOUND: 'Producto no encontrado en el inventario',
  CREDIT_DENIED: 'Crédito rechazado',
  CUSTOMER_REQUIRED: 'Selecciona un cliente para cobrar a crédito',
  DUPLICATE_LINE: 'Línea repetida en el carrito',
  INVALID_STOCK_VALUE: 'Existencia inválida en la hoja',
};

export const SALE_ERROR_FALLBACK = 'No se pudo registrar la venta.';

/**
 * The message a cashier sees for a failed sale.
 *
 * Backend messages are English, the UI is Spanish -- resolved here by
 * keeping both: a short Spanish lead-in (what kind of problem) followed by
 * the backend's own detail (which product, how many available, why credit
 * was denied). A cashier told "there isn't enough stock" with no product
 * name or number is exactly the failure mode the spec calls out.
 */
export function saleErrorMessage(err: ApiRequestError): string {
  const prefix = SALE_ERROR_PREFIX[err.code];
  if (!prefix) return SALE_ERROR_FALLBACK;
  return `${prefix}: ${err.message}`;
}
