import type { Product } from '../types/api';

/** Case-insensitive substring match across the fields someone would actually
 *  type: what it's called, who makes it, and the code on the package. */
export function filterProducts(products: Product[], query: string): Product[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return products;
  }
  return products.filter(
    (p) =>
      p.name.toLowerCase().includes(needle) ||
      p.brand.toLowerCase().includes(needle) ||
      p.barcode.includes(needle)
  );
}
