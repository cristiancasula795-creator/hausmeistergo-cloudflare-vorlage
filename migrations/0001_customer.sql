-- First step for a new, empty customer database. Apply schema.sql afterwards.
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tenant_memberships (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS records (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  employee TEXT NOT NULL,
  body TEXT NOT NULL,
  revision INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  PRIMARY KEY (tenant_id, collection, id)
);

CREATE TABLE IF NOT EXISTS photo_chunks (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  photo_key TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, photo_key, chunk_index)
);

CREATE TABLE IF NOT EXISTS tenant_storage_usage (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS security_events (
  id TEXT PRIMARY KEY,
  actor_key TEXT NOT NULL,
  event TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS login_throttles (
  login_key TEXT PRIMARY KEY,
  failures INTEGER NOT NULL,
  first_failed_at INTEGER NOT NULL,
  last_failed_at INTEGER NOT NULL,
  locked_until INTEGER NOT NULL
);
