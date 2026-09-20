export type DeviceRole = 'ADMIN' | 'INVENTARIO' | 'POST_VENTA' | 'CLIENTE_PEDIDOS';
export type DeviceStatus = 'PENDING' | 'ACTIVE' | 'REVOKED';

export interface AuthMeResponse {
  role: DeviceRole;
  status: DeviceStatus;
  accountId: string;
  jwt?: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}
