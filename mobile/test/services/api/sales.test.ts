jest.mock('../../../src/services/api/client', () => ({
  ...jest.requireActual('../../../src/services/api/client'),
  apiFetch: jest.fn(),
}));

import { apiFetch } from '../../../src/services/api/client';
import { createSale } from '../../../src/services/api/sales';
import type { CreateSaleRequest } from '../../../src/types/api';

const SALE: CreateSaleRequest = {
  items: [{ barcode: '123', name: 'Leche', quantity: 2, unitPriceUsd: 3 }],
  totalUsd: 6,
  totalVes: 240,
  paymentMethod: 'EFECTIVO_USD',
  bcvRateUsed: 40,
};

describe('sales api', () => {
  beforeEach(() => {
    (apiFetch as jest.Mock).mockReset().mockResolvedValue({ saleId: 's-1' });
  });

  it('posts the sale and returns the id', async () => {
    await expect(createSale(SALE)).resolves.toEqual({ saleId: 's-1' });
    expect(apiFetch).toHaveBeenCalledWith('/sales', {
      method: 'POST',
      body: JSON.stringify(SALE),
    });
  });

  it('includes the customer id on a credit sale', async () => {
    const credit: CreateSaleRequest = { ...SALE, paymentMethod: 'CREDITO', customerId: 'cust-1' };
    await createSale(credit);
    expect(apiFetch).toHaveBeenCalledWith('/sales', {
      method: 'POST',
      body: JSON.stringify(credit),
    });
  });
});
