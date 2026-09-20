CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'basic',
  device_limit INTEGER NOT NULL DEFAULT 3,
  spreadsheet_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id),
  hardware_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'INVENTARIO', 'POST_VENTA', 'CLIENTE_PEDIDOS')),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'REVOKED')),
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, hardware_id)
);

CREATE TABLE bcv_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id),
  rate_date DATE NOT NULL,
  rate NUMERIC(12, 4) NOT NULL,
  created_by_device_id UUID REFERENCES devices(id),
  UNIQUE (account_id, rate_date)
);

CREATE TABLE margin_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id),
  level TEXT NOT NULL CHECK (level IN ('CATEGORIA', 'SUBCATEGORIA', 'DEPARTAMENTO')),
  level_name TEXT NOT NULL,
  percentage NUMERIC(6, 2) NOT NULL,
  UNIQUE (account_id, level, level_name)
);

CREATE TABLE loyalty_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  credit_limit NUMERIC(12, 2) NOT NULL,
  max_payment_term_days INTEGER NOT NULL,
  UNIQUE (account_id, name)
);

CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  phone TEXT,
  loyalty_level_id UUID REFERENCES loyalty_levels(id),
  current_debt_balance NUMERIC(12, 2) NOT NULL DEFAULT 0
);

CREATE TABLE customer_qr_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id),
  device_id UUID REFERENCES devices(id),
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
