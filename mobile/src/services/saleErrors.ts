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
 * `evaluateCreditCheck` (backend/src/modules/customers/credit.ts) returns
 * exactly these four fixed English strings for `reason` -- no figures, no
 * interpolation, unlike `INSUFFICIENT_STOCK`'s message (which genuinely
 * carries the product and the numbers and so is passed through raw).
 * Untranslated, a cashier gets a Spanish prefix glued to English boilerplate
 * that names nothing they can act on. Exported so both use sites -- the
 * charge-time error here and the credit pre-check in post-venta.tsx -- apply
 * the same mapping instead of each guessing at a translation.
 */
const CREDIT_DENIAL_REASON_ES: Record<string, string> = {
  'Requested amount must be a valid number': 'El monto solicitado no es un número válido',
  'Requested amount must be positive': 'El monto solicitado debe ser positivo',
  'No available credit': 'Sin crédito disponible',
  'Requested amount exceeds available credit': 'El monto solicitado supera el crédito disponible',
};

export function translateCreditDenialReason(reason: string): string {
  return CREDIT_DENIAL_REASON_ES[reason] ?? reason;
}

/**
 * Shown for `SALE_APPEND_FAILED` and `SHEETS_CONFLICT` -- both mean "we
 * cannot tell whether the sale committed on Google's side before the error
 * reached us", the exact opposite of what `SALE_ERROR_FALLBACK` ("could not
 * register the sale") implies. Charging again on that reading, when the
 * append actually did commit, is a real duplicate: a second `Ventas` row and
 * (on a credit sale, whose debt increase the backend already reversed
 * assuming the append failed) doubled debt. Same wording as the
 * network-level unknown-outcome toast in post-venta.tsx, reused rather than
 * a second, independently-worded copy of the same warning.
 */
export const SALE_UNKNOWN_OUTCOME_MESSAGE = 'No sabemos si la venta se registró. Verifícala antes de cobrar de nuevo.';

const UNKNOWN_OUTCOME_CODES = new Set(['SALE_APPEND_FAILED', 'SHEETS_CONFLICT']);

/**
 * The message a cashier sees for a failed sale.
 *
 * Backend messages are English, the UI is Spanish -- resolved here by
 * keeping both: a short Spanish lead-in (what kind of problem) followed by
 * the backend's own detail (which product, how many available, why credit
 * was denied). A cashier told "there isn't enough stock" with no product
 * name or number is exactly the failure mode the spec calls out.
 *
 * `SALE_APPEND_FAILED`/`SHEETS_CONFLICT` are the one case that isn't a
 * plain "this failed" -- they mean the sale may already be recorded, so they
 * get the verify-before-recharging wording instead of the generic fallback.
 */
export function saleErrorMessage(err: ApiRequestError): string {
  if (UNKNOWN_OUTCOME_CODES.has(err.code)) return SALE_UNKNOWN_OUTCOME_MESSAGE;
  const prefix = SALE_ERROR_PREFIX[err.code];
  if (!prefix) return SALE_ERROR_FALLBACK;
  const detail = err.code === 'CREDIT_DENIED' ? translateCreditDenialReason(err.message) : err.message;
  return `${prefix}: ${detail}`;
}
