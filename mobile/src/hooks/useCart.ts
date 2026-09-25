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
        line.product.barcode === product.barcode ? { ...line, quantity: line.quantity + 1 } : line
      );
    });
  }, []);

  const setQuantity = useCallback((barcode: string, quantity: number) => {
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
