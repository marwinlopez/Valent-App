import {
  saleErrorMessage,
  SALE_ERROR_PREFIX,
  SALE_ERROR_FALLBACK,
  SALE_UNKNOWN_OUTCOME_MESSAGE,
  translateCreditDenialReason,
} from '../../src/services/saleErrors';
import { ApiRequestError } from '../../src/services/api/client';

describe('saleErrorMessage', () => {
  it('keeps the backend detail for INSUFFICIENT_STOCK, naming the product and the numbers', () => {
    const err = new ApiRequestError(409, 'INSUFFICIENT_STOCK', 'Not enough stock for barcode 123: 2 available, 5 requested');
    expect(saleErrorMessage(err)).toBe(
      'Existencia insuficiente: Not enough stock for barcode 123: 2 available, 5 requested'
    );
  });

  it('translates the backend reason for CREDIT_DENIED instead of leaving it in English', () => {
    const err = new ApiRequestError(409, 'CREDIT_DENIED', 'Requested amount exceeds available credit');
    expect(saleErrorMessage(err)).toBe('Crédito rechazado: El monto solicitado supera el crédito disponible');
  });

  it('falls back to a generic message for an unmapped code', () => {
    const err = new ApiRequestError(500, 'SOMETHING_ELSE', 'boom');
    expect(saleErrorMessage(err)).toBe(SALE_ERROR_FALLBACK);
  });

  it('every mapped prefix is a non-empty string, so the pre-check can reuse it directly', () => {
    Object.values(SALE_ERROR_PREFIX).forEach((prefix) => {
      expect(prefix.length).toBeGreaterThan(0);
    });
  });

  // SALE_APPEND_FAILED/SHEETS_CONFLICT mean "we can't tell if it committed" --
  // the opposite of the generic fallback's "it didn't happen" implication.
  // Charging again on the wrong reading duplicates a sale that already
  // committed (a second Ventas row, and on credit, debt the backend already
  // reversed assuming the append failed).
  it('maps SALE_APPEND_FAILED to verify-before-recharging wording, not the generic fallback', () => {
    const err = new ApiRequestError(502, 'SALE_APPEND_FAILED', 'Could not confirm the sale was recorded in Sheets; verify before charging again');
    expect(saleErrorMessage(err)).toBe(SALE_UNKNOWN_OUTCOME_MESSAGE);
  });

  it('maps SHEETS_CONFLICT to the same verify-before-recharging wording', () => {
    const err = new ApiRequestError(409, 'SHEETS_CONFLICT', 'Could not complete the Sheets operation after retries');
    expect(saleErrorMessage(err)).toBe(SALE_UNKNOWN_OUTCOME_MESSAGE);
  });
});

describe('translateCreditDenialReason', () => {
  // The four fixed strings evaluateCreditCheck actually returns (backend/src/
  // modules/customers/credit.ts) -- no figures, so a full 1:1 map is exact,
  // unlike INSUFFICIENT_STOCK's genuinely-interpolated message.
  it.each([
    ['Requested amount must be a valid number', 'El monto solicitado no es un número válido'],
    ['Requested amount must be positive', 'El monto solicitado debe ser positivo'],
    ['No available credit', 'Sin crédito disponible'],
    ['Requested amount exceeds available credit', 'El monto solicitado supera el crédito disponible'],
  ])('translates %s', (english, spanish) => {
    expect(translateCreditDenialReason(english)).toBe(spanish);
  });

  it('passes through an unrecognized reason rather than hiding it', () => {
    expect(translateCreditDenialReason('Some future reason')).toBe('Some future reason');
  });
});
