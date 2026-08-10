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

// "batch" (her yüklemeye verilen rastgele UUID) tek başına insan için anlamsız —
// panelde "🆕 Yeni Yüklenen" sekmesinde hangi Excel'in üzerinde çalıştığını
// anlayabilmek için, o UUID'ye eşlik eden okunabilir dosya adı ve yükleme zamanı.
ensureColumn("brands", "batch_name", "TEXT");
ensureColumn("brands", "batch_uploaded_at", "TEXT");

// Opportunity Score (0-100): Brand Score, tahmini ciro, yorum sayısı, kategori
// verisinin varlığı, web sitesi tespit güveni ve Amazon'daki satıcı rekabetini
// tek bir sayıda birleştiren, saf matematiksel (AI kullanmayan, dolayısıyla
// ücretsiz ve otomatik hesaplanabilen) öncelik skoru. Ayrıntılı kırılımı (her
// bileşenin kaç puan katkısı olduğu) opportunity_score_breakdown'da JSON olarak
// saklanır — panelde "neden bu puan" sorusuna cevap verebilmek için.
ensureColumn("brands", "opportunity_score", "REAL");
ensureColumn("brands", "opportunity_score_breakdown", "TEXT");

// CRM Pipeline: eski "deal_stage" (5 sabit aşama, sadece anlaşma sonrası süreç
// için) yerine/yanında, e-mail bulunmadan önceki adımları da kapsayan ve
// kullanıcının kendi ayarlarından yeniden adlandırıp sıralayabildiği daha
// kapsamlı bir aşama alanı. Varsayılan 10 aşama settings.crm_pipeline_stages'te
// JSON olarak tutulur (bkz. src/services/crmPipeline.js); burada sadece
// markanın o an hangi aşamada olduğunu (aşamanın "key"i) tutuyoruz.
// ÖNEMLİ: Buraya DEFAULT değeri KASITLI OLARAK eklenmedi — SQLite'ta ALTER TABLE
// ADD COLUMN ... DEFAULT 'x' yazılırsa, tabloda ZATEN VAR OLAN tüm satırlar
// anında 'x' değeriyle doldurulur (NULL kalmaz). Bu da aşağıdaki "duruma göre
// akıllı başlangıç aşaması" backfill UPDATE'inin hiçbir satırı NULL bulamayıp
// hiç çalışmamasına yol açardı (bu tam olarak bir deneme sırasında yakalanan bir
// hataydı). Yeni eklenen markalar için crm_stage değeri INSERT sırasında
// (brands.js'deki upload rotasında) elle 'new_lead' olarak veriliyor.
ensureColumn("brands", "crm_stage", "TEXT");
ensureColumn("settings", "crm_pipeline_stages", "TEXT");

// Var olan kayıtlarda crm_stage boşsa (eski kayıtlar), mevcut duruma göre en
// azından makul bir başlangıç aşamasına yerleştir — sıfırdan "new_lead" yerine,
// gerçek durumunu yansıtan bir aşamadan başlasın (ör. zaten mail gönderilmiş
// bir markanın pipeline'da "Yeni Aday" görünmesi kafa karıştırır).
db.exec(`
  UPDATE brands SET crm_stage = CASE
    WHEN crm_stage IS NOT NULL AND crm_stage != '' THEN crm_stage
    WHEN status = 'sent' AND document_requested = 1 THEN 'documents_requested'
    WHEN status = 'sent' AND reply_sentiment = 'positive' THEN 'positive_reply'
    WHEN status = 'sent' THEN 'email_sent'
    WHEN status = 'found' THEN 'email_found'
    ELSE 'new_lead'
  END
  WHERE crm_stage IS NULL OR crm_stage = ''
`);

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

// ---------------------------------------------------------------------------
// v46 ve sonrası: büyük özellik paketi (görev/hatırlatma, timeline, evrak
// yönetimi, AI opt-in özellikleri, subject rotation/A-B test, çoklu hesap
// altyapısı, performans indeksleri). Hepsi ADDİTİF — var olan davranışı
// değiştirmez, sadece yeni sütun/tablo ekler.
// ---------------------------------------------------------------------------

