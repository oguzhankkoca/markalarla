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

module.exports = db;
