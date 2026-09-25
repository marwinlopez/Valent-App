jest.mock('../../../src/services/api/client', () => ({
  apiFetch: jest.fn(),
  ApiRequestError: class ApiRequestError extends Error {
    statusCode: number;
    code: string;
    constructor(statusCode: number, code: string, message: string) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  },
}));

import { apiFetch } from '../../../src/services/api/client';
import {
  listProducts,
  createProduct,
  updateProduct,
  adjustStock,
} from '../../../src/services/api/inventory';

const PRODUCT = {
  barcode: '123',
  name: 'Leche',
  brand: 'X',
  department: 'Lacteos',
  unit: 'unidad',
  costUsd: 2.5,
  stock: 10,
};

describe('inventory api', () => {
  beforeEach(() => {
    (apiFetch as jest.Mock).mockReset().mockResolvedValue(PRODUCT);
  });

  it('listProducts requests the catalog', async () => {
    (apiFetch as jest.Mock).mockResolvedValue([PRODUCT]);
    await expect(listProducts()).resolves.toEqual([PRODUCT]);
    expect(apiFetch).toHaveBeenCalledWith('/products');
  });

  it('createProduct posts the whole product', async () => {
    await createProduct(PRODUCT);
    expect(apiFetch).toHaveBeenCalledWith('/products', {
      method: 'POST',
      body: JSON.stringify(PRODUCT),
    });
  });

  it('updateProduct puts the editable fields to the barcode path', async () => {
    const body = { name: 'Leche entera', brand: 'X', department: 'Lacteos', unit: 'litro', costUsd: 3 };
    await updateProduct('123', body);
    expect(apiFetch).toHaveBeenCalledWith('/products/123', {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  });

  it('adjustStock patches a delta', async () => {
    await adjustStock('123', -2);
    expect(apiFetch).toHaveBeenCalledWith('/products/123/stock', {
      method: 'PATCH',
      body: JSON.stringify({ delta: -2 }),
    });
  });

  it('encodes a barcode that needs escaping in the path', async () => {
    await adjustStock('a/b', 1);
    expect(apiFetch).toHaveBeenCalledWith('/products/a%2Fb/stock', expect.anything());
  });
});
