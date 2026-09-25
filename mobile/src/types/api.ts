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

export interface LinkDeviceRequest {
  inviteToken: string;
  hardwareId: string;
  deviceName: string;
}

/** Note: the backend returns neither `deviceId` nor `status` here. */
export interface LinkDeviceResponse {
  jwt: string;
  role: DeviceRole;
  accountId: string;
}

export interface CreateInviteResponse {
  inviteToken: string;
  role: DeviceRole;
  expiresAt: string;
}