// Görev/Hatırlatma sistemi (v46): her markaya not niteliğinde birden fazla
// görev eklenebilir, her birinin bir son tarihi (due_date) olabilir. Panelde
// "bugün ya da daha önce, henüz tamamlanmamış" görevler bildirim olarak sayılır.
db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brand_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    due_date TEXT,
    completed INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT
  )
`);

// Marka bazlı Timeline (v53): gönderim, yanıt, bounce, evrak talebi, pipeline
// aşama değişikliği gibi olaylar buraya kronolojik olarak (append-only)
// yazılır. Var olan geçmiş veri için geriye dönük olay üretilmez (o veri hiç
// tutulmuyordu) — bu tablo YARATILDIĞI andan itibaren olacakları kaydeder.
db.exec(`
  CREATE TABLE IF NOT EXISTS brand_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brand_id INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    message TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

// Evrak yönetim sistemi (v54): dosyanın kendisi diskte (bkz. services/documents.js,
// DATA_DIR/documents/<brandId>/ altında) saklanır, burada sadece meta veri tutulur.
db.exec(`
  CREATE TABLE IF NOT EXISTS brand_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brand_id INTEGER NOT NULL,
    doc_type TEXT,
    original_name TEXT,
    stored_filename TEXT NOT NULL,
    uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

// Çoklu gönderici hesabı (v59) günlük gönderim sayaçları — round-robin sırasında
// "bugün hangi hesap kaç mail gönderdi" bilgisini tutar (her hesabın kendi
// günlük limitine/ısınma eğrisine sadık kalabilmesi için).
db.exec(`
  CREATE TABLE IF NOT EXISTS account_daily_stats (
    account_email TEXT NOT NULL,
    date TEXT NOT NULL,
    sent_count INTEGER DEFAULT 0,
    PRIMARY KEY (account_email, date)
  )
`);

// Wholesale/Distributor/Dealer sayfası otomatik tespiti (v49) — e-mail arama
// sırasında ana sayfada bulunan ilgili linki (varsa) burada saklıyoruz.
ensureColumn("brands", "wholesale_page_url", "TEXT");

// AI Kişiselleştirme (v55, isteğe bağlı — "AI Analiz Et" butonuyla tetiklenir).
ensureColumn("brands", "ai_personalized_intro", "TEXT");
ensureColumn("brands", "ai_personalized_at", "TEXT");

// AI Lead Priority + otomatik etiketleme (v56, isteğe bağlı).
ensureColumn("brands", "ai_priority", "TEXT");
ensureColumn("brands", "ai_tags", "TEXT");
ensureColumn("brands", "ai_analyzed_at", "TEXT");

// AI cevap sınıflandırma + otomatik taslak yanıt (v57). reply_sentiment
// (positive/negative) zaten vardı — reply_category daha GRANÜLER bir
// sınıflandırma (Interested/Need Documents/Need MOQ/... — bkz. inboxChecker.js).
ensureColumn("brands", "reply_category", "TEXT");
ensureColumn("brands", "ai_draft_reply", "TEXT");
ensureColumn("brands", "ai_draft_reply_at", "TEXT");

// Subject Rotation + A/B Test motoru (v58): kullanıcı birden fazla konu/gövde
// varyantı tanımlayabilir (JSON dizi), gönderim sırasında rastgele biri seçilir.
// Hangi markaya hangi varyantın gittiği ve mailin açılıp açılmadığı (tracking
// pixel) ayrı ayrı takip edilir ki varyant bazında performans karşılaştırılabilsin.
ensureColumn("settings", "subject_variants", "TEXT");
ensureColumn("settings", "body_variants", "TEXT");
ensureColumn("brands", "sent_variant_subject", "TEXT");
ensureColumn("brands", "sent_variant_body", "TEXT");
ensureColumn("brands", "opened", "INTEGER DEFAULT 0");
ensureColumn("brands", "opened_at", "TEXT");

// Çoklu gönderici hesabı altyapısı (v59): hesap listesi settings'te JSON olarak
// tutulur (bkz. services/senderAccounts.js) — kullanıcı ek hesap bağlamadığı
// sürece boş kalır ve sistem eskisi gibi tek hesapla (EMAIL_USER/.env) çalışmaya
// devam eder, HİÇBİR ŞEY BOZULMAZ.
ensureColumn("settings", "sender_accounts", "TEXT");
ensureColumn("brands", "sent_via_account", "TEXT");

// Bug fix: aynı domain'deki (ya da hatta aynı e-postayı paylaşan) birden fazla
// marka kaydı için gelen TEK bir yanıt, eskiden "from adresi" ya da "domain"
// eşleşmesiyle YANLIŞLIKLA birden fazla markaya "olumlu yanıt" olarak
// atanabiliyordu (ör. aynı distribütörün iki farklı Amazon markasına ayrı ayrı
// mail atıldığında, gelen tek bir cevap ikisine de "olumlu yanıt geldi" diye
// bildirim gönderiyordu). Çözüm: gönderilen her mailin Message-ID'sini kaydet,
// gelen yanıtları önce In-Reply-To/References başlığıyla (kesin eşleşme) eşleştir
// — bu, aynı adrese/domain'e birden fazla mail gitse bile HANGİ spesifik mailin
// yanıtlandığını tam olarak belirler.
ensureColumn("brands", "sent_message_id", "TEXT");

// Performans (v65): 100.000+ marka ile sorgular hâlâ hızlı kalsın diye en sık
// filtrelenen/sıralanan sütunlara indeks. CREATE INDEX IF NOT EXISTS idempotent
// olduğu için her başlangıçta güvenle tekrar çalıştırılabilir.
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_brands_status ON brands(status);
  CREATE INDEX IF NOT EXISTS idx_brands_batch ON brands(batch);
  CREATE INDEX IF NOT EXISTS idx_brands_crm_stage ON brands(crm_stage);
  CREATE INDEX IF NOT EXISTS idx_brands_main_category ON brands(main_category);
  CREATE INDEX IF NOT EXISTS idx_brands_email ON brands(email);
  CREATE INDEX IF NOT EXISTS idx_brands_name_normalized ON brands(name_normalized);
  CREATE INDEX IF NOT EXISTS idx_brands_opportunity_score ON brands(opportunity_score);
  CREATE INDEX IF NOT EXISTS idx_tasks_brand_id ON tasks(brand_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
  CREATE INDEX IF NOT EXISTS idx_brand_events_brand_id ON brand_events(brand_id);
  CREATE INDEX IF NOT EXISTS idx_brand_documents_brand_id ON brand_documents(brand_id);
`);

