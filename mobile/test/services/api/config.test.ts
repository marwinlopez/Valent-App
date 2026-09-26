jest.mock('../../../src/services/api/client', () => ({
  ...jest.requireActual('../../../src/services/api/client'),
  apiFetch: jest.fn(),
}));

import { apiFetch, ApiRequestError } from '../../../src/services/api/client';
import { getBcvRate, getMargins, putBcvRate, upsertMargin, todayRateDate } from '../../../src/services/api/config';

describe('config api', () => {
  beforeEach(() => {
    (apiFetch as jest.Mock).mockReset();
  });

  it('getBcvRate resolves to the parsed rate', async () => {
    (apiFetch as jest.Mock).mockResolvedValue({ rateDate: '2026-09-24', rate: 40 });

    await expect(getBcvRate()).resolves.toEqual({ rateDate: '2026-09-24', rate: 40 });
    expect(apiFetch).toHaveBeenCalledWith('/bcv-rate');
  });

  it('getBcvRate resolves to null on a 404 (no rate set for today)', async () => {
    (apiFetch as jest.Mock).mockRejectedValue(
      new ApiRequestError(404, 'RATE_NOT_FOUND', 'No rate for today')
    );

    await expect(getBcvRate()).resolves.toBeNull();
  });

  it('getBcvRate rejects on a non-404 ApiRequestError, never silently reading it as "no rate"', async () => {
    (apiFetch as jest.Mock).mockRejectedValue(
      new ApiRequestError(500, 'INTERNAL_ERROR', 'Server exploded')
    );

    await expect(getBcvRate()).rejects.toThrow(ApiRequestError);
  });

  it('getBcvRate rejects on a non-ApiRequestError failure (e.g. a network error)', async () => {
    (apiFetch as jest.Mock).mockRejectedValue(new TypeError('Network request failed'));

    await expect(getBcvRate()).rejects.toThrow(TypeError);
  });

  it('getMargins requests the margin rules', async () => {
    const rules = [{ id: '1', level: 'DEPARTAMENTO', level_name: 'Lacteos', percentage: 25 }];
    (apiFetch as jest.Mock).mockResolvedValue(rules);

    await expect(getMargins()).resolves.toEqual(rules);
    expect(apiFetch).toHaveBeenCalledWith('/margins');
  });

  it('putBcvRate sends the date and rate the backend requires', async () => {
    (apiFetch as jest.Mock).mockResolvedValue({ rateDate: '2026-09-26', rate: 36.5 });

    await expect(putBcvRate('2026-09-26', 36.5)).resolves.toEqual({ rateDate: '2026-09-26', rate: 36.5 });
    expect(apiFetch).toHaveBeenCalledWith('/bcv-rate', {
      method: 'PUT',
      body: JSON.stringify({ rateDate: '2026-09-26', rate: 36.5 }),
    });
  });

  it('upsertMargin always creates a DEPARTAMENTO rule, the only level anything can match', async () => {
    const rule = { id: '1', level: 'DEPARTAMENTO', level_name: 'Lacteos', percentage: 30 };
    (apiFetch as jest.Mock).mockResolvedValue(rule);

    await expect(upsertMargin('Lacteos', 30)).resolves.toEqual(rule);
    expect(apiFetch).toHaveBeenCalledWith('/margins', {
      method: 'POST',
      body: JSON.stringify({ level: 'DEPARTAMENTO', levelName: 'Lacteos', percentage: 30 }),
    });
  });

  it('todayRateDate derives the date in UTC, exactly as GET /bcv-rate does', () => {
    // 21:00 on the 26th in Caracas (UTC-4) is 01:00 on the 27th in UTC. The
    // backend reads "today" as the 27th, so the rate has to be written for the
    // 27th too — a local-time date would write it for the 26th and the
    // register would report that no rate is set.
    expect(todayRateDate(new Date('2026-09-27T01:00:00Z'))).toBe('2026-09-27');
    expect(todayRateDate(new Date('2026-09-26T12:00:00Z'))).toBe('2026-09-26');
  });
});
