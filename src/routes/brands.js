const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const XLSX = require("xlsx");
const db = require("../db");
const { findBrandEmail } = require("../services/emailFinder");
const mailer = require("../services/mailer");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function guessColumns(rows) {
  if (rows.length === 0) return { nameKey: null, websiteKey: null };
  const keys = Object.keys(rows[0]);
  const nameKey =
    keys.find((k) => /marka|brand|name|firma|şirket|sirket/i.test(k)) || keys[0];
  const websiteKey = keys.find((k) => /web|site|url|domain/i.test(k)) || null;
  return { nameKey, websiteKey };
}

// SmartScout ve benzeri marka istihbarat araçlarından export edilen Excel'lerde sıkça
// görülen, markayı önceliklendirmek için en faydalı sütunlar. Excel'de bu başlıklardan
// biri varsa otomatik algılanıp veritabanına kaydedilir; yoksa sorun değil, boş kalır.
const ENRICHMENT_COLUMNS = [
  { key: "brand_score", match: /^brand\s*score$/i, type: "number" },
  { key: "main_category", match: /^main\s*category$/i, type: "text" },
  { key: "subcategory", match: /^(primary\s*)?sub\s*category$/i, type: "text" },
  { key: "est_monthly_revenue", match: /^est\.?\s*monthly\s*revenue$/i, type: "number" },
  { key: "est_monthly_sales", match: /^est\.?\s*monthly\s*sales$/i, type: "number" },
  { key: "avg_price", match: /^avg\.?\s*price$/i, type: "number" },
  { key: "avg_fba_sellers", match: /^avg\.?\s*fba\s*sellers$/i, type: "number" },
  { key: "avg_sellers", match: /^avg\.?\s*sellers$/i, type: "number" },
  { key: "dominant_seller", match: /^dominant\s*seller$/i, type: "text" },
  { key: "sales_percentage", match: /^sales\s*%$/i, type: "number" },
  { key: "amazon_in_stock_rate", match: /^amazon\s*in-?stock\s*rate$/i, type: "number" },
  { key: "avg_rating", match: /^avg\.?\s*rating$/i, type: "number" },
  { key: "total_reviews", match: /^total\s*reviews$/i, type: "number" },
  { key: "growth_12m", match: /^12\s*month\s*growth$/i, type: "number" },
  { key: "product_count", match: /^product\s*count$/i, type: "number" },
  { key: "storefront_url", match: /^storefront\s*url$/i, type: "text" },
];

function parseEnrichmentNumber(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  // "$12,345", "%23", "4.5 ★" gibi biçimlerden sayıyı çıkar
  const cleaned = String(raw).replace(/[^0-9.\-]/g, "");
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : null;
}

// Excel başlıklarını ENRICHMENT_COLUMNS ile eşleştirip { fieldKey: excelColumnKey } döner.
function mapEnrichmentColumns(rows) {
  if (rows.length === 0) return {};
  const keys = Object.keys(rows[0]);
  const map = {};
  for (const col of ENRICHMENT_COLUMNS) {
    const found = keys.find((k) => col.match.test(k.trim()));
    if (found) map[col.key] = found;
  }
  return map;
}

// Bir Excel satırından, eşleşen sütunlara göre marka istihbarat verisini çıkarır.
function extractEnrichment(item, columnMap) {
  const values = {};
  for (const col of ENRICHMENT_COLUMNS) {
    const excelKey = columnMap[col.key];
    if (!excelKey) {
      values[col.key] = null;
      continue;
    }
    const raw = item[excelKey];
    values[col.key] = col.type === "number" ? parseEnrichmentNumber(raw) : String(raw || "").trim() || null;
  }
  return values;
}

