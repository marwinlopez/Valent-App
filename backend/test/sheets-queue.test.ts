import { describe, it, expect, vi } from 'vitest';
import { SheetsQueue } from '../src/sheets/queue';

describe('SheetsQueue', () => {
  it('runs tasks for the same account one at a time, in order', async () => {
    const queue = new SheetsQueue();
    const order: number[] = [];

    const task = (n: number, delay: number) => async () => {
      await new Promise((r) => setTimeout(r, delay));
      order.push(n);
      return n;
    };

    const results = await Promise.all([
      queue.enqueue('acc-1', task(1, 20)),
      queue.enqueue('acc-1', task(2, 5)),
      queue.enqueue('acc-1', task(3, 1)),
    ]);

    expect(order).toEqual([1, 2, 3]);
    expect(results).toEqual([1, 2, 3]);
  });

  it('runs tasks for different accounts concurrently', async () => {
    const queue = new SheetsQueue();
    const start = Date.now();

    await Promise.all([
      queue.enqueue('acc-1', () => new Promise((r) => setTimeout(r, 50))),
      queue.enqueue('acc-2', () => new Promise((r) => setTimeout(r, 50))),
    ]);

    expect(Date.now() - start).toBeLessThan(90);
  });

  it('retries on a 429-like error and eventually succeeds', async () => {
    const queue = new SheetsQueue();
    let attempts = 0;
    const flaky = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) {
        const err = new Error('rate limited') as Error & { response: { status: number } };
        err.response = { status: 429 };
        throw err;
      }
      return 'ok';
    });

    const result = await queue.enqueue('acc-1', flaky);
    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('does not retry a non-retryable error', async () => {
    const queue = new SheetsQueue();
    const failing = vi.fn(async () => {
      throw new Error('validation error');
    });

    await expect(queue.enqueue('acc-1', failing)).rejects.toThrow('validation error');
    expect(failing).toHaveBeenCalledTimes(1);
  });
});
