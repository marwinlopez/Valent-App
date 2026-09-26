import { saleErrorMessage, SALE_ERROR_PREFIX, SALE_ERROR_FALLBACK } from '../../src/services/saleErrors';
import { ApiRequestError } from '../../src/services/api/client';

describe('saleErrorMessage', () => {
  it('keeps the backend detail for INSUFFICIENT_STOCK, naming the product and the numbers', () => {
    const err = new ApiRequestError(409, 'INSUFFICIENT_STOCK', 'Not enough stock for barcode 123: 2 available, 5 requested');
    expect(saleErrorMessage(err)).toBe(
      'Existencia insuficiente: Not enough stock for barcode 123: 2 available, 5 requested'
    );
  });

  it('keeps the backend reason for CREDIT_DENIED instead of a generic failure', () => {
    const err = new ApiRequestError(409, 'CREDIT_DENIED', 'Requested amount exceeds available credit');
    expect(saleErrorMessage(err)).toBe('Crédito rechazado: Requested amount exceeds available credit');
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
});
