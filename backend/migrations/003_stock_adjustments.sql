-- Idempotency ledger for PATCH /products/:barcode/stock.
--
-- The Sheets queue re-runs a whole task on a 429/5xx (see sheets/queue.ts). A
-- stock adjustment is an accumulate, so a retry whose first write actually
-- landed would read the already-updated stock and add the delta a second
-- time. The client sends a requestId with each adjustment; this table is what
-- makes a replay of that id a no-op instead of a second apply.
--
-- prev_stock/new_stock are recorded (not just the id) so a retry can tell the
-- two ambiguous outcomes apart: if the sheet still reads prev_stock the write
-- never landed and is re-issued as an absolute value; if it reads anything
-- else the delta is already in, and nothing is written.
CREATE TABLE stock_adjustments (
  account_id UUID NOT NULL REFERENCES accounts(id),
  request_id TEXT NOT NULL,
  barcode TEXT NOT NULL,
  prev_stock NUMERIC(14, 4) NOT NULL,
  new_stock NUMERIC(14, 4) NOT NULL,
  device_id UUID REFERENCES devices(id),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Scoped by account: a request id from one tenant must never suppress
  -- another tenant's adjustment.
  PRIMARY KEY (account_id, request_id)
);
