CREATE TABLE invite_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id),
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'INVENTARIO', 'POST_VENTA', 'CLIENTE_PEDIDOS')),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_by_device_id UUID REFERENCES devices(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
