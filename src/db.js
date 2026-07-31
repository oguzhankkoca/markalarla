const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

// ÖNEMLİ: Render (ve çoğu bulut hosting) varsayılan olarak kalıcı olmayan (ephemeral)
// bir dosya sistemi kullanır — "Persistent Disk" eklenmediği sürece her yeni deploy'da
// sunucudaki dosyalar (bu veritabanı dahil) sıfırlanır. Bunu önlemek için:
// Render'da bir Disk oluşturup DATA_DIR ortam değişkenini o disk'in mount path'ine
// eşitle (örn. DATA_DIR=/var/data). DATA_DIR tanımlı değilse (örn. yerel bilgisayarda
// çalıştırırken) eskisi gibi proje klasörü içindeki data/ dizinini kullanır.
const dataDir = process.env.DATA_DIR || path.join(__dirname, "..", "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbFilePath = path.join(dataDir, "app.sqlite");
const db = new Database(dbFilePath);
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

-- Bir e-posta adresi buraya girdiyse sistem BİR DAHA ASLA o adrese mail göndermez —
-- marka kaydı silinse, yeniden yüklense ya da tekilleştirilse bile bu liste kalıcıdır.
-- "unsubscribe"/"remove me" gibi net bir çıkış talebi tespit edildiğinde otomatik
-- eklenir; kullanıcı da elle bir adres ekleyebilir/çıkarabilir.
CREATE TABLE IF NOT EXISTS suppression_list (
  email TEXT PRIMARY KEY,
  reason TEXT,
  brand_name TEXT,
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

// Ana mail şablonu artık tarayıcıda (localStorage) değil, sunucuda tutuluyor —
// otomatik günlük gönderim (cron) bu şablona erişmesi gerektiği için.
ensureColumn("settings", "main_subject", "TEXT");
ensureColumn("settings", "main_body", "TEXT");
// 0 = otomatik günlük gönderim kapalı (sadece elle gönderim). >0 ise, o sayı kadar
// mail her gün otomatik olarak (08:00-20:00 UTC arası yayılarak) gönderilir.
ensureColumn("settings", "daily_send_limit", "INTEGER DEFAULT 0");

// SmartScout tarzı marka istihbarat dosyalarından (Brand Score, Est. Monthly Revenue vb.)
// gelen, markayı önceliklendirmek için en faydalı alanlar. Excel'de bu sütunlar varsa
// yükleme sırasında otomatik algılanıp buraya kaydedilir.
ensureColumn("brands", "brand_score", "REAL");
ensureColumn("brands", "main_category", "TEXT");
ensureColumn("brands", "subcategory", "TEXT");
ensureColumn("brands", "est_monthly_revenue", "REAL");
ensureColumn("brands", "est_monthly_sales", "REAL");
ensureColumn("brands", "avg_price", "REAL");
ensureColumn("brands", "avg_fba_sellers", "REAL");
ensureColumn("brands", "avg_sellers", "REAL");
ensureColumn("brands", "dominant_seller", "TEXT");
ensureColumn("brands", "sales_percentage", "REAL");
ensureColumn("brands", "amazon_in_stock_rate", "REAL");
ensureColumn("brands", "avg_rating", "REAL");
ensureColumn("brands", "total_reviews", "INTEGER");
ensureColumn("brands", "growth_12m", "REAL");
ensureColumn("brands", "product_count", "INTEGER");
ensureColumn("brands", "storefront_url", "TEXT");

// Bir marka gerçek mail yerine (bulunamadığı için) iletişim formu üzerinden elle
// gönderildiyse bunu ayırt edebilmek için.
ensureColumn("brands", "sent_via", "TEXT DEFAULT 'email'");

// Gelen yanıt, ilerlemeden önce bir belge/evrak (iş lisansı, bayilik başvurusu,
// vergi kimlik no vb.) istiyorsa işaretlenir — hem anahtar kelime hem de (varsa)
// yapay zeka analiziyle tespit edilir.
ensureColumn("brands", "document_requested", "INTEGER DEFAULT 0");
ensureColumn("brands", "document_request_snippet", "TEXT");

// Serbest not alanı — "tekrar ara", "fiyat teklifi bekliyor" gibi kişisel hatırlatmalar için.
ensureColumn("brands", "notes", "TEXT");

// Bir marka, aynı e-posta adresini kullanan BAŞKA bir marka kaydı yüzünden (ör. aynı
// şirketin birden fazla ürün hattı/alt markası, hepsi aynı info@ adresine düşüyor)
// gönderimden hariç tutulduysa bunu ayırt etmek için.
ensureColumn("brands", "cross_brand_duplicate_email", "INTEGER DEFAULT 0");

// Kalıcı "bir daha yazma" listesine (suppression_list) düşmüş bir adrese ait marka
// hızlıca filtrelenebilsin diye denormalize bir bayrak.
ensureColumn("brands", "suppressed", "INTEGER DEFAULT 0");

// CAN-SPAM Act (ABD'ye ticari mail atarken) gönderenin gerçek bir fiziksel posta
// adresini içermesini zorunlu kılıyor — hem yasal gereklilik hem de spam filtrelerinin
// "gerçek bir şirket" sinyali olarak baktığı bir unsur. Doluysa her mailin altına
// otomatik ekleniyor (bkz. mailer.js).
ensureColumn("settings", "company_address", "TEXT");

// Bounce oranı güvenlik freni: son 24 saatte gönderilenlerin bounce oranı eşiği
// geçerse otomatik gönderim durur. Bu iki alan, kullanıcıya sadece BİR KEZ uyarı
// maili gitmesini (her 10 dakikada bir spam gibi tekrar tekrar değil) ve panelde
// durumun görünür kalmasını sağlar.
ensureColumn("settings", "circuit_breaker_active", "INTEGER DEFAULT 0");
ensureColumn("settings", "circuit_breaker_notified_at", "TEXT");

// Hunter.io bazen bir e-mail kaydına eşlik eden telefon numarası da döndürüyor
// (nadiren dolu oluyor) — doluysa markayı doğrudan aramak için ekstra bir kanal.
ensureColumn("brands", "phone", "TEXT");

// Excel'deki "Country" sütunu — hem bilgi amaçlı hem de ülke bazlı gönderim
// saatine göre otomatik gönderimi zamanlamak için kullanılır.
ensureColumn("brands", "country", "TEXT");

// Haftalık özet mailinin en son ne zaman gönderildiğini tutar — cron her hafta
// pazartesi tetiklense bile, sunucu o dakikada yeniden başlarsa (Render gibi
// platformlarda olabilir) aynı haftada ikinci bir özet gitmesini önler.
ensureColumn("settings", "last_weekly_summary_at", "TEXT");

// Haftalık otomatik veritabanı yedeklemesinin en son ne zaman gönderildiğini tutar
// (aynı hafta içinde iki kez gitmesin diye, haftalık özet mailiyle aynı mantık).
ensureColumn("settings", "last_backup_at", "TEXT");

// Soğuk marka yeniden ısıtma: uzun süre sessiz kalan ya da olumsuz yanıt veren
// markaları otomatik olarak tekrar gönderim kuyruğuna alma özelliği. Bazı
// kullanıcılar "hayır" diyen birine tekrar yazmayı agresif bulabileceği için
// varsayılan KAPALI — ayarlardan bilinçli olarak açılması gerekiyor.
ensureColumn("settings", "rewarm_enabled", "INTEGER DEFAULT 0");
// Bir marka en fazla kaç kez otomatik yeniden ısıtılabilir (sonsuz döngüyü önlemek için).
ensureColumn("brands", "rewarm_count", "INTEGER DEFAULT 0");

// Arama sağlayıcılarından (Serper/SerpAPI/Hunter) biri kota bitmiş gibi görünen
// bir hata verdiğinde, aynı toplu aramada yüzlerce marka için tekrar tekrar mail
// atmamak için en fazla günde bir kez bildirim gönderiyoruz — bu, o son bildirimin
// ne zaman gittiğini tutar.
ensureColumn("settings", "quota_alert_notified_at", "TEXT");

// Kademeli ısınma (warm-up) otomasyonu: yeni/az kullanılan bir gönderim düzeninde
// birden yüksek hacimde mail atmak spam filtrelerinde şüphe uyandırabiliyor.
// Bu özellik açıkken günlük limit hedefe (daily_send_limit) tek seferde değil,
// haftalık kademeli olarak ulaşır.
ensureColumn("settings", "warmup_enabled", "INTEGER DEFAULT 0");
ensureColumn("settings", "warmup_start_limit", "INTEGER DEFAULT 10");
ensureColumn("settings", "warmup_increment", "INTEGER DEFAULT 10");
ensureColumn("settings", "warmup_started_at", "TEXT");

// Var olan kayıtlar için normalize edilmiş isim doldur (tekrar tespiti bunu kullanır)
db.exec(`
  UPDATE brands SET name_normalized = LOWER(TRIM(name))
  WHERE name_normalized IS NULL OR name_normalized = ''
`);

// Aynı e-posta adresine birden fazla marka kaydı düşmüş olabilir (ör. aynı
// distribütörün/şirketin birden fazla alt markası hep aynı info@ adresine
// yönleniyor). Bu durumda farklı marka adlarıyla aynı kutuya art arda mail
// gitmesi hem tuhaf görünür hem de spam gibi algılanabilir. Her açılışta:
// aynı e-postaya sahip kayıtlar arasında en eski (ID'si en küçük) kayıt
// "sahip" kalır, henüz gönderilmemiş ('found') diğerleri duplicate_blocked
// durumuna alınır. Zaten gönderilmiş kayıtlara dokunulmaz (geçmiş bozulmasın).
try {
  const dupEmailRows = db
    .prepare(
      `SELECT LOWER(TRIM(email)) as em FROM brands
       WHERE email IS NOT NULL AND TRIM(email) != ''
       GROUP BY LOWER(TRIM(email)) HAVING COUNT(*) > 1`
    )
    .all();
  const markDuplicate = db.prepare(
    "UPDATE brands SET status = 'duplicate_blocked', cross_brand_duplicate_email = 1 WHERE id = ?"
  );
  for (const row of dupEmailRows) {
    const owners = db
      .prepare("SELECT id, status FROM brands WHERE LOWER(TRIM(email)) = ? ORDER BY id ASC")
      .all(row.em);
    for (let i = 1; i < owners.length; i++) {
      if (owners[i].status === "found") markDuplicate.run(owners[i].id);
    }
  }
} catch (e) {
  console.error("Cross-brand e-posta tekrarı taraması sırasında hata:", e.message);
}

module.exports = db;
module.exports.dbFilePath = dbFilePath;
