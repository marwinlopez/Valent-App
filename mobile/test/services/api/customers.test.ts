jest.mock('../../../src/services/api/client', () => ({
  ...jest.requireActual('../../../src/services/api/client'),
  apiFetch: jest.fn(),
}));

import { apiFetch } from '../../../src/services/api/client';
import { listCustomers, checkCredit } from '../../../src/services/api/customers';

describe('customers api', () => {
  beforeEach(() => {
    (apiFetch as jest.Mock).mockReset().mockResolvedValue([]);
  });

  it('listCustomers requests the customer list', async () => {
    await listCustomers();
    expect(apiFetch).toHaveBeenCalledWith('/customers');
  });

  it('checkCredit passes the amount as a query parameter', async () => {
    (apiFetch as jest.Mock).mockResolvedValue({ approved: true, availableCredit: 100, reason: null });
    await checkCredit('cust-1', 42.5);
    expect(apiFetch).toHaveBeenCalledWith('/customers/cust-1/credit-check?amount=42.5');
  });

  it('encodes a customer id that needs escaping', async () => {
    (apiFetch as jest.Mock).mockResolvedValue({ approved: false, availableCredit: 0, reason: 'x' });
    await checkCredit('a/b', 1);
    expect(apiFetch).toHaveBeenCalledWith('/customers/a%2Fb/credit-check?amount=1');
  });
});
