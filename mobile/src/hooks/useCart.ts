import { useCallback, useState } from 'react';
import type { CartLine } from '../services/cart';
import type { Product } from '../types/api';

export function useCart() {
  const [lines, setLines] = useState<CartLine[]>([]);

  /** Adding a product already in the cart bumps its quantity — scanning the
   *  same item twice is one line of two, not two lines of one. */
  const add = useCallback((product: Product) => {
    setLines((current) => {
      const existing = current.find((line) => line.product.barcode === product.barcode);
      if (!existing) {
        return [...current, { product, quantity: 1 }];
      }
      return current.map((line) =>
        line.product.barcode === product.barcode
          ? { product, quantity: line.quantity + 1 }
          : line
      );
    });
  }, []);

  const setQuantity = useCallback((barcode: string, quantity: number) => {
    // ponytail: integer quantities only, because `round2(unitPrice * quantity)`
    // in cart.ts is a float multiply that lands a céntimo low on fractional
    // quantities (5358/200k probes). Nothing in this sub-project produces a
    // fractional quantity (Task 6 uses +/- buttons), so this guard makes that
    // case unreachable rather than correct. Non-finite (NaN, Infinity) also
    // fails Number.isInteger, so this covers both. Selling by weight needs the
    // multiply moved into pricing.ts's BigInt path, not just a relaxed guard —
    // Product.unit already carries 'kg' for the next person to notice.
    if (!Number.isInteger(quantity)) {
      return;
    }
    setLines((current) =>
      quantity <= 0
        ? current.filter((line) => line.product.barcode !== barcode)
        : current.map((line) => (line.product.barcode === barcode ? { ...line, quantity } : line))
    );
  }, []);

  const remove = useCallback((barcode: string) => {
    setLines((current) => current.filter((line) => line.product.barcode !== barcode));
  }, []);

  const clear = useCallback(() => setLines([]), []);

  return { lines, add, setQuantity, remove, clear };
}
