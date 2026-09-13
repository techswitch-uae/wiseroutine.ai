CREATE TABLE social_handoffs (
  id TEXT PRIMARY KEY NOT NULL,
  claim_hash TEXT NOT NULL,
  proof_hash TEXT,
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  token TEXT,
  reason TEXT,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL
);
CREATE UNIQUE INDEX social_handoffs_claim ON social_handoffs(claim_hash);
CREATE INDEX social_handoffs_expiry ON social_handoffs(expires_at);
