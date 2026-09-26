import PQueue from 'p-queue';
import { ApiError } from '../plugins/errorHandler.js';

const MAX_ATTEMPTS = 3;

type Task<T> = () => Promise<T>;

interface RetryableError {
  response?: { status?: number };
  code?: number;
}

/**
 * Whether an error is a transient Sheets problem (429/5xx) worth retrying.
 *
 * Exported (not just `SheetsQueue`-private) so a write that must be retried
 * on its own -- outside `enqueue`, e.g. one line of a multi-line stock
 * decrement in `sales/routes.ts` -- uses the exact same classification
 * instead of a second, possibly-drifting copy of it.
 */
export function isRetryableSheetsError(err: unknown): boolean {
  const e = err as RetryableError;
  const status = e.response?.status ?? e.code;
  return status === 429 || (typeof status === 'number' && status >= 500);
}

export class SheetsQueue {
  private queues = new Map<string, PQueue>();

  async enqueue<T>(accountId: string, task: Task<T>): Promise<T> {
    const queue = this.queueFor(accountId);
    const result = await queue.add(() => this.withRetry(task));
    return result as T;
  }

  private queueFor(accountId: string): PQueue {
    let queue = this.queues.get(accountId);
    if (!queue) {
      queue = new PQueue({ concurrency: 1 });
      this.queues.set(accountId, queue);
    }
    return queue;
  }

  private async withRetry<T>(task: Task<T>, attempt = 1): Promise<T> {
    try {
      return await task();
    } catch (err) {
      if (this.isRetryable(err)) {
        if (attempt < MAX_ATTEMPTS) {
          const delayMs = 2 ** attempt * 50;
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          return this.withRetry(task, attempt + 1);
        }
        // A 429/5xx that survived every retry is a transient Sheets
        // contention problem, not a bug in this server: the spec maps it to
        // 409 so clients can tell it apart from a genuine 500 and retry.
        throw new ApiError(409, 'SHEETS_CONFLICT', 'Could not complete the Sheets operation after retries');
      }
      // A non-retryable error is a different failure class (bad range, bad
      // payload, an ApiError thrown by the task itself) -- pass it through
      // untouched.
      throw err;
    }
  }

  private isRetryable(err: unknown): boolean {
    return isRetryableSheetsError(err);
  }
}
