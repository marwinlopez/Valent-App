import jwt from 'jsonwebtoken';

export type DeviceRole = 'ADMIN' | 'INVENTARIO' | 'POST_VENTA' | 'CLIENTE_PEDIDOS';

export interface DeviceTokenPayload {
  deviceId: string;
  accountId: string;
  role: DeviceRole;
}

export function signDeviceToken(payload: DeviceTokenPayload, secret: string): string {
  return jwt.sign(payload, secret, { expiresIn: '30d' });
}

export function verifyDeviceToken(token: string, secret: string): DeviceTokenPayload {
  const decoded = jwt.verify(token, secret);
  if (typeof decoded === 'string') {
    throw new Error('Invalid token payload');
  }
  const { deviceId, accountId, role } = decoded as Record<string, unknown>;
  if (typeof deviceId !== 'string' || typeof accountId !== 'string' || typeof role !== 'string') {
    throw new Error('Invalid token payload');
  }
  return { deviceId, accountId, role: role as DeviceRole };
}
