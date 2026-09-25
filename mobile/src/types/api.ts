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
  costUsd: number | null;
  stock: number | null;
}

// Requests, unlike the `Product` the backend hands back, always carry a
// validated number here — the screens that build these already reject a
// blank/non-numeric cost or stock before calling the mutation.
export type CreateProductRequest = Omit<Product, 'costUsd' | 'stock'> & { costUsd: number; stock: number };
export type UpdateProductRequest = Omit<Product, 'barcode' | 'stock' | 'costUsd'> & { costUsd: number };

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

/** snake_case because that is what this backend endpoint actually returns —
 *  its response casing is inconsistent across endpoints and normalising it is
 *  tracked as backend debt, not papered over here. */
export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  loyalty_level_id: string | null;
  current_debt_balance: number;
}

export interface CreditCheckResponse {
  approved: boolean;
  availableCredit: number;
  reason: string | null;
}

export type PaymentMethod =
  | 'EFECTIVO_USD'
  | 'EFECTIVO_VES'
  | 'PAGO_MOVIL'
  | 'PUNTO_DE_VENTA'
  | 'CREDITO';

export interface SaleItem {
  barcode: string;
  name: string;
  quantity: number;
  unitPriceUsd: number;
}

export interface CreateSaleRequest {
  customerId?: string;
  items: SaleItem[];
  totalUsd: number;
  totalVes: number;
  paymentMethod: PaymentMethod;
  bcvRateUsed: number;
}
