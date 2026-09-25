jest.mock('../../../src/services/api/client', () => ({
  ...jest.requireActual('../../../src/services/api/client'),
  apiFetch: jest.fn(),
}));

import { apiFetch, ApiRequestError } from '../../../src/services/api/client';
import { getBcvRate, getMargins } from '../../../src/services/api/config';

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
});
