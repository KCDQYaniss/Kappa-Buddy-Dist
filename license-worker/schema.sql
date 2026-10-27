-- Kappa Buddy — licence (D1 / SQLite)
-- Appliqué via : npx wrangler d1 execute kappa-license --file schema.sql --remote
-- On ne stocke JAMAIS de clé en clair ni d'IP : uniquement des hashes SHA-256.

CREATE TABLE IF NOT EXISTS licenses (
  key_hash     TEXT PRIMARY KEY,            -- SHA-256 hex de la download key itch
  itch_name    TEXT,                        -- pseudo itch si l'API le renvoie (optionnel)
  created_at   INTEGER NOT NULL,            -- ms epoch
  status       TEXT NOT NULL DEFAULT 'active',  -- active | revoked
  last_swap_at INTEGER NOT NULL DEFAULT 0   -- ms epoch du dernier swap
);

CREATE TABLE IF NOT EXISTS devices (
  key_hash      TEXT NOT NULL,
  device_hash   TEXT NOT NULL,             -- SHA-256 hex de l'empreinte machine
  label         TEXT,                      -- libellé libre fourni par l'app (ex. "PC fixe")
  bound_at      INTEGER NOT NULL,
  last_token_at INTEGER NOT NULL,
  PRIMARY KEY (key_hash, device_hash)
);

CREATE TABLE IF NOT EXISTS events (
  ts       INTEGER NOT NULL,               -- ms epoch
  key_hash TEXT NOT NULL,
  action   TEXT NOT NULL,                  -- activate | swap | swap_denied | revoked | unbind
  detail   TEXT
);

CREATE INDEX IF NOT EXISTS idx_devices_key ON devices (key_hash);
CREATE INDEX IF NOT EXISTS idx_events_key  ON events  (key_hash, ts);
