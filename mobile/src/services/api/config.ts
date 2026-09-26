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

/**
 * The date a rate is saved for. It MUST be derived exactly as the backend
 * derives "today" in GET /bcv-rate (and in the sale audit): the UTC date.
 *
 * Do not "fix" this to local time. From 20:00 to midnight in Caracas (UTC-4)
 * the local date is one day behind the UTC one, so a local-time date would
 * write the rate for yesterday-in-UTC while the register reads today-in-UTC —
 * four hours every evening in which the register reports no rate set.
 *
 * `now` is a parameter only so a test can pin the rollover.
 */
export function todayRateDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export async function putBcvRate(rateDate: string, rate: number): Promise<BcvRateResponse> {
  return apiFetch<BcvRateResponse>('/bcv-rate', {
    method: 'PUT',
    body: JSON.stringify({ rateDate, rate }),
  });
}

/**
 * Always a DEPARTAMENTO rule. The endpoint also accepts CATEGORIA and
 * SUBCATEGORIA, but a product row carries a department and nothing else a rule
 * could match on, so any other level would be configuration that silently does
 * nothing. POST /margins upserts, so this both creates and updates.
 */
export async function upsertMargin(levelName: string, percentage: number): Promise<MarginRule> {
  return apiFetch<MarginRule>('/margins', {
    method: 'POST',
    body: JSON.stringify({ level: 'DEPARTAMENTO', levelName, percentage }),
  });
}
