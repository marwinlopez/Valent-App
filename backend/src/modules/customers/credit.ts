export interface CreditCheckInput {
  currentDebtBalance: number;
  creditLimit: number;
  requestedAmount: number;
}

export interface CreditCheckResult {
  approved: boolean;
  availableCredit: number;
  reason: string | null;
}

export function evaluateCreditCheck(input: CreditCheckInput): CreditCheckResult {
  const availableCredit = Math.round((input.creditLimit - input.currentDebtBalance) * 100) / 100;

  if (!Number.isFinite(input.requestedAmount)) {
    return { approved: false, availableCredit, reason: 'Requested amount must be a valid number' };
  }
  if (input.requestedAmount <= 0) {
    return { approved: false, availableCredit, reason: 'Requested amount must be positive' };
  }
  if (availableCredit <= 0) {
    return { approved: false, availableCredit, reason: 'No available credit' };
  }
  if (input.requestedAmount > availableCredit) {
    return { approved: false, availableCredit, reason: 'Requested amount exceeds available credit' };
  }
  return { approved: true, availableCredit, reason: null };
}