// Excel/CSV yükle -> yeni bir "batch" olarak markaları kaydet
router.post("/api/brands/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Dosya bulunamadı." });
  try {
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    const { nameKey, websiteKey } = guessColumns(rows);
    if (!nameKey) return res.status(400).json({ error: "Marka adı sütunu bulunamadı." });
    const enrichmentMap = mapEnrichmentColumns(rows);
    const enrichmentFieldsFound = Object.keys(enrichmentMap);

    const batch = crypto.randomUUID();
    const insert = db.prepare(
      `INSERT INTO brands (
         batch, name, name_normalized, website, email, email_source, confidence, status, last_error,
         brand_score, main_category, subcategory, est_monthly_revenue, est_monthly_sales, avg_price,
         avg_fba_sellers, avg_sellers, dominant_seller, sales_percentage, amazon_in_stock_rate,
         avg_rating, total_reviews, growth_12m, product_count, storefront_url
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    // Marka adı (normalize edilmiş) sistemde herhangi bir yüklemede/batch'te zaten
    // varsa bu satırı tekrar eklemiyoruz — aynı SmartScout listesini ya da örtüşen
    // Excel'leri tekrar tekrar yüklediğinde markalar metriklerde/tabloda çift
    // sayılmasın diye. Aynı dosya içindeki tekrarları da (iki kez aynı marka) aynı
    // mantıkla engelliyoruz.
    const existingNames = new Set(
      db.prepare("SELECT DISTINCT name_normalized FROM brands").all().map((r) => r.name_normalized)
    );

    let skippedExistingCount = 0;

    const insertMany = db.transaction((items) => {
      for (const item of items) {
        const name = String(item[nameKey] || "").trim();
        if (!name) continue;
        const nameNorm = name.toLowerCase();

        if (existingNames.has(nameNorm)) {
          skippedExistingCount++;
          continue;
        }
        existingNames.add(nameNorm);

        const website = websiteKey ? String(item[websiteKey] || "").trim() : "";
        const enrichment = extractEnrichment(item, enrichmentMap);

        insert.run(
          batch, name, nameNorm, website, null, null, "unknown", "pending", null,
          enrichment.brand_score, enrichment.main_category, enrichment.subcategory,
          enrichment.est_monthly_revenue, enrichment.est_monthly_sales, enrichment.avg_price,
          enrichment.avg_fba_sellers, enrichment.avg_sellers, enrichment.dominant_seller,
          enrichment.sales_percentage, enrichment.amazon_in_stock_rate, enrichment.avg_rating,
          enrichment.total_reviews, enrichment.growth_12m, enrichment.product_count,
          enrichment.storefront_url
        );
      }
    });
    insertMany(rows);

    const brands = db.prepare("SELECT * FROM brands WHERE batch = ? ORDER BY id").all(batch);
    res.json({
      ok: true,
      batch,
      count: brands.length,
      brands,
      skippedExistingCount,
      enrichmentFieldsFound,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Dosya işlenirken hata oluştu: " + err.message });
  }
});

// Sistemdeki tüm markaları getir. Artık sadece "son yüklenen dosya" değil, bugüne
// kadar yüklenmiş her marka tek bir listede — çünkü upload artık zaten daha önce
// eklenmiş marka adlarını tekrar eklemiyor (bkz. /api/brands/upload), yani panel
// hep tekilleştirilmiş, tutarlı bir liste gösteriyor.
router.get("/api/brands", (req, res) => {
  const lastBatchRow = db
    .prepare("SELECT batch FROM brands ORDER BY id DESC LIMIT 1")
    .get();
  const brands = db.prepare("SELECT * FROM brands ORDER BY id").all();
  res.json({ brands, batch: lastBatchRow ? lastBatchRow.batch : null });
});

// Tek bir marka için email arat
router.post("/api/brands/:id/find-email", async (req, res) => {
  const brand = db.prepare("SELECT * FROM brands WHERE id = ?").get(req.params.id);
  if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });

  try {
    const result = await findBrandEmail(brand.name, brand.website);
    db.prepare(
      `UPDATE brands SET email = ?, website = COALESCE(?, website), email_source = ?, confidence = ?, status = ?, last_error = ?, contact_page_url = ?
       WHERE id = ?`
    ).run(
      result.email,
      result.website,
      result.source,
      result.confidence,
      result.email ? "found" : "not_found",
      (result.trace || []).join(" | "),
      result.contactUrl || null,
      brand.id
    );
    const updated = db.prepare("SELECT * FROM brands WHERE id = ?").get(brand.id);
    res.json({ brand: updated });
  } catch (err) {
    console.error(err);
    db.prepare("UPDATE brands SET status = 'error', last_error = ? WHERE id = ?").run(
      err.message,
      brand.id
    );
    res.status(500).json({ error: "Email aranırken hata oluştu: " + err.message });
  }
});

// Toplu email arama işleminin durumu bellekte tutulur (sunucu yeniden başlarsa
// sıfırlanır — bu durumda "Tüm markalar için email ara"ya tekrar basmak yeterli,
// zaten aranmış olanlar status'u sayesinde otomatik atlanır). "Durdur" bir sonraki
// markaya geçmeden önce işlemi durdurur, kalan markaları kuyrukta bırakır; "Devam Et"
// kaldığı markadan itibaren aynı kuyruğu tüketmeye devam eder.
let findAllJob = { batch: null, remainingIds: [], running: false };

async function processFindAllQueue() {
  findAllJob.running = true;
  while (findAllJob.remainingIds.length > 0 && findAllJob.running) {
    const id = findAllJob.remainingIds.shift();
    const brand = db.prepare("SELECT * FROM brands WHERE id = ?").get(id);
    if (!brand) continue;
    try {
      const result = await findBrandEmail(brand.name, brand.website);
      db.prepare(
        `UPDATE brands SET email = ?, website = COALESCE(?, website), email_source = ?, confidence = ?, status = ?, last_error = ?, contact_page_url = ?
         WHERE id = ?`
      ).run(
        result.email,
        result.website,
        result.source,
        result.confidence,
        result.email ? "found" : "not_found",
        (result.trace || []).join(" | "),
        result.contactUrl || null,
        brand.id
      );
    } catch (err) {
      db.prepare("UPDATE brands SET status = 'error', last_error = ? WHERE id = ?").run(
        err.message,
        brand.id
      );
    }
  }
  findAllJob.running = false;
}

// Tüm liste için toplu email arama (arka planda sırayla, durdurulabilir/devam
// ettirilebilir). Sadece henüz hiç aranmamış (pending) ya da başarısız olmuş
// (not_found/error) markaları dener — zaten bulunmuş (found) markaları tekrar
// aratmaz, böylece SerpAPI/Serper/Hunter kotan boşa harcanmaz. Bir markayı elle
// tekrar aratmak istersen tablodaki "Ara" butonunu kullanabilirsin.
// Panel artık tek bir birleşik marka listesi gösterdiği için (bkz. GET /api/brands),
// bu da tek bir yükleme/batch ile sınırlı değil — sistemdeki tüm uygun markaları kapsar.
router.post("/api/brands/find-all", async (req, res) => {
  if (findAllJob.running) {
    return res.status(409).json({ error: "Zaten devam eden bir arama var. Önce durdur ya da bitmesini bekle." });
  }
  const brands = db
    .prepare("SELECT id FROM brands WHERE status IN ('pending', 'not_found', 'error')")
    .all();

  findAllJob = { batch: null, remainingIds: brands.map((b) => b.id), running: false };
  res.json({ ok: true, queued: brands.length });
  processFindAllQueue();
});

// Devam eden aramayı durdurur (bir sonraki markaya geçmeden önce durur, o an
// işlenmekte olan marka bitirilir). Kalan markalar kuyrukta bekletilir.
router.post("/api/brands/find-all/stop", (req, res) => {
  findAllJob.running = false;
  res.json({ ok: true, remaining: findAllJob.remainingIds.length });
});

// Durdurulmuş bir aramayı kaldığı yerden devam ettirir.
router.post("/api/brands/find-all/resume", (req, res) => {
  if (findAllJob.running) {
    return res.status(409).json({ error: "Zaten çalışıyor." });
  }
  if (findAllJob.remainingIds.length === 0) {
    return res.status(400).json({ error: "Devam edilecek bir arama yok." });
  }
  res.json({ ok: true, remaining: findAllJob.remainingIds.length });
  processFindAllQueue();
});

// Panelin durdur/devam et butonlarını doğru göstermesi ve ilerlemeyi takip etmesi için.
router.get("/api/brands/find-all/status", (req, res) => {
  res.json({
    running: findAllJob.running,
    remaining: findAllJob.remainingIds.length,
    batch: findAllJob.batch,
  });
});

// Marka bilgisini manuel düzenle (email/website)
router.put("/api/brands/:id", (req, res) => {
  const { email, website, status } = req.body;
  const brand = db.prepare("SELECT * FROM brands WHERE id = ?").get(req.params.id);
  if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });

  db.prepare("UPDATE brands SET email = ?, website = ?, status = ? WHERE id = ?").run(
    email !== undefined ? email : brand.email,
    website !== undefined ? website : brand.website,
    status !== undefined ? status : brand.status,
    brand.id
  );
  res.json({ ok: true });
});

// Bir markaya, sistemin mailer'ı yerine iletişim formu üzerinden elle mail
// gönderildiğinde ("Form Aç" ile form açılıp içerik yapıştırıldıktan sonra),
// bunu sisteme "gönderildi" olarak işaretlemek için. Bu marka artık tekrar
// gönderim/kara liste mantığına dahil olur; e-mail adresi yoksa otomatik
// follow-up'a girmez (gönderilecek bir adres olmadığı için zaten atlanır).
router.post("/api/brands/:id/mark-contact-sent", (req, res) => {
  const brand = db.prepare("SELECT * FROM brands WHERE id = ?").get(req.params.id);
  if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });

  db.prepare(
    "UPDATE brands SET status = 'sent', sent_at = CURRENT_TIMESTAMP, sent_via = 'contact_form' WHERE id = ?"
  ).run(brand.id);
  db.prepare("INSERT INTO send_log (brand_id, status, message) VALUES (?, 'sent', ?)").run(
    brand.id,
    `İletişim formu üzerinden elle gönderildi olarak işaretlendi (${brand.contact_page_url || "form adresi kayıtlı değil"}).`
  );
  const updated = db.prepare("SELECT * FROM brands WHERE id = ?").get(brand.id);
  res.json({ ok: true, brand: updated });
});

// Tek markaya mail gönder
router.post("/api/brands/:id/send", async (req, res) => {
  const brand = db.prepare("SELECT * FROM brands WHERE id = ?").get(req.params.id);
  if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });
  if (!brand.email) return res.status(400).json({ error: "Bu marka için e-mail adresi yok." });

  const { subject, body } = req.body;
  try {
    await mailer.sendMail({ to: brand.email, subject, body });
    db.prepare("UPDATE brands SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE id = ?").run(
      brand.id
    );
    db.prepare("INSERT INTO send_log (brand_id, status, message) VALUES (?, 'sent', ?)").run(
      brand.id,
      `${brand.email} adresine gönderildi.`
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    db.prepare("INSERT INTO send_log (brand_id, status, message) VALUES (?, 'error', ?)").run(
      brand.id,
      err.message
    );
    res.status(500).json({ error: "Gönderim başarısız: " + err.message });
  }
});

function fillTemplateLocal(text, brandName) {
  return (text || "").replace(/{{\s*marka\s*}}/gi, brandName);
}

// Günlük gönderim limitini aşmadan, gün içine yayılmış şekilde otomatik mail gönderir.
// server.js'teki cron her ~10 dakikada bir bu fonksiyonu çağırır; her çağrıda en fazla
// 1 mail gönderir, böylece örn. "günde 60" ayarı gün boyuna doğal şekilde yayılmış olur
// (60 mail art arda gönderilirse Gmail/alıcı tarafında spam gibi görünme riski artar).
async function runAutoSend() {
  const settings = db.prepare("SELECT * FROM settings WHERE id = 1").get();
  const limit = Number(settings.daily_send_limit) || 0;
  if (limit <= 0) return { sent: 0, reason: "disabled" };
  if (!settings.main_subject || !settings.main_body) {
    return { sent: 0, reason: "template_missing" };
  }

  const todayStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const sentTodayRow = db
    .prepare("SELECT COUNT(*) as c FROM brands WHERE status = 'sent' AND substr(sent_at, 1, 10) = ?")
    .get(todayStr);
  if (sentTodayRow.c >= limit) return { sent: 0, reason: "limit_reached", sentToday: sentTodayRow.c };

  const candidate = db
    .prepare(`SELECT * FROM brands WHERE status = 'found' AND email IS NOT NULL ORDER BY id ASC LIMIT 1`)
    .get();
  if (!candidate) return { sent: 0, reason: "no_candidates" };

  const subject = fillTemplateLocal(settings.main_subject, candidate.name);
  const body = fillTemplateLocal(settings.main_body, candidate.name);
  try {
    await mailer.sendMail({ to: candidate.email, subject, body });
    db.prepare("UPDATE brands SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE id = ?").run(candidate.id);
    db.prepare("INSERT INTO send_log (brand_id, status, message) VALUES (?, 'sent', ?)").run(
      candidate.id,
      `Otomatik günlük gönderim (limit: ${limit}/gün): ${candidate.email}`
    );
    return { sent: 1, brand: candidate.name };
  } catch (err) {
    db.prepare("UPDATE brands SET status = 'error', last_error = ? WHERE id = ?").run(err.message, candidate.id);
    db.prepare("INSERT INTO send_log (brand_id, status, message) VALUES (?, 'error', ?)").run(
      candidate.id,
      err.message
    );
    return { sent: 0, reason: "error", error: err.message };
  }
}

module.exports = router;
module.exports.runAutoSend = runAutoSend;
