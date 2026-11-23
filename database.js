const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL fehlt. PostgreSQL-Verbindung in Render konfigurieren.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

pool.on("error", err => console.error("PostgreSQL Pool error:", err));

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE,
      email_verified BOOLEAN NOT NULL DEFAULT FALSE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT UNIQUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;
    CREATE TABLE IF NOT EXISTS email_action_tokens (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      purpose TEXT NOT NULL CHECK (purpose IN ('verify','reset')),
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS email_action_tokens_user_purpose ON email_action_tokens(user_id,purpose);
    CREATE TABLE IF NOT EXISTS chats (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT 'Neuer Chat',
      history TEXT NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS chats_user_updated ON chats(user_id, updated_at);
    CREATE TABLE IF NOT EXISTS support_tickets(id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,subject TEXT NOT NULL,message TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',admin_reply TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP);
    CREATE INDEX IF NOT EXISTS tickets_user_updated ON support_tickets(user_id,updated_at);
    CREATE TABLE IF NOT EXISTS user_message_usage (user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, usage_date DATE NOT NULL DEFAULT CURRENT_DATE, message_count INTEGER NOT NULL DEFAULT 0, blocked_until TIMESTAMPTZ);
    CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO app_settings(key,value) VALUES ('maintenance_enabled','false') ON CONFLICT(key) DO NOTHING;
    INSERT INTO app_settings(key,value) VALUES ('daily_message_limit','30') ON CONFLICT(key) DO NOTHING;
    INSERT INTO app_settings(key,value) VALUES ('maintenance_message','TILLBOT wird gerade gewartet. Bitte später erneut versuchen.') ON CONFLICT(key) DO NOTHING;
    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      instructions TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT 'openai/gpt-oss-120b',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS feature_flags (
      key TEXT PRIMARY KEY,
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      description TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO feature_flags(key,enabled,description) VALUES
      ('voice_mode',TRUE,'Browser-Sprachsteuerung'),
      ('code_mode',TRUE,'Programmiermodus'),
      ('file_analysis',TRUE,'Datei- und Bildanalyse'),
      ('image_generation',FALSE,'Bildgenerierung – externer Anbieter erforderlich'),
      ('web_search',FALSE,'Websuche – Suchanbieter erforderlich'),
      ('workspaces',TRUE,'Projekt-Workspaces'),
      ('memory',TRUE,'Persönliche Erinnerungen'),
      ('public_api',FALSE,'Externe API – Schlüsselverwaltung erforderlich')
    ON CONFLICT(key) DO NOTHING;
    CREATE TABLE IF NOT EXISTS system_error_logs (
      id BIGSERIAL PRIMARY KEY,
      level TEXT NOT NULL DEFAULT 'error',
      source TEXT NOT NULL DEFAULT 'server',
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS system_error_recent ON system_error_logs(created_at DESC);
    CREATE TABLE IF NOT EXISTS admin_permission_overrides (
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      permission_key TEXT NOT NULL CHECK(permission_key IN ('users','support','features','system')),
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id,permission_key)
    );
    CREATE TABLE IF NOT EXISTS admin_activity_log (
      id BIGSERIAL PRIMARY KEY,
      actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS admin_activity_recent ON admin_activity_log(created_at DESC);
    CREATE TABLE IF NOT EXISTS daily_usage_stats (
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      usage_date DATE NOT NULL,
      message_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(user_id,usage_date)
    );
    CREATE INDEX IF NOT EXISTS daily_usage_date ON daily_usage_stats(usage_date);
    CREATE TABLE IF NOT EXISTS user_memories (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT 'Erinnerung',
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS user_memories_user ON user_memories(user_id,updated_at DESC);
    CREATE TABLE IF NOT EXISTS workspaces (
      id BIGSERIAL PRIMARY KEY,
      owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS workspace_members (
      workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('owner','member')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(workspace_id,user_id)
    );
    CREATE INDEX IF NOT EXISTS workspace_members_user ON workspace_members(user_id);
    CREATE TABLE IF NOT EXISTS studio_announcements (
      id BIGSERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'update',
      level TEXT NOT NULL DEFAULT 'info',
      published BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS studio_announcements_recent ON studio_announcements(published,created_at DESC);
  `);
}

module.exports = { pool, initDatabase };
