import jwt from 'jsonwebtoken';

export interface QrTokenPayload {
  customerId: string;
  accountId: string;
}

export function signQrToken(payload: QrTokenPayload, secret: string): string {
  return jwt.sign(payload, secret, { expiresIn: '15m' });
}

export function verifyQrToken(token: string, secret: string): QrTokenPayload {
  const decoded = jwt.verify(token, secret);
  if (typeof decoded === 'string') {
    throw new Error('Invalid QR token payload');
  }
  const { customerId, accountId } = decoded as Record<string, unknown>;
  if (typeof customerId !== 'string' || typeof accountId !== 'string') {
    throw new Error('Invalid QR token payload');
  }
  return { customerId, accountId };
}
