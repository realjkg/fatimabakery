CREATE TABLE IF NOT EXISTS square_events (
  event_id TEXT PRIMARY KEY,
  type TEXT,
  merchant_id TEXT,
  payment_id TEXT,
  raw_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lease_until TEXT,
  acked_at TEXT,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_square_events_status_received
ON square_events(status, received_at);
