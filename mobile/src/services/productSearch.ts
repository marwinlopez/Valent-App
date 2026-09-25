/* Pure catalog decisions over an already-fetched product list. No React here:
   these used to live in `hooks/` behind a `use` prefix, which is what
   eslint-plugin-react-hooks reads as "this follows the rules of hooks". */
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
      p.barcode.toLowerCase().includes(needle)
  );
}

/** The scan decision: a code already in the catalog opens that product, one
 *  that isn't starts creating it. Exact match, not a search — a barcode is the
 *  row key, and a substring hit on a different product would open the wrong
 *  one. The caller must know the catalog actually loaded: an empty list from a
 *  cold or failed query would answer "unknown" for every code. */
export function isKnownBarcode(products: Product[], barcode: string): boolean {
  return products.some((p) => p.barcode === barcode);
}
