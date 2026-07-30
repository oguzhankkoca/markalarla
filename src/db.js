const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const dataDir = path.join(__dirname, "..", "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "app.sqlite"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT,
  company TEXT,
  offer_text TEXT,
  signature TEXT
);

CREATE TABLE IF NOT EXISTS brands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch TEXT NOT NULL,
  name TEXT NOT NULL,
  website TEXT,
  email TEXT,
  email_source TEXT,
  confidence TEXT DEFAULT 'unknown',
  status TEXT DEFAULT 'pending',
  last_error TEXT,
  sent_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS send_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

// Ayarlar için tek satır garanti et
db.prepare(
  "INSERT OR IGNORE INTO settings (id, name, company, offer_text, signature) VALUES (1, '', '', '', '')"
).run();

// Basit migration: eski veritabanlarında olmayan kolonları ekle.
// SQLite'ta "ADD COLUMN IF NOT EXISTS" olmadığı için mevcut kolonları kontrol ediyoruz.
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  const exists = cols.some((c) => c.name === column);
  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn("brands", "replied", "INTEGER DEFAULT 0");
ensureColumn("brands", "reply_sentiment", "TEXT");
ensureColumn("brands", "reply_snippet", "TEXT");
ensureColumn("brands", "reply_from", "TEXT");
ensureColumn("brands", "follow_up_sent_at", "TEXT"); // eski tek-aşamalı alan, geriye dönük uyumluluk için duruyor
ensureColumn("brands", "last_checked_at", "TEXT");
ensureColumn("brands", "follow_up_stage", "INTEGER DEFAULT 0");
ensureColumn("brands", "last_follow_up_at", "TEXT");
ensureColumn("brands", "deal_stage", "TEXT DEFAULT 'new'");
ensureColumn("brands", "notified", "INTEGER DEFAULT 0");

ensureColumn("settings", "followup_subject", "TEXT"); // eski tek-aşamalı şablon (aşama 1 için de kullanılır)
ensureColumn("settings", "followup_body", "TEXT");
ensureColumn("settings", "followup2_subject", "TEXT");
ensureColumn("settings", "followup2_body", "TEXT");
ensureColumn("settings", "followup3_subject", "TEXT");
ensureColumn("settings", "followup3_body", "TEXT");

ensureColumn("brands", "bounced", "INTEGER DEFAULT 0");
ensureColumn("brands", "name_normalized", "TEXT");
ensureColumn("brands", "contact_page_url", "TEXT");

// Var olan kayıtlar için normalize edilmiş isim doldur (tekrar tespiti bunu kullanır)
db.exec(`
  UPDATE brands SET name_normalized = LOWER(TRIM(name))
  WHERE name_normalized IS NULL OR name_normalized = ''
`);

module.exports = db;