// ---------------------------------------------------------------------------
// v68: BRAND INTELLIGENCE + GROWTH AUDIT MODULE
// ---------------------------------------------------------------------------
// ÖNEMLİ TASARIM KARARI: SmartScout'tan Excel ile gelen alanlar (brands tablosundaki
// brand_score, est_monthly_revenue, avg_sellers, total_reviews vb.) bu modülün
// KONUSU DEĞİL — onlar "source of truth" olarak aynen kalır, AI ile yeniden
// tahmin edilmez/değiştirilmez. Bu tablo SADECE SmartScout'un sağlayamadığı,
// markanın kendi web sitesi/public kaynaklarından araştırılan bilgileri tutar:
// wholesale şartları, marketplace/Amazon izin politikası, distribütör bilgisi,
// iletişim kişisi önceliklendirmesi, Amazon listing/görsel denetimi, ve bunların
// üzerine kurulu skorlar (Brand Accessibility Score, Neofa Priority) ile outreach
// stratejisi/sıradaki en iyi aksiyon önerisi.
//
// Çoğu alan tek tek kolon yerine JSON blob olarak saklanıyor (bu projede zaten
// opportunity_score_breakdown, ai_tags, subject_variants gibi alanlarda kullanılan
// aynı desen) — her JSON içindeki her bilgi noktası mümkün olduğunca
// {value, source, confidence} şeklinde saklanır ki panelde "kaynağı göster"
// butonu her zaman çalışsın ve kanıtsız hiçbir iddia sessizce "kesin bilgi"ymiş
// gibi görünmesin. Bilgi bulunamazsa value: "UNKNOWN" (ya da görsel denetimde
// "NOT_VERIFIED"/"IMAGE_AUDIT_UNAVAILABLE") yazılır — AI'dan hiçbir zaman tahmin
// yürütmesi istenmez (bkz. src/services/brandIntelligence.js prompt'ları).
db.exec(`
  CREATE TABLE IF NOT EXISTS brand_intelligence (
    brand_id INTEGER PRIMARY KEY,

    -- COMPANY: official website, founder, size, çeşitli iletişim kanalları, LinkedIn.
    company_data TEXT,

    -- WHOLESALE RESEARCH: wholesale/dealer/reseller/retailer program, başvuru/portal
    -- linkleri, MOQ, opening/reorder minimum, payment/net terms, direct wholesale mi.
    wholesale_data TEXT,

    -- MARKETPLACE POLICY: amazon_allowed/prohibited, marketplace_restrictions, MAP
    -- policy, reseller/dealer agreement vb. — her biri ALLOWED/UNCLEAR/PROHIBITED.
    marketplace_policy TEXT,

    -- DISTRIBUTOR RESEARCH: marka direct wholesale yapmıyorsa authorized U.S.
    -- distributor adayları (kanıt yoksa "UNVERIFIED DISTRIBUTOR" olarak işaretlenir).
    distributor_data TEXT,

    -- CONTACT INTELLIGENCE: Hunter.io + site taramasından toplanan kişiler, unvan
    -- önceliğine göre sıralanmış [{name,title,email,phone,confidence,source}].
    contacts TEXT,

    -- RED FLAG ENGINE: [{flag, source, note}] — ör. "Amazon prohibited", "Too many
    -- sellers", "Very high MOQ" vb.
    red_flags TEXT,

    -- AMAZON LISTING AUDIT: title/bullet/description/A+/video/brand store/review
    -- kalitesi — SADECE gerçekten kontrol edilebilenler dolu, kalanı UNKNOWN.
    listing_audit TEXT,

    -- VISUAL AI ANALYSIS: vision-capable Claude ile görsel erişilebildiyse analiz;
    -- erişilemediyse available:false + "IMAGE AUDIT UNAVAILABLE".
    image_audit TEXT,

    -- BRAND NEEDS / GROWTH AUDIT çıktıları.
    top_opportunities TEXT,       -- JSON dizi, en fazla 3 madde
    value_proposition TEXT,       -- JSON dizi: "Neofa bu markaya ne sağlayabilir"

    -- OUTREACH STRATEGY
    pitch_angle TEXT,             -- WHOLESALE_PARTNERSHIP | AMAZON_GROWTH_PARTNER | ...
    pitch_angle_reason TEXT,
    outreach_strategy TEXT,
    outreach_strategy_reason TEXT,
    next_best_action TEXT,

    -- SCORES: Brand Accessibility Score (SmartScout Opportunity'den TAMAMEN ayrı)
    -- ve Neofa Priority (ikisinin birleşimi). breakdown JSON: her bileşenin puanı.
    accessibility_score REAL,
    accessibility_grade TEXT,        -- A+ | A | B | C | D
    accessibility_breakdown TEXT,
    neofa_priority REAL,

    -- Panelin en üstünde gösterilen tek-cümlelik aksiyon rozeti.
    action_badge TEXT,               -- CONTACT_NOW | RESEARCH_MORE | DISTRIBUTOR_ROUTE | DO_NOT_CONTACT

    -- AMAZON AUTHORIZATION TRACKING (v28): bunlar AI'ın tahmin ettiği şeyler DEĞİL,
    -- kullanıcının süreç ilerledikçe elle işaretlediği gerçek durum alanları. Wholesale
    -- onayı almak otomatik olarak Amazon yetkilendirmesi anlamına gelmez, bu yüzden
    -- kasıtlı olarak ayrı tutuluyor.
    wholesale_approval_status TEXT DEFAULT 'not_applied', -- not_applied | applied | approved | rejected
    loa_requested INTEGER DEFAULT 0,
    loa_received INTEGER DEFAULT 0,
    authorized_reseller_status TEXT DEFAULT 'unknown',    -- unknown | pending | confirmed
    amazon_approval_status TEXT DEFAULT 'unknown',        -- unknown | pending | approved | denied
    amazon_gating_status TEXT DEFAULT 'unknown',          -- unknown | not_gated | gated | ungated
    first_po_recorded_flag INTEGER DEFAULT 0,             -- growth_metrics'e bir kez sayılsın diye

    -- RESEARCH CACHE / STALENESS: aynı marka tekrar yüklenirse/araştırılırsa gereksiz
    -- yere tekrar araştırma yapılmasın diye. Her research seviyesi kendi tarihini tutar.
    research_status TEXT DEFAULT 'not_researched', -- not_researched | level2 | level3 | level4
    research_version INTEGER DEFAULT 0,
    researched_at TEXT,
    last_level2_at TEXT,
    last_level3_at TEXT,
    last_level4_at TEXT,
    research_error TEXT,

    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

// v69: research cache geçerlilik süresi (madde 24: "30-60 gün") artık sabit
// değil, Ayarlar'dan değiştirilebilir (bkz. services/brandIntelligence.js getStaleDays()).
ensureColumn("settings", "intel_stale_days", "INTEGER DEFAULT 45");

// v69: Hunter.io'dan gelen HAM (isim/unvan dahil) kontak listesi — Contact
// Intelligence (madde 16) unvan bazlı önceliklendirme yapabilsin diye saklanıyor.
// Mevcut e-mail seçim mantığı (brands.email/email_source) BUNA dokunmadan aynen
// çalışmaya devam ediyor; bu sadece ek/read-only bir bilgi kaynağı.
ensureColumn("brands", "hunter_raw_contacts", "TEXT");

// v71: AI Outreach Intelligence entegrasyonu — mevcut "AI Kişiselleştirme" (v55,
// ai_personalized_intro) artık sadece kısa bir giriş paragrafı değil, PROBLEM ->
// OPPORTUNITY -> NEOFA VALUE -> ANGLE -> EMAIL zincirinden (services/
// outreachIntelligence.js) üretilen TAM bir taslak email GÖVDESİNİ tutuyor.
// ai_personalized_intro kolonu KENDİSİ DEĞİŞMEDİ (geriye dönük uyumlu, hiçbir
// mevcut okuyucu kırılmıyor) — sadece içine artık daha zengin bir metin yazılıyor.
// Buradaki iki YENİ kolon: konu satırı (email'in artık bir de subject'i var) ve
// şeffaflık/denetim için kullanılan angle+bulgu+checklist meta verisi (JSON).
ensureColumn("brands", "ai_generated_subject", "TEXT");
ensureColumn("brands", "ai_outreach_meta", "TEXT");

db.exec(`CREATE INDEX IF NOT EXISTS idx_brand_intelligence_action_badge ON brand_intelligence(action_badge)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_brand_intelligence_research_status ON brand_intelligence(research_status)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_brand_intelligence_neofa_priority ON brand_intelligence(neofa_priority)`);

// Basit analitik sayaçları (v68, madde 29): karmaşık bir ML/tahmin sistemi kurmak
// yerine sadece talep edilen ham metrikleri saklıyoruz — wholesale başvuru ve
// onay/first PO gibi olaylar CRM/Intelligence panelinden elle işaretlendiğinde
// burada birikir (bkz. routes/brandIntelligence.js). Diğer sayaçlar (emails sent,
// replies, positive replies) zaten brands tablosundan anlık hesaplanabiliyor,
// burada sadece "elle işaretlenen" ve geriye dönük hesaplanamayan iki tanesi var.
db.exec(`
  CREATE TABLE IF NOT EXISTS growth_metrics (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    wholesale_applications INTEGER DEFAULT 0,
    approved_brands INTEGER DEFAULT 0,
    first_orders INTEGER DEFAULT 0,
    first_po_total_value REAL DEFAULT 0
  )
`);
db.prepare(
  "INSERT OR IGNORE INTO growth_metrics (id, wholesale_applications, approved_brands, first_orders, first_po_total_value) VALUES (1, 0, 0, 0, 0)"
).run();

module.exports = db;
module.exports.dbFilePath = dbFilePath;
