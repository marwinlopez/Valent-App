import { renderHook, act } from '@testing-library/react-native';
import { useCart } from '../../src/hooks/useCart';
import type { Product } from '../../src/types/api';

const leche: Product = {
  barcode: '123', name: 'Leche', brand: 'X', department: 'Lacteos',
  unit: 'unidad', costUsd: 2, stock: 10,
};
const arroz: Product = {
  barcode: '456', name: 'Arroz', brand: 'Y', department: 'Granos',
  unit: 'kg', costUsd: 1, stock: 50,
};

describe('useCart', () => {
  it('starts empty', async () => {
    const { result } = await renderHook(() => useCart());
    expect(result.current.lines).toEqual([]);
  });

  it('adds a product with quantity 1', async () => {
    const { result } = await renderHook(() => useCart());
    await act(async () => {
      result.current.add(leche);
    });
    expect(result.current.lines).toEqual([{ product: leche, quantity: 1 }]);
  });

  it('increments instead of duplicating when the same product is added again', async () => {
    const { result } = await renderHook(() => useCart());
    await act(async () => {
      result.current.add(leche);
    });
    await act(async () => {
      result.current.add(leche);
    });
    expect(result.current.lines).toHaveLength(1);
    expect(result.current.lines[0].quantity).toBe(2);
  });

  it('refreshes the product on a repeat scan instead of keeping the stale one', async () => {
    const { result } = await renderHook(() => useCart());
    await act(async () => {
      result.current.add(leche);
    });
    const revisedLeche: Product = { ...leche, costUsd: 2.5 };
    await act(async () => {
      result.current.add(revisedLeche);
    });
    expect(result.current.lines).toEqual([{ product: revisedLeche, quantity: 2 }]);
  });

  it('keeps separate lines for different products', async () => {
    const { result } = await renderHook(() => useCart());
    await act(async () => {
      result.current.add(leche);
    });
    await act(async () => {
      result.current.add(arroz);
    });
    expect(result.current.lines).toHaveLength(2);
  });

  it('sets a quantity directly', async () => {
    const { result } = await renderHook(() => useCart());
    await act(async () => {
      result.current.add(leche);
    });
    await act(async () => {
      result.current.setQuantity('123', 5);
    });
    expect(result.current.lines[0].quantity).toBe(5);
  });

  it.each([NaN, Infinity, 1.5])('leaves the line unchanged for a non-integer quantity (%p)', async (quantity) => {
    const { result } = await renderHook(() => useCart());
    await act(async () => {
      result.current.add(leche);
    });
    await act(async () => {
      result.current.setQuantity('123', quantity);
    });
    expect(result.current.lines).toEqual([{ product: leche, quantity: 1 }]);
  });

  it('removes the line when a quantity drops to zero or below', async () => {
    const { result } = await renderHook(() => useCart());
    await act(async () => {
      result.current.add(leche);
    });
    await act(async () => {
      result.current.setQuantity('123', 0);
    });
    expect(result.current.lines).toEqual([]);
  });

  it('removes a line and clears the cart', async () => {
    const { result } = await renderHook(() => useCart());
    await act(async () => {
      result.current.add(leche);
    });
    await act(async () => {
      result.current.add(arroz);
    });
    await act(async () => {
      result.current.remove('123');
    });
    expect(result.current.lines).toHaveLength(1);
    await act(async () => {
      result.current.clear();
    });
    expect(result.current.lines).toEqual([]);
  });
});
