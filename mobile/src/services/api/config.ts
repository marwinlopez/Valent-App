import { apiFetch, ApiRequestError } from './client';
import type { BcvRateResponse, MarginRule } from '../../types/api';

/**
 * Returns null when no rate is set for today. A missing rate is an ordinary
 * state (nobody has entered it yet), not an error — the pricing function
 * reports it as a missing input and the screens say so.
 */
export async function getBcvRate(): Promise<BcvRateResponse | null> {
  try {
    return await apiFetch<BcvRateResponse>('/bcv-rate');
  } catch (err) {
    if (err instanceof ApiRequestError && err.statusCode === 404) {
      return null;
    }
    throw err;
  }
}

export async function getMargins(): Promise<MarginRule[]> {
  return apiFetch<MarginRule[]>('/margins');
}
