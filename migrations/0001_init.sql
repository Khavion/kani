-- 0001_init: core Kani schema (SQLite dialect, written to port cleanly to Postgres).
-- Timestamps are ISO 8601 UTC strings. Booleans are INTEGER 0/1.

CREATE TABLE tenants (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  pack_id             TEXT NOT NULL,
  phone               TEXT NOT NULL,
  address             TEXT NOT NULL,
  hours_json          TEXT NOT NULL,
  staff_json          TEXT NOT NULL,
  services_json       TEXT NOT NULL,
  pix_key             TEXT NOT NULL,
  google_review_link  TEXT NOT NULL,
  settings_json       TEXT NOT NULL DEFAULT '{}',
  created_at          TEXT NOT NULL
);

CREATE TABLE contacts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  wa_name         TEXT NOT NULL,
  phone           TEXT NOT NULL,
  memory_summary  TEXT,
  opt_out         INTEGER NOT NULL DEFAULT 0,
  profile_json    TEXT NOT NULL DEFAULT '{}',
  created_at      TEXT NOT NULL,
  UNIQUE (tenant_id, phone)
);

CREATE TABLE conversations (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id        TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id       INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'bot' CHECK (status IN ('bot', 'human', 'closed')),
  last_msg_at      TEXT,
  low_conf_streak  INTEGER NOT NULL DEFAULT 0,
  disclosed        INTEGER NOT NULL DEFAULT 0,
  pending_note     TEXT,
  created_at       TEXT NOT NULL
);
CREATE INDEX idx_conversations_tenant ON conversations (tenant_id, last_msg_at);
CREATE INDEX idx_conversations_contact ON conversations (contact_id);

CREATE TABLE messages (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id  INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role             TEXT NOT NULL CHECK (role IN ('customer', 'assistant', 'owner')),
  type             TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'audio', 'image')),
  text             TEXT,
  transcript       TEXT,
  media_path       TEXT,
  latency_ms       INTEGER,
  status           TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'read')),
  meta_json        TEXT NOT NULL DEFAULT '{}',
  created_at       TEXT NOT NULL
);
CREATE INDEX idx_messages_conversation ON messages (conversation_id, id);

CREATE TABLE appointments (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id        TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id       INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  service          TEXT NOT NULL,
  staff            TEXT,
  starts_at        TEXT NOT NULL,
  ends_at          TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'confirmed', 'cancelled', 'no_show', 'done')),
  price            REAL,
  source           TEXT NOT NULL DEFAULT 'bot',
  conversation_id  INTEGER,
  created_at       TEXT NOT NULL
);
CREATE INDEX idx_appointments_tenant_time ON appointments (tenant_id, starts_at);
CREATE INDEX idx_appointments_contact ON appointments (contact_id);

CREATE TABLE quotes (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id            TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id           INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id      INTEGER,
  items_json           TEXT NOT NULL,
  total                REAL NOT NULL,
  status               TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'approved', 'rejected')),
  approval_message_id  INTEGER,
  created_at           TEXT NOT NULL
);

CREATE TABLE reminders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  appointment_id  INTEGER REFERENCES appointments(id) ON DELETE CASCADE,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id      INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  fire_at         TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('confirm_24h', 'confirm_2h', 'reactivation')),
  sent            INTEGER NOT NULL DEFAULT 0,
  sent_at         TEXT,
  response        TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_reminders_due ON reminders (sent, fire_at);

CREATE TABLE escalations (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id  INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  reason           TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  resolved         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT,
  kind          TEXT NOT NULL,
  payload_json  TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_events_tenant_kind ON events (tenant_id, kind, created_at);
