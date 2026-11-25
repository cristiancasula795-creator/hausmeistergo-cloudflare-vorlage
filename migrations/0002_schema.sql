CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('operator','field')),
  salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS records (
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  employee TEXT NOT NULL,
  body TEXT NOT NULL,
  revision INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  PRIMARY KEY (collection,id)
);

CREATE TABLE IF NOT EXISTS photo_chunks (
  photo_key TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (photo_key,chunk_index)
);

CREATE TABLE IF NOT EXISTS user_recovery_emails (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  verified_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS password_resets (
  user_id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  requested_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS records_employee ON records(employee);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);

-- Platform-controlled product data is intentionally outside tenant backups.
-- A firm restore must never grant or revoke a subscription.
CREATE TABLE IF NOT EXISTS tenant_product_entitlements(
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN('legacy','trial','active','grace','suspended','cancelled')),
  user_limit INTEGER NOT NULL CHECK(user_limit>=1 AND user_limit<=10000),
  storage_limit_bytes INTEGER NOT NULL CHECK(storage_limit_bytes>=1048576 AND storage_limit_bytes<=4294967296),
  features_json TEXT NOT NULL DEFAULT '[]',
  trial_ends_at INTEGER NOT NULL DEFAULT 0,
  current_period_ends_at INTEGER NOT NULL DEFAULT 0,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0 CHECK(cancel_at_period_end IN(0,1)),
  support_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL
);

-- Content-free daily operational counters. These are platform metadata and
-- intentionally remain outside every tenant backup.
CREATE TABLE IF NOT EXISTS platform_email_usage(
  day TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN('activation','registration','reset','other')),
  accepted INTEGER NOT NULL DEFAULT 0 CHECK(accepted>=0),
  failed INTEGER NOT NULL DEFAULT 0 CHECK(failed>=0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(day,kind)
);

CREATE TABLE IF NOT EXISTS platform_operation_snapshots(
  day TEXT PRIMARY KEY,
  tenant_count INTEGER NOT NULL CHECK(tenant_count>=0),
  active_tenant_count INTEGER NOT NULL CHECK(active_tenant_count>=0),
  active_membership_count INTEGER NOT NULL CHECK(active_membership_count>=0),
  storage_bytes INTEGER NOT NULL CHECK(storage_bytes>=0),
  created_at INTEGER NOT NULL
);
