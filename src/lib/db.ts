export type AppDb = {
  close: () => void
  exec: (sql: string) => void
  prepare: (sql: string) => any
}

const isNodeRuntime = () =>
  typeof process !== 'undefined' && !!(process as any)?.versions?.node && !(process as any)?.env?.NEXT_RUNTIME

const getEnv = (key: string) => {
  try {
    if (typeof process !== 'undefined' && (process as any)?.env?.[key] != null) return String((process as any).env[key])
  } catch {}
  return undefined
}

const ensureDirForFile = async (filePath: string) => {
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  await fs.mkdir(path.dirname(filePath), { recursive: true })
}

const migrate = (db: any) => {
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=NORMAL;
    PRAGMA foreign_keys=ON;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked_at INTEGER,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      sort_order INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bans (
      type TEXT NOT NULL,
      value TEXT NOT NULL,
      reason TEXT,
      created_at INTEGER NOT NULL,
      created_by TEXT NOT NULL,
      expires_at INTEGER,
      PRIMARY KEY(type, value)
    );

    CREATE TABLE IF NOT EXISTS security_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      enabled INTEGER NOT NULL,
      ban_seconds INTEGER NOT NULL,
      rate_enabled INTEGER NOT NULL,
      rate_window_seconds INTEGER NOT NULL,
      rate_max_requests INTEGER NOT NULL,
      scan_enabled INTEGER NOT NULL,
      scan_window_seconds INTEGER NOT NULL,
      scan_max_hits INTEGER NOT NULL,
      ref_enabled INTEGER NOT NULL,
      ref_window_seconds INTEGER NOT NULL,
      ref_max_requests INTEGER NOT NULL,
      registration_enabled INTEGER NOT NULL,
      cleanup_enabled INTEGER NOT NULL DEFAULT 1,
      events_retention_days INTEGER NOT NULL DEFAULT 14,
      top_retention_days INTEGER NOT NULL DEFAULT 7,
      traffic_enabled INTEGER NOT NULL DEFAULT 0,
      traffic_retention_days INTEGER NOT NULL DEFAULT 30
    );

    INSERT OR IGNORE INTO security_settings (
      id,
      enabled,
      ban_seconds,
      rate_enabled,
      rate_window_seconds,
      rate_max_requests,
      scan_enabled,
      scan_window_seconds,
      scan_max_hits,
      ref_enabled,
      ref_window_seconds,
      ref_max_requests,
      registration_enabled
    ) VALUES (1, 1, 3600, 1, 60, 240, 1, 60, 8, 1, 60, 180, 0);

    CREATE TABLE IF NOT EXISTS site_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      footer_text TEXT NOT NULL DEFAULT '',
      footer_format TEXT NOT NULL DEFAULT 'text',
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      announcement_format TEXT NOT NULL DEFAULT 'text',
      favicon_url TEXT NOT NULL DEFAULT '',
      logo_url TEXT NOT NULL DEFAULT ''
    );

    INSERT OR IGNORE INTO site_settings (id, footer_text) VALUES (1, '');

    CREATE TABLE IF NOT EXISTS site_assets (
      kind TEXT PRIMARY KEY,
      mime TEXT NOT NULL,
      data BLOB NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS security_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      kind TEXT NOT NULL,
      ip TEXT,
      domain TEXT,
      path TEXT,
      detail TEXT
    );

    CREATE TABLE IF NOT EXISTS traffic_hourly (
      bucket_start INTEGER PRIMARY KEY,
      bytes INTEGER NOT NULL DEFAULT 0,
      requests INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS traffic_ip (
      ip TEXT PRIMARY KEY,
      bytes INTEGER NOT NULL DEFAULT 0,
      requests INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS traffic_domain (
      domain TEXT PRIMARY KEY,
      bytes INTEGER NOT NULL DEFAULT 0,
      requests INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS traffic_ip_hourly (
      ip TEXT NOT NULL,
      bucket_start INTEGER NOT NULL,
      bytes INTEGER NOT NULL DEFAULT 0,
      requests INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(ip, bucket_start)
    );

    CREATE TABLE IF NOT EXISTS traffic_domain_hourly (
      domain TEXT NOT NULL,
      bucket_start INTEGER NOT NULL,
      bytes INTEGER NOT NULL DEFAULT 0,
      requests INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(domain, bucket_start)
    );
  `)

  const alters = [
    `ALTER TABLE site_settings ADD COLUMN title TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE site_settings ADD COLUMN description TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE site_settings ADD COLUMN footer_format TEXT NOT NULL DEFAULT 'text'`,
    `ALTER TABLE site_settings ADD COLUMN announcement_format TEXT NOT NULL DEFAULT 'text'`,
    `ALTER TABLE site_settings ADD COLUMN favicon_url TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE site_settings ADD COLUMN logo_url TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE security_settings ADD COLUMN cleanup_enabled INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE security_settings ADD COLUMN events_retention_days INTEGER NOT NULL DEFAULT 14`,
    `ALTER TABLE security_settings ADD COLUMN top_retention_days INTEGER NOT NULL DEFAULT 7`,
    `ALTER TABLE security_settings ADD COLUMN traffic_enabled INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE security_settings ADD COLUMN traffic_retention_days INTEGER NOT NULL DEFAULT 30`
  ]
  for (const sql of alters) {
    try {
      db.exec(sql)
    } catch {}
  }
}

export const openAppDb = async (opts?: { dbPath?: string }) => {
  if (!isNodeRuntime()) throw new Error('node_runtime_required')
  const dbPath = opts?.dbPath || getEnv('DB_PATH') || './data/app.db'
  await ensureDirForFile(dbPath)
  const mod = await import('better-sqlite3')
  const BetterSqlite3 = (mod as any).default ?? (mod as any)
  const db = new BetterSqlite3(dbPath)
  migrate(db)
  return db as AppDb
}
