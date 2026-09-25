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

export interface Product {
  barcode: string;
  name: string;
  brand: string;
  department: string;
  unit: string;
  costUsd: number;
  stock: number;
}

export type CreateProductRequest = Product;
export type UpdateProductRequest = Omit<Product, 'barcode' | 'stock'>;

export interface BcvRateResponse {
  rateDate: string;
  rate: number;
}

/** snake_case because that is what the backend actually returns here — its
 *  response casing is inconsistent across endpoints and normalising it is
 *  tracked as backend debt, not something this module papers over. */
export interface MarginRule {
  id: string;
  level: 'CATEGORIA' | 'SUBCATEGORIA' | 'DEPARTAMENTO';
  level_name: string;
  percentage: number;
}
