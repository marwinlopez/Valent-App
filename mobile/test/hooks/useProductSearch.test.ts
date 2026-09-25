import { filterProducts } from '../../src/hooks/useProductSearch';
import type { Product } from '../../src/types/api';

const products: Product[] = [
  { barcode: '7591234567890', name: 'Leche entera', brand: 'La Campiña', department: 'Lacteos', unit: 'litro', costUsd: 2.5, stock: 10 },
  { barcode: '7590987654321', name: 'Arroz blanco', brand: 'Primor', department: 'Granos', unit: 'kg', costUsd: 1.2, stock: 50 },
  { barcode: 'ABC123XYZ', name: 'Caja genérica', brand: 'Genérica', department: 'Varios', unit: 'unidad', costUsd: 0.5, stock: 5 },
];

describe('filterProducts', () => {
  it('returns everything for an empty query', () => {
    expect(filterProducts(products, '')).toHaveLength(3);
    expect(filterProducts(products, '   ')).toHaveLength(3);
  });

  it('matches on name, case-insensitively', () => {
    expect(filterProducts(products, 'leche')).toEqual([products[0]]);
    expect(filterProducts(products, 'LECHE')).toEqual([products[0]]);
  });

  it('matches on brand and on barcode', () => {
    expect(filterProducts(products, 'primor')).toEqual([products[1]]);
    expect(filterProducts(products, '7591234')).toEqual([products[0]]);
  });

  it('matches a letter-bearing barcode regardless of case', () => {
    expect(filterProducts(products, 'abc123')).toEqual([products[2]]);
    expect(filterProducts(products, 'ABC123')).toEqual([products[2]]);
  });

  it('matches on a partial word anywhere in the name', () => {
    expect(filterProducts(products, 'entera')).toEqual([products[0]]);
  });

  it('returns nothing when nothing matches', () => {
    expect(filterProducts(products, 'zzz')).toEqual([]);
  });
});
