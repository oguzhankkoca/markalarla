const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const XLSX = require("xlsx");
const db = require("../db");
const { findBrandEmail, detectWholesalePage } = require("../services/emailFinder");
const mailer = require("../services/mailer");
const { isSuppressed } = require("../services/suppression");
const { computeOpportunityScore } = require("../services/opportunityScore");
const { getPipelineStages, advanceStage } = require("../services/crmPipeline");
const { logEvent } = require("../services/events");
const { findFuzzyDuplicateGroups } = require("../services/fuzzyDedup");
const { pickVariant, safeParseArray } = require("../services/mailerHelpers");
const formFiller = require("../services/formFiller");

// v71 QA fix: Brand Intelligence (Level 2/3) bir markayı DO_NOT_CONTACT olarak
// işaretlediyse (Amazon/marketplace politikası ya da kritik bir red flag satışı
// açıkça yasaklıyorsa — bkz. brandIntelligence.js computeActionBadge), bu marka
// için email ÜRETİMİ zaten engellenmişti (routes/aiFeatures.js personalizeBrand)
// ama GÖNDERİM tarafında (tekli/toplu/otomatik) HİÇBİR kontrol yoktu — kullanıcı
// panelden elle yazıp gönderirse ya da eski/jenerik bir şablonla otomatik
// gönderim çalışırsa bu marka yine de mail alabiliyordu. Bu, "DO_NOT_CONTACT
// için send = BLOCKED olmalı" testinin yakaladığı gerçek bir güvenlik açığıydı.
// Yeni bir özellik DEĞİL — zaten var olan action_badge sisteminin gönderim
// akışına da bağlanması (suppression/duplicate kontrolleriyle AYNI seviyede).
function isDoNotContact(brandId) {
  const row = db.prepare("SELECT action_badge FROM brand_intelligence WHERE brand_id = ?").get(brandId);
  return !!(row && row.action_badge === "DO_NOT_CONTACT");
}

// find-email sonucu geldiğinde ya da yeni bir marka eklendiğinde Opportunity
// Score'u yeniden hesaplayıp DB'ye yazar — panelde her zaman güncel kalsın diye.
function recomputeAndSaveScore(brand) {
  const { score, breakdown } = computeOpportunityScore(brand);
  db.prepare("UPDATE brands SET opportunity_score = ?, opportunity_score_breakdown = ? WHERE id = ?").run(
    score,
    JSON.stringify(breakdown),
    brand.id
  );
  return score;
}

// Wholesale/Distributor/Dealer sayfası tespiti (v49) — e-mail bulma akışının
// SONUNDA, best-effort olarak çalışır: hata olsa da ya da hiçbir şey bulunamasa
// da ana akışı ASLA bozmaz/durdurmaz (try/catch içinde, sonucu sadece varsa
// kaydeder). Zaten tespit edilmişse (wholesale_page_url doluysa) tekrar taramaz.
async function maybeDetectWholesalePage(brand) {
  if (!brand.website || brand.wholesale_page_url) return;
  try {
    const url = await detectWholesalePage(brand.website);
    if (url) {
      db.prepare("UPDATE brands SET wholesale_page_url = ? WHERE id = ?").run(url, brand.id);
      logEvent(brand.id, "wholesale_page_found", url);
    }
  } catch (e) {
    // sessizce geç — bu tamamen bonus bir sinyal, e-mail bulma sonucunu etkilemez
  }
}

// Bir markayı CRM pipeline'da (varsa ilgili aşama tanımlıysa) ileri taşır —
// asla geri almaz. Kullanıcı pipeline'ı ayarlardan değiştirmiş olabileceği için
// güncel aşama listesini her seferinde settings'ten okuyoruz.
function advanceCrmStage(brandId, currentStage, targetKey) {
  const settings = db.prepare("SELECT crm_pipeline_stages FROM settings WHERE id = 1").get();
  const stages = getPipelineStages(settings);
  const next = advanceStage(currentStage, targetKey, stages);
  if (next !== currentStage) {
    db.prepare("UPDATE brands SET crm_stage = ? WHERE id = ?").run(next, brandId);
    const label = (stages.find((s) => s.key === next) || {}).label || next;
    logEvent(brandId, "stage_changed", `Aşama: ${label}`);
  }
  return next;
}

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
// NOT: Bu desenler artık tam eşleşme (^...$) DEĞİL, İÇERME (substring) bazlı — gerçek
// dünyada başlıklar "Brand Score (1-100)" ya da fazladan boşluk/parantez gibi küçük
// varyasyonlarla gelebiliyor; tam eşleşme bunları kaçırıp Ciro/Skor gibi kritik
// verilerin hiç çekilmemesine yol açabiliyordu.
const ENRICHMENT_COLUMNS = [
  { key: "brand_score", match: /brand\s*score/i, type: "number" },
  { key: "main_category", match: /main\s*category/i, type: "text" },
  { key: "subcategory", match: /(primary\s*)?sub\s*category/i, type: "text" },
  { key: "est_monthly_revenue", match: /est\.?\s*monthly\s*revenue/i, type: "number" },
  { key: "est_monthly_sales", match: /est\.?\s*monthly\s*sales/i, type: "number" },
  { key: "avg_price", match: /avg\.?\s*price/i, type: "number" },
  { key: "avg_fba_sellers", match: /avg\.?\s*fba\s*sellers/i, type: "number" },
  { key: "avg_sellers", match: /avg\.?\s*sellers/i, type: "number" },
  { key: "dominant_seller", match: /dominant\s*seller/i, type: "text" },
  { key: "sales_percentage", match: /sales\s*%/i, type: "number" },
  { key: "amazon_in_stock_rate", match: /amazon\s*in-?stock\s*rate/i, type: "number" },
  { key: "avg_rating", match: /avg\.?\s*rating/i, type: "number" },
  { key: "total_reviews", match: /total\s*reviews/i, type: "number" },
  { key: "growth_12m", match: /12\s*month\s*growth/i, type: "number" },
  { key: "product_count", match: /product\s*count/i, type: "number" },
  { key: "storefront_url", match: /storefront\s*url/i, type: "text" },
  { key: "country", match: /^country$/i, type: "text" },
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
    // Dosyanın orijinal adı, "🆕 Yeni Yüklenen" sekmesinde kullanıcının hangi
    // Excel üzerinde çalıştığını anlayabilmesi için (rastgele UUID'nin aksine
    // insan-okunur). Uzantıyı at, çok uzunsa kırp.
    const batchName = String(req.file.originalname || "Excel")
      .replace(/\.(xlsx|xls|csv)$/i, "")
      .slice(0, 80);
    const batchUploadedAt = new Date().toISOString();
    const insert = db.prepare(
      `INSERT INTO brands (
         batch, batch_name, batch_uploaded_at, name, name_normalized, website, email, email_source, confidence, status, last_error,
         brand_score, main_category, subcategory, est_monthly_revenue, est_monthly_sales, avg_price,
         avg_fba_sellers, avg_sellers, dominant_seller, sales_percentage, amazon_in_stock_rate,
         avg_rating, total_reviews, growth_12m, product_count, storefront_url, country,
         opportunity_score, opportunity_score_breakdown, crm_stage
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    let skippedNoDataCount = 0;
    // Dosyada Brand Score ve/veya Est. Monthly Revenue sütunu gerçekten varsa (yani
    // kullanıcı bu veriyle önceliklendirme yapmak istiyorsa), bir satırda ikisi de
    // 0/boşsa o markayı hiç sisteme eklemiyoruz — SmartScout gibi araçlarda "veri
    // yok/aktif değil" genelde 0 olarak dışa aktarılır, bu markalar işe yaramaz.
    // Dosyada bu sütunlar hiç yoksa (ör. sade bir marka adı listesi) bu filtre
    // devreye girmez, normal şekilde herkes eklenir.
    const hasScoreColumn = Boolean(enrichmentMap.brand_score);
    const hasRevenueColumn = Boolean(enrichmentMap.est_monthly_revenue);

    const insertMany = db.transaction((items) => {
      for (const item of items) {
        const name = String(item[nameKey] || "").trim();
        if (!name) continue;
        const nameNorm = name.toLowerCase();

        if (existingNames.has(nameNorm)) {
          skippedExistingCount++;
          continue;
        }

        const website = websiteKey ? String(item[websiteKey] || "").trim() : "";
        const enrichment = extractEnrichment(item, enrichmentMap);

        if (hasScoreColumn || hasRevenueColumn) {
          const scoreEmpty = !enrichment.brand_score;
          const revenueEmpty = !enrichment.est_monthly_revenue;
          if (scoreEmpty && revenueEmpty) {
            skippedNoDataCount++;
            continue;
          }
        }

        existingNames.add(nameNorm);

        // Website henüz aranmadığı için Opportunity Score'un "web sitesi güveni"
        // bileşeni bu aşamada nötr çıkar — e-mail bulunduğunda (find-email) skor
        // otomatik olarak yeniden hesaplanıp güncellenir.
        const { score: initialScore, breakdown: initialBreakdown } = computeOpportunityScore({
          brand_score: enrichment.brand_score,
          est_monthly_revenue: enrichment.est_monthly_revenue,
          total_reviews: enrichment.total_reviews,
          main_category: enrichment.main_category,
          website: null,
          confidence: null,
          avg_sellers: enrichment.avg_sellers,
          avg_fba_sellers: enrichment.avg_fba_sellers,
        });

        insert.run(
          batch, batchName, batchUploadedAt, name, nameNorm, website, null, null, "unknown", "pending", null,
          enrichment.brand_score, enrichment.main_category, enrichment.subcategory,
          enrichment.est_monthly_revenue, enrichment.est_monthly_sales, enrichment.avg_price,
          enrichment.avg_fba_sellers, enrichment.avg_sellers, enrichment.dominant_seller,
          enrichment.sales_percentage, enrichment.amazon_in_stock_rate, enrichment.avg_rating,
          enrichment.total_reviews, enrichment.growth_12m, enrichment.product_count,
          enrichment.storefront_url, enrichment.country,
          initialScore, JSON.stringify(initialBreakdown), "new_lead"
        );
      }
    });
    insertMany(rows);

    const brands = db.prepare("SELECT * FROM brands WHERE batch = ? ORDER BY id").all(batch);
    res.json({
      ok: true,
      batch,
      batchName,
      batchUploadedAt,
      count: brands.length,
      brands,
      skippedExistingCount,
      skippedNoDataCount,
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
    .prepare("SELECT batch, batch_name, batch_uploaded_at FROM brands ORDER BY id DESC LIMIT 1")
    .get();
  // v71 QA fix: action_badge'i (DO_NOT_CONTACT dahil) LEFT JOIN ile birlikte
  // çekiyoruz — böylece marka listesindeki "Gönder" butonu, her satır için ayrı
  // bir istek atmadan, DO_NOT_CONTACT markalarda baştan pasif gösterilebiliyor
  // (bkz. public/js/app.js satır ~683 send-btn disabled koşulu).
  const brands = db
    .prepare(
      `SELECT brands.*, brand_intelligence.action_badge AS action_badge
       FROM brands LEFT JOIN brand_intelligence ON brand_intelligence.brand_id = brands.id
       ORDER BY brands.id`
    )
    .all();
  res.json({
    brands,
    batch: lastBatchRow ? lastBatchRow.batch : null,
    batchName: lastBatchRow ? lastBatchRow.batch_name : null,
    batchUploadedAt: lastBatchRow ? lastBatchRow.batch_uploaded_at : null,
  });
});

// v21'den önce yüklenen dosyalarda (ya da tekrar önleme devreye girmeden önce
// yüklenmiş aynı Excel'lerde) aynı marka birden fazla satır olarak kalmış olabilir.
// Yeni yüklemeler artık zaten tekrar eklemiyor, ama sistemde önceden birikmiş
// tekrarları temizlemek için bu buton var. Her aynı-isim grubunda "en gelişmiş"
// durumdaki kaydı tutuyoruz (gönderilmiş > bulunmuş > aranmış ama bulunamamış >
// beklemede; eşitlikte e-maili olan ve en eski kayıt tercih edilir), gerisini
// send_log'uyla birlikte siliyoruz — böylece "Seçilenleri Gönder" aynı markaya
// 2-3 kez mail atmaz.
function brandPriorityScore(b) {
  let score = 0;
  if (b.status === "sent") score += 100;
  else if (b.status === "found") score += 50;
  else if (b.status === "not_found" || b.status === "error") score += 10;
  if (b.email) score += 5;
  if (b.brand_score || b.est_monthly_revenue) score += 2;
  return score;
}

router.post("/api/brands/dedupe", (req, res) => {
  try {
    const groups = db
      .prepare(
        `SELECT name_normalized, COUNT(*) as c FROM brands
         WHERE name_normalized IS NOT NULL AND name_normalized != ''
         GROUP BY name_normalized HAVING c > 1`
      )
      .all();

    let removed = 0;
    const deleteBrand = db.prepare("DELETE FROM brands WHERE id = ?");
    const deleteLogs = db.prepare("DELETE FROM send_log WHERE brand_id = ?");
    const getGroupRows = db.prepare("SELECT * FROM brands WHERE name_normalized = ?");

    const runDedupe = db.transaction(() => {
      for (const g of groups) {
        const rows = getGroupRows.all(g.name_normalized);
        if (rows.length <= 1) continue;
        rows.sort((a, b) => {
          const diff = brandPriorityScore(b) - brandPriorityScore(a);
          if (diff !== 0) return diff;
          return a.id - b.id; // eşitlikte en eski (ilk yüklenen) kayıt tutulur
        });
        const [, ...duplicates] = rows;
        for (const dup of duplicates) {
          deleteLogs.run(dup.id);
          deleteBrand.run(dup.id);
          removed++;
        }
      }
    });
    runDedupe();

    res.json({ ok: true, removed, groupsAffected: groups.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Tekilleştirme sırasında hata oluştu: " + err.message });
  }
});

// v48: Yukarıdaki /api/brands/dedupe SADECE birebir aynı adları temizler. Bu uç
// nokta, "Nike Inc." / "NIKE LLC" gibi farklı YAZIMLARI (şirket eki, noktalama,
// küçük yazım farkı) tespit edip kullanıcıya İNCELEMESİ için sunar — otomatik
// SİLMEZ, çünkü fuzzy eşleşme yanlış pozitif üretebilir (ör. "Nike Golf" farklı
// bir marka olabilir). Kullanıcı gördüğü gruptan hangi kayıtları silmek
// istediğine /api/brands/fuzzy-duplicates/merge ile kendisi karar verir.
router.get("/api/brands/fuzzy-duplicates", (req, res) => {
  const brands = db.prepare("SELECT id, name, status, email, created_at FROM brands").all();
  const groups = findFuzzyDuplicateGroups(brands);
  // En büyük gruplar üstte, kullanıcı en çok etkiyi yapacak gruplardan başlasın.
  groups.sort((a, b) => b.brands.length - a.brands.length);
  res.json({ ok: true, groups, totalGroups: groups.length });
});

// Kullanıcının bir fuzzy grup içinde incelettikten sonra seçtiği kayıtları siler
// (keepId hariç). send_log kayıtları da birlikte temizlenir (dedupe route'uyla aynı mantık).
router.post("/api/brands/fuzzy-duplicates/merge", (req, res) => {
  const { keepId, removeIds } = req.body || {};
  if (!keepId || !Array.isArray(removeIds) || removeIds.length === 0) {
    return res.status(400).json({ error: "keepId ve removeIds (dizi) gerekli." });
  }
  const ids = removeIds.filter((id) => id !== keepId);
  const deleteLogs = db.prepare("DELETE FROM send_log WHERE brand_id = ?");
  const deleteBrand = db.prepare("DELETE FROM brands WHERE id = ?");
  const runMerge = db.transaction(() => {
    for (const id of ids) {
      deleteLogs.run(id);
      deleteBrand.run(id);
    }
  });
  runMerge();
  res.json({ ok: true, removed: ids.length });
});

// Aynı e-posta adresi başka bir markaya ait olarak zaten "sahiplenilmiş" mi?
// (o marka zaten gönderilmiş, ya da gönderilmeyi bekliyor, ya da zaten bu yüzden
// engellenmiş). Öyleyse bu markayı ayrı bir isimle aynı kutuya yazmak yerine
// engelliyoruz — aynı distribütör/şirketin birden fazla alt markası genelde aynı
// info@ adresine düşüyor ve farklı marka adıyla art arda mail gitmesi hem tuhaf
// görünür hem de alıcı tarafında spam gibi algılanma riskini artırır.
function findEmailOwner(email, excludeId) {
  if (!email) return null;
  return db
    .prepare(
      `SELECT id, name, status FROM brands
       WHERE LOWER(TRIM(email)) = LOWER(TRIM(?)) AND id != ?
         AND status IN ('sent', 'found', 'duplicate_blocked')
       ORDER BY id ASC LIMIT 1`
    )
    .get(email, excludeId);
}

// find-email sonucundan DB'ye yazılacak status/flag'i belirler: normal akışta
// result.email varsa 'found', yoksa 'not_found'; ama e-posta başka bir markaya
// aitse 'duplicate_blocked' olur.
function resolveStatusAndDuplicateFlag(email, brandId) {
  if (!email) return { status: "not_found", crossBrandDuplicate: 0, note: null };
  // Kalıcı "bir daha yazma" listesi her şeyin önünde gelir — bu e-posta daha önce
  // (başka bir marka adıyla bile olsa) net bir çıkış talebiyle bu listeye girdiyse
  // hiçbir koşulda gönderime açılmaz.
  if (isSuppressed(email)) {
    return {
      status: "duplicate_blocked",
      crossBrandDuplicate: 1,
      note: `Bu e-posta kalıcı "bir daha yazma" listesinde — gönderim engellendi.`,
    };
  }
  const owner = findEmailOwner(email, brandId);
  if (owner) {
    return {
      status: "duplicate_blocked",
      crossBrandDuplicate: 1,
      note: `Bu e-posta zaten "${owner.name}" markasına ait/gönderilmiş — aynı kutuya farklı marka adıyla tekrar mail engellendi.`,
    };
  }
  return { status: "found", crossBrandDuplicate: 0, note: null };
}

// Arama sağlayıcılarından biri (Serper/SerpAPI/Hunter) kota bitmiş gibi görünen
// bir hata verdiğinde emailFinder.js bunu trace mesajlarına ekliyor (ör. "kotası
// bitmiş görünüyor", "HTTP 429"). Bu sessizce geçip gidiyordu — kullanıcı sadece
// bulma oranının garip şekilde düştüğünü fark edebiliyordu, NEDENİNİ anlaması
// zordu. Şimdi bu kalıpları trace'te yakalayıp günde en fazla bir kez bildirim
// mailiyle haber veriyoruz (yüzlerce marka için tekrar tekrar göndermemek için).
const QUOTA_TRACE_PATTERN = /kotas[ıi] bitmiş|HTTP 429|insufficient credit|run out|no searches left/i;

async function checkAndNotifyQuotaExhaustion(traceLines) {
  if (!traceLines || !traceLines.some((line) => QUOTA_TRACE_PATTERN.test(line))) return;
  try {
    const settings = db.prepare("SELECT quota_alert_notified_at FROM settings WHERE id = 1").get();
    if (settings.quota_alert_notified_at) {
      const ageMs = Date.now() - new Date(settings.quota_alert_notified_at).getTime();
      if (ageMs < 24 * 60 * 60 * 1000) return; // son 24 saatte zaten bildirim gitmiş
    }
    const matchedLines = traceLines.filter((line) => QUOTA_TRACE_PATTERN.test(line));
    await mailer.sendMail({
      to: process.env.EMAIL_USER,
      subject: "⚠️ Arama sağlayıcılarından biri kota bitmiş gibi görünüyor",
      body:
        `Marka e-mail arama sırasında şu uyarı(lar) tespit edildi:\n\n${matchedLines.slice(0, 5).join("\n")}\n\n` +
        `Bu genelde Serper.dev, SerpAPI ya da Hunter.io hesaplarından birinin aylık kotasının bittiği anlamına gelir. ` +
        `Panelin sağ üstündeki "API Kredileri" panelinden hangi servisin bittiğini kontrol edebilir, gerekirse planını ` +
        `yükseltebilir ya da bir sonraki ay/faturalama döngüsünü bekleyebilirsin. Sistem otomatik olarak diğer sağlayıcılara ` +
        `(varsa) geçmeye devam ediyor, ama hiçbiri kalmazsa bulma oranı düşebilir.`,
    });
    db.prepare("UPDATE settings SET quota_alert_notified_at = CURRENT_TIMESTAMP WHERE id = 1").run();
  } catch (e) {
    // Bildirim gönderilemezse sessizce geç — asıl email arama akışını bozmasın.
  }
}

// Tek bir marka için email arat
router.post("/api/brands/:id/find-email", async (req, res) => {
  const brand = db.prepare("SELECT * FROM brands WHERE id = ?").get(req.params.id);
  if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });

  try {
    const result = await findBrandEmail(brand.name, brand.website, {
      mainCategory: brand.main_category,
      subcategory: brand.subcategory,
      storefrontUrl: brand.storefront_url,
    });
    // "bounced = 0": bu marka daha önce "mail geri döndü" (bounce) olarak
    // işaretlenmiş olabilir — burada elle ya da "Tekrar E-mail Ara" ile yeniden
    // arama yapılıyorsa, eski bounce bayrağını temizliyoruz ki yeni bulunan e-mail
    // "Ulaşmayanlar" listesinde takılı kalmasın.
    const { status: resolvedStatus, crossBrandDuplicate, note } = resolveStatusAndDuplicateFlag(
      result.email,
      brand.id
    );
    const traceLines = [...(result.trace || [])];
    if (note) traceLines.push(note);
    await checkAndNotifyQuotaExhaustion(traceLines);
    db.prepare(
      `UPDATE brands SET email = ?, website = COALESCE(?, website), email_source = ?, confidence = ?, status = ?, last_error = ?, contact_page_url = ?, bounced = 0, cross_brand_duplicate_email = ?, phone = COALESCE(?, phone), hunter_raw_contacts = COALESCE(?, hunter_raw_contacts)
       WHERE id = ?`
    ).run(
      result.email,
      result.website,
      result.source,
      result.confidence,
      resolvedStatus,
      traceLines.join(" | "),
      result.contactUrl || null,
      crossBrandDuplicate,
      result.phone || null,
      result.hunterRawContacts ? JSON.stringify(result.hunterRawContacts) : null,
      brand.id
    );
    const updated = db.prepare("SELECT * FROM brands WHERE id = ?").get(brand.id);
    // Website/confidence artık bilindiği için Opportunity Score'u güncelle; e-mail
    // bulunduysa CRM pipeline'ı da "E-mail Bulundu" aşamasına ilerlet (asla geri almaz).
    recomputeAndSaveScore(updated);
    if (updated.status === "found") advanceCrmStage(updated.id, updated.crm_stage, "email_found");
    await maybeDetectWholesalePage(updated);
    const final = db.prepare("SELECT * FROM brands WHERE id = ?").get(brand.id);
    res.json({ brand: final });
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
let findAllJob = { batch: null, remainingIds: [], running: false, total: 0, processedCount: 0, currentBrandName: null };

async function processFindAllQueue() {
  findAllJob.running = true;
  while (findAllJob.remainingIds.length > 0 && findAllJob.running) {
    const id = findAllJob.remainingIds.shift();
    const brand = db.prepare("SELECT * FROM brands WHERE id = ?").get(id);
    if (!brand) continue;
    findAllJob.currentBrandName = brand.name;
    try {
      const result = await findBrandEmail(brand.name, brand.website, {
        mainCategory: brand.main_category,
        subcategory: brand.subcategory,
        storefrontUrl: brand.storefront_url,
      });
      const { status: resolvedStatus, crossBrandDuplicate, note } = resolveStatusAndDuplicateFlag(
        result.email,
        brand.id
      );
      const traceLines = [...(result.trace || [])];
      if (note) traceLines.push(note);
      await checkAndNotifyQuotaExhaustion(traceLines);
      db.prepare(
        `UPDATE brands SET email = ?, website = COALESCE(?, website), email_source = ?, confidence = ?, status = ?, last_error = ?, contact_page_url = ?, bounced = 0, cross_brand_duplicate_email = ?, phone = COALESCE(?, phone), hunter_raw_contacts = COALESCE(?, hunter_raw_contacts)
         WHERE id = ?`
      ).run(
        result.email,
        result.website,
        result.source,
        result.confidence,
        resolvedStatus,
        traceLines.join(" | "),
        result.contactUrl || null,
        crossBrandDuplicate,
        result.phone || null,
        result.hunterRawContacts ? JSON.stringify(result.hunterRawContacts) : null,
        brand.id
      );
      const updatedBrand = db.prepare("SELECT * FROM brands WHERE id = ?").get(brand.id);
      recomputeAndSaveScore(updatedBrand);
      if (updatedBrand.status === "found") advanceCrmStage(updatedBrand.id, updatedBrand.crm_stage, "email_found");
      await maybeDetectWholesalePage(updatedBrand);
    } catch (err) {
      db.prepare("UPDATE brands SET status = 'error', last_error = ? WHERE id = ?").run(
        err.message,
        brand.id
      );
    }
    findAllJob.processedCount++;
  }
  findAllJob.running = false;
  findAllJob.currentBrandName = null;
}

// Tüm liste için toplu email arama (arka planda sırayla, durdurulabilir/devam
// ettirilebilir). Sadece henüz hiç aranmamış (pending) ya da başarısız olmuş
// (not_found/error) markaları dener — zaten bulunmuş (found) markaları tekrar
// aratmaz, böylece SerpAPI/Serper/Hunter kotan boşa harcanmaz. Bir markayı elle
// tekrar aratmak istersen tablodaki "Ara" butonunu kullanabilirsin.
// Panel artık tek bir birleşik marka listesi gösterdiği için (bkz. GET /api/brands),
// bu da tek bir yükleme/batch ile sınırlı değil — sistemdeki tüm uygun markaları kapsar.
// "ids" gönderilirse (örn. "Seçilenler için Email Ara" butonu), sadece o
// markalar aranır — statüsü ne olursa olsun. Gönderilmezse eski davranış
// (pending/not_found/error olan tüm markalar) korunur. Bu sayede seçili
// markalar için arama da, tüm liste araması gibi, sunucuda arka planda
// çalışır ve başka bir sayfaya geçilse bile durmaz.
router.post("/api/brands/find-all", async (req, res) => {
  if (findAllJob.running) {
    return res.status(409).json({ error: "Zaten devam eden bir arama var. Önce durdur ya da bitmesini bekle." });
  }
  const { ids } = req.body || {};
  let targetIds;
  if (Array.isArray(ids) && ids.length > 0) {
    targetIds = ids;
  } else {
    const brands = db
      .prepare("SELECT id FROM brands WHERE status IN ('pending', 'not_found', 'error')")
      .all();
    targetIds = brands.map((b) => b.id);
  }

  findAllJob = {
    batch: null,
    remainingIds: targetIds.slice(),
    running: false,
    total: targetIds.length,
    processedCount: 0,
    currentBrandName: null,
  };
  res.json({ ok: true, queued: targetIds.length });
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
    total: findAllJob.total,
    processedCount: findAllJob.processedCount,
    currentBrandName: findAllJob.currentBrandName,
  });
});

// Marka bilgisini manuel düzenle (email/website)
router.put("/api/brands/:id", (req, res) => {
  const { email, website, status, notes } = req.body;
  const brand = db.prepare("SELECT * FROM brands WHERE id = ?").get(req.params.id);
  if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });

  db.prepare("UPDATE brands SET email = ?, website = ?, status = ?, notes = ? WHERE id = ?").run(
    email !== undefined ? email : brand.email,
    website !== undefined ? website : brand.website,
    status !== undefined ? status : brand.status,
    notes !== undefined ? notes : brand.notes,
    brand.id
  );
  res.json({ ok: true });
});

// Bir marka (yeniden) "gönderildi" durumuna her geçtiğinde, önceki gönderim
// döngüsünden kalma takip alanlarını (bounce, yanıt, follow-up aşaması vb.)
// sıfırlıyoruz. Bunu yapmazsak, ör. bir mail geri döndükten (bounce) sonra
// e-maili düzeltip tekrar gönderdiğinde eski "bounced = 1" bayrağı kalıcı olarak
// orada kalır ve sistem bu markayı bir daha ASLA yanıt/bounce taramasına almaz
// (runFullCheck'teki "WHERE ... bounced = 0" filtresine sonsuza dek takılır).
const RESET_TRACKING_ON_SEND_SQL = `
  bounced = 0, replied = 0, reply_sentiment = NULL, reply_snippet = NULL, reply_from = NULL,
  notified = 0, follow_up_stage = 0, last_follow_up_at = NULL, last_checked_at = NULL
`;

// Bir markaya, sistemin mailer'ı yerine iletişim formu üzerinden elle mail
// gönderildiğinde ("Form Aç" ile form açılıp içerik yapıştırıldıktan sonra),
// bunu sisteme "gönderildi" olarak işaretlemek için. Bu marka artık tekrar
// gönderim/kara liste mantığına dahil olur; e-mail adresi yoksa otomatik
// follow-up'a girmez (gönderilecek bir adres olmadığı için zaten atlanır).
router.post("/api/brands/:id/mark-contact-sent", (req, res) => {
  const brand = db.prepare("SELECT * FROM brands WHERE id = ?").get(req.params.id);
  if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });

  db.prepare(
    `UPDATE brands SET status = 'sent', sent_at = CURRENT_TIMESTAMP, sent_via = 'contact_form', ${RESET_TRACKING_ON_SEND_SQL} WHERE id = ?`
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
  // v71 QA fix: DO_NOT_CONTACT her şeyin önünde gelir (suppression listesinden
  // bile önce) — Brand Intelligence bu markanın Amazon/marketplace'te satışının
  // yasak olduğunu ya da kritik bir red flag taşıdığını tespit etti.
  if (isDoNotContact(brand.id)) {
    return res.status(409).json({
      error:
        "Bu marka DO_NOT_CONTACT durumunda — Brand Intelligence araştırması Amazon/marketplace satışının yasak olduğunu ya da kritik bir red flag bulunduğunu tespit etti. Gönderim engellendi (Marka Detay -> Brand Intelligence sekmesinden nedenini görebilirsin).",
    });
  }
  // Kalıcı "bir daha yazma" listesi her şeyin önünde gelir.
  if (isSuppressed(brand.email)) {
    return res.status(409).json({
      error: `Bu e-posta adresi (${brand.email}) kalıcı "bir daha yazma" listesinde — gönderim engellendi.`,
    });
  }
  // UI zaten bu durumdaki gönder butonunu pasif yapıyor ama API doğrudan çağrılırsa
  // diye burada da engelliyoruz: bu e-posta başka bir markaya ait/gönderilmiş.
  const owner = findEmailOwner(brand.email, brand.id);
  if (owner) {
    return res.status(409).json({
      error: `Bu e-posta adresi (${brand.email}) zaten "${owner.name}" markasına ait/gönderilmiş görünüyor — aynı kutuya farklı marka adıyla tekrar mail gönderilmedi.`,
    });
  }

  const { subject, body } = req.body;
  // v59: tek marka manuel gönderiminde de round robin uygulanır (ek hesap
  // tanımlanmamışsa her zaman birincil .env hesabını döndürür, davranış değişmez).
  // v58: burada subject/body kullanıcı o an elle yazdığı/düzenlediği için A/B
  // varyantları BİLEREK uygulanmıyor — sadece toplu/otomatik gönderimlerde devreye girer.
  const account = mailer.pickSenderAccount();
  try {
    const info = await mailer.sendMail({ to: brand.email, subject, body, account, trackOpenBrandId: brand.id });
    if (account) mailer.recordAccountSend(account.email);
    // Bug fix: gönderilen mailin Message-ID'sini kaydediyoruz — gelen yanıtları
    // In-Reply-To/References başlığıyla eşleştirip HANGİ markaya ait olduğunu
    // kesin olarak belirlemek için (bkz. inboxChecker.js checkRepliesForMany).
    db.prepare(
      `UPDATE brands SET status = 'sent', sent_at = CURRENT_TIMESTAMP, sent_via_account = ?, sent_message_id = ?, ${RESET_TRACKING_ON_SEND_SQL} WHERE id = ?`
    ).run(account ? account.email : null, (info && info.messageId) || null, brand.id);
    db.prepare("INSERT INTO send_log (brand_id, status, message) VALUES (?, 'sent', ?)").run(
      brand.id,
      `${brand.email} adresine gönderildi.`
    );
    advanceCrmStage(brand.id, brand.crm_stage, "email_sent");
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

// Kademeli ısınma açıksa, günlük limit hedefe (daily_send_limit) tek seferde değil,
// warmup_started_at'ten itibaren her hafta warmup_increment kadar artarak ulaşır.
// Kapalıysa ya da başlangıç zamanı hiç ayarlanmadıysa hedefin kendisi kullanılır
// (eskisi gibi davranır — geriye dönük uyumlu).
function getEffectiveDailyLimit(settings) {
  const target = Number(settings.daily_send_limit) || 0;
  if (!settings.warmup_enabled || !settings.warmup_started_at) return target;

  const startLimit = Number(settings.warmup_start_limit) || 10;
  const increment = Number(settings.warmup_increment) || 10;
  const daysElapsed = Math.floor(
    (Date.now() - new Date(settings.warmup_started_at).getTime()) / (1000 * 60 * 60 * 24)
  );
  const weeksElapsed = Math.max(0, Math.floor(daysElapsed / 7));
  const current = startLimit + weeksElapsed * increment;
  return Math.min(current, target);
}

// Excel'deki "Country" sütununda sıkça görülen ülke adlarının (yaklaşık, tek bir
// temsili) UTC ofseti. Birçok ülke (ör. ABD, Rusya) birden fazla saat dilimine
// yayılıyor — bu durumlarda en yaygın/kalabalık bölgeyi temsil eden bir ofis
// seçildi. Amaç kesin doğruluk değil, "gece yarısı mail atma" gibi bariz kötü
// zamanlamaları önlemek; ülke bulunamazsa ya da eşleşmezse gönderim ENGELLENMEZ
// (aşağıdaki fail-open mantığı), sadece bulunanlar için ince bir iyileştirme yapılır.
const COUNTRY_UTC_OFFSETS = {
  "united states": -5, us: -5, usa: -5, "u.s.": -5, "u.s.a.": -5,
  "united kingdom": 0, uk: 0, "u.k.": 0, britain: 0,
  canada: -5, germany: 1, france: 1, italy: 1, spain: 1, netherlands: 1,
  belgium: 1, switzerland: 1, austria: 1, poland: 1, sweden: 1, norway: 1,
  denmark: 1, portugal: 0, ireland: 0,
  turkey: 3, türkiye: 3, russia: 3,
  china: 8, japan: 9, "south korea": 9, korea: 9,
  india: 5.5, pakistan: 5, bangladesh: 6,
  australia: 10, "new zealand": 12,
  brazil: -3, mexico: -6, argentina: -3, chile: -4, colombia: -5,
  "united arab emirates": 4, uae: 4, "saudi arabia": 3, israel: 2, egypt: 2,
  "south africa": 2, nigeria: 1,
  vietnam: 7, thailand: 7, indonesia: 7, philippines: 8, malaysia: 8, singapore: 8,
};

function normalizeCountryKey(country) {
  return (country || "").trim().toLowerCase();
}

// Verilen ülke için şu an yerel iş saatleri (09:00-18:00) içinde miyiz? Ülke
// bilinmiyorsa/eşleşmiyorsa "evet" döner (fail-open) — veri eksikliği yüzünden
// gönderimin tamamen durmasını istemiyoruz, bu sadece bilinen ülkeler için bir
// iyileştirme.
function isLikelyBusinessHoursForCountry(country, now = new Date()) {
  const key = normalizeCountryKey(country);
  if (!key || !(key in COUNTRY_UTC_OFFSETS)) return true;
  const offset = COUNTRY_UTC_OFFSETS[key];
  const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60;
  let localHours = (utcHours + offset) % 24;
  if (localHours < 0) localHours += 24;
  return localHours >= 9 && localHours < 18;
}

// Günlük gönderim limitini aşmadan, gün içine yayılmış şekilde otomatik mail gönderir.
// server.js'teki cron her ~10 dakikada bir bu fonksiyonu çağırır; her çağrıda en fazla
// 1 mail gönderir, böylece örn. "günde 60" ayarı gün boyuna doğal şekilde yayılmış olur
// (60 mail art arda gönderilirse Gmail/alıcı tarafında spam gibi görünme riski artar).
async function runAutoSend() {
  const settings = db.prepare("SELECT * FROM settings WHERE id = 1").get();
  const limit = getEffectiveDailyLimit(settings);
  if (limit <= 0) return { sent: 0, reason: "disabled" };
  if (settings.circuit_breaker_active) return { sent: 0, reason: "circuit_breaker_active" };
  if (!settings.main_subject || !settings.main_body) {
    return { sent: 0, reason: "template_missing" };
  }

  const todayStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const sentTodayRow = db
    .prepare("SELECT COUNT(*) as c FROM brands WHERE status = 'sent' AND substr(sent_at, 1, 10) = ?")
    .get(todayStr);
  if (sentTodayRow.c >= limit) return { sent: 0, reason: "limit_reached", sentToday: sentTodayRow.c };

  // İlk bulunanı değil, değer sırasına göre bir GRUP aday çekiyoruz (LIMIT 1 değil) —
  // çünkü en değerli aday şu an markanın kendi ülkesinde gece yarısı olabilir; o
  // durumda sırasıyla bir sonraki en değerli, o an iş saatlerinde olan adaya geçiyoruz.
  // Ülke bilinmiyorsa aday zaten uygun sayılır (bkz. isLikelyBusinessHoursForCountry).
  // v71 QA fix: DO_NOT_CONTACT markalar aday havuzuna hiç girmemeli — otomatik
  // gönderim bunları asla seçmemeli (bkz. isDoNotContact yorumu).
  const candidatePool = db
    .prepare(
      `SELECT * FROM brands WHERE status = 'found' AND email IS NOT NULL
       AND (confidence IS NULL OR confidence != 'low')
       AND (cross_brand_duplicate_email IS NULL OR cross_brand_duplicate_email = 0)
       AND (suppressed IS NULL OR suppressed = 0)
       AND id NOT IN (SELECT brand_id FROM brand_intelligence WHERE action_badge = 'DO_NOT_CONTACT')
       ORDER BY COALESCE(brand_score, 0) DESC, COALESCE(est_monthly_revenue, 0) DESC, id ASC
       LIMIT 25`
    )
    .all();
  if (candidatePool.length === 0) return { sent: 0, reason: "no_candidates" };

  const candidate = candidatePool.find((b) => isLikelyBusinessHoursForCountry(b.country));
  if (!candidate) {
    return { sent: 0, reason: "no_candidates_in_business_hours" };
  }

  // v58: subject_variants/body_variants tanımlıysa (A/B test), her otomatik
  // gönderimde rastgele bir varyant seçilir; tanımlı DEĞİLSE (varsayılan) eskisi
  // gibi main_subject/main_body şablonu birebir kullanılır — davranış değişmez.
  const subjectVariants = safeParseArray(settings.subject_variants);
  const bodyVariants = safeParseArray(settings.body_variants);
  const chosenSubjectTemplate = pickVariant(subjectVariants, settings.main_subject);
  const chosenBodyTemplate = pickVariant(bodyVariants, settings.main_body);
  const subject = fillTemplateLocal(chosenSubjectTemplate, candidate.name);
  const body = fillTemplateLocal(chosenBodyTemplate, candidate.name);
  // v59: birden fazla gönderici hesabı tanımlıysa aralarında round robin yapar;
  // tanımlı DEĞİLSE (varsayılan) her zaman .env'deki birincil hesabı döndürür.
  const account = mailer.pickSenderAccount();
  try {
    const info = await mailer.sendMail({
      to: candidate.email,
      subject,
      body,
      account,
      trackOpenBrandId: candidate.id,
    });
    if (account) mailer.recordAccountSend(account.email);
    // Bug fix: Message-ID kaydı — bkz. /api/brands/:id/send içindeki açıklama.
    db.prepare(
      `UPDATE brands SET status = 'sent', sent_at = CURRENT_TIMESTAMP, sent_variant_subject = ?, sent_variant_body = ?, sent_via_account = ?, sent_message_id = ?, ${RESET_TRACKING_ON_SEND_SQL} WHERE id = ?`
    ).run(
      subjectVariants.length > 0 ? chosenSubjectTemplate : null,
      bodyVariants.length > 0 ? chosenBodyTemplate : null,
      account ? account.email : null,
      (info && info.messageId) || null,
      candidate.id
    );
    db.prepare("INSERT INTO send_log (brand_id, status, message) VALUES (?, 'sent', ?)").run(
      candidate.id,
      `Otomatik günlük gönderim (limit: ${limit}/gün): ${candidate.email}`
    );
    advanceCrmStage(candidate.id, candidate.crm_stage, "email_sent");
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

// Toplu gönderim (seçilenler / bulunan tüm e-maillere) artık TARAYICIDA bir döngü
// olarak değil, sunucuda (find-all aramasıyla aynı desende) arka planda çalışıyor.
// Eskiden tarayıcının sekmesi kapatılınca ya da başka bir sayfaya (Dashboard,
// Gönderim Takibi vb.) geçilince bu döngü de HTTP bağlantısıyla birlikte kesiliyor,
// yani gönderim yarıda kalıyordu — kullanıcı başka sekmeye geçtiğinde işlemin
// durmasının asıl sebebi buydu. Artık istek gönderilir gönderilmez (kuyruk
// başlatılıp yanıt hemen dönülür) işlem sunucu tarafında, tarayıcıdan tamamen
// bağımsız devam ediyor; panel sadece durumu periyodik olarak (polling) sorup
// ilerlemeyi gösteriyor.
let sendJob = {
  remainingIds: [],
  running: false,
  subject: "",
  body: "",
  total: 0,
  sentCount: 0,
  failedCount: 0,
  currentBrandName: null,
};

async function processSendQueue() {
  sendJob.running = true;
  // v58: Ayarlar'da subject_variants/body_variants tanımlıysa, toplu gönderimde
  // panelde yazılan sabit subject/body YERİNE her marka için rastgele bir varyant
  // kullanılır (A/B test). Tanımlı DEĞİLSE (varsayılan) eskisi gibi sendJob.subject/
  // body birebir kullanılır — davranış değişmez.
  const abSettings = db.prepare("SELECT subject_variants, body_variants FROM settings WHERE id = 1").get();
  const subjectVariants = safeParseArray(abSettings && abSettings.subject_variants);
  const bodyVariants = safeParseArray(abSettings && abSettings.body_variants);
  while (sendJob.remainingIds.length > 0 && sendJob.running) {
    const id = sendJob.remainingIds.shift();
    const brand = db.prepare("SELECT * FROM brands WHERE id = ?").get(id);
    sendJob.currentBrandName = brand ? brand.name : null;
    if (!brand || !brand.email) {
      sendJob.failedCount++;
      continue;
    }
    // Tekli gönderim rotasındakiyle (POST /api/brands/:id/send) BİREBİR aynı
    // korumalar — kalıcı "bir daha yazma" listesi, DO_NOT_CONTACT ve çapraz
    // marka tekrar koruması toplu gönderimde de atlanmaz.
    if (isDoNotContact(brand.id)) {
      sendJob.failedCount++;
      db.prepare("INSERT INTO send_log (brand_id, status, message) VALUES (?, 'blocked', ?)").run(
        brand.id,
        "Toplu gönderimde atlandı: DO_NOT_CONTACT (Brand Intelligence Amazon/marketplace satışını yasaklıyor)."
      );
      continue;
    }
    if (isSuppressed(brand.email)) {
      sendJob.failedCount++;
      continue;
    }
    const owner = findEmailOwner(brand.email, brand.id);
    if (owner) {
      sendJob.failedCount++;
      continue;
    }
    const chosenSubjectTemplate = pickVariant(subjectVariants, sendJob.subject);
    const chosenBodyTemplate = pickVariant(bodyVariants, sendJob.body);
    const subject = fillTemplateLocal(chosenSubjectTemplate, brand.name);
    const body = fillTemplateLocal(chosenBodyTemplate, brand.name);
    const account = mailer.pickSenderAccount();
    try {
      const info = await mailer.sendMail({ to: brand.email, subject, body, account, trackOpenBrandId: brand.id });
      if (account) mailer.recordAccountSend(account.email);
      // Bug fix: Message-ID kaydı — bkz. /api/brands/:id/send içindeki açıklama.
      db.prepare(
        `UPDATE brands SET status = 'sent', sent_at = CURRENT_TIMESTAMP, sent_variant_subject = ?, sent_variant_body = ?, sent_via_account = ?, sent_message_id = ?, ${RESET_TRACKING_ON_SEND_SQL} WHERE id = ?`
      ).run(
        subjectVariants.length > 0 ? chosenSubjectTemplate : null,
        bodyVariants.length > 0 ? chosenBodyTemplate : null,
        account ? account.email : null,
        (info && info.messageId) || null,
        brand.id
      );
      db.prepare("INSERT INTO send_log (brand_id, status, message) VALUES (?, 'sent', ?)").run(
        brand.id,
        `${brand.email} adresine gönderildi (toplu gönderim).`
      );
      advanceCrmStage(brand.id, brand.crm_stage, "email_sent");
      sendJob.sentCount++;
    } catch (err) {
      db.prepare("INSERT INTO send_log (brand_id, status, message) VALUES (?, 'error', ?)").run(
        brand.id,
        err.message
      );
      sendJob.failedCount++;
    }
    // Aynı gönderim ritmi mantığı (rastgele 2-5 sn) — art arda tamamen düzenli
    // aralıklarla giden mailler otomasyon gibi göründüğü için spam filtrelerinde
    // şüphe uyandırabilir. Artık tarayıcıda değil, burada (sunucuda) uygulanıyor.
    if (sendJob.remainingIds.length > 0 && sendJob.running) {
      const jitter = 2000 + Math.floor(Math.random() * 3000);
      await new Promise((r) => setTimeout(r, jitter));
    }
  }
  sendJob.running = false;
  sendJob.currentBrandName = null;
}

// Seçilen (ya da "bulunan tüm e-mailler") marka ID'lerine, sabit bir şablonla
// (subject/body — {{marka}} her marka için ayrı ayrı doldurulur) toplu gönderim
// başlatır. İstek anında kuyruğu kurup HEMEN yanıt döner, gerçek gönderim
// arka planda (processSendQueue) devam eder.
router.post("/api/brands/send-batch", (req, res) => {
  if (sendJob.running) {
    return res.status(409).json({ error: "Zaten devam eden bir toplu gönderim var. Önce durdur ya da bitmesini bekle." });
  }
  const { ids, subject, body } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "Gönderilecek marka listesi boş." });
  }
  if (!subject || !body) {
    return res.status(400).json({ error: "Mail konusu/içeriği boş olamaz." });
  }
  sendJob = {
    remainingIds: ids.slice(),
    running: false,
    subject,
    body,
    total: ids.length,
    sentCount: 0,
    failedCount: 0,
    currentBrandName: null,
  };
  res.json({ ok: true, queued: ids.length });
  processSendQueue();
});

// Devam eden toplu gönderimi durdurur (o an gönderilmekte olan mail bitirilir,
// bir sonrakine geçilmez). Kalan markalar kuyrukta bekletilmez, iptal edilir —
// gönderim, tekli aramadan farklı olarak "kaldığı yerden devam et" desteklemiyor
// çünkü şablon (subject/body) o oturuma özgüydü.
router.post("/api/brands/send-batch/stop", (req, res) => {
  sendJob.running = false;
  const remaining = sendJob.remainingIds.length;
  sendJob.remainingIds = [];
  res.json({ ok: true, remaining });
});

// Panelin ilerleme kartını (sağ üst) ve butonlarını güncellemesi için periyodik
// olarak sorguladığı durum uç noktası.
router.get("/api/brands/send-batch/status", (req, res) => {
  res.json({
    running: sendJob.running,
    remaining: sendJob.remainingIds.length,
    total: sendJob.total,
    sentCount: sendJob.sentCount,
    failedCount: sendJob.failedCount,
    currentBrandName: sendJob.currentBrandName,
  });
});

// Bir markayı CRM pipeline'da manuel olarak taşır — otomatik ilerlemenin
// aksine (bkz. advanceCrmStage) burada kullanıcı GERİYE de alabilir (ör. yanlışlıkla
// ilerlemiş bir markayı düzeltmek için), çünkü bu elle yapılan bilinçli bir seçim.
router.put("/api/brands/:id/crm-stage", (req, res) => {
  const { stage } = req.body || {};
  if (!stage) return res.status(400).json({ error: "Aşama (stage) belirtilmedi." });
  const brand = db.prepare("SELECT * FROM brands WHERE id = ?").get(req.params.id);
  if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });
  const settings = db.prepare("SELECT crm_pipeline_stages FROM settings WHERE id = 1").get();
  const stages = getPipelineStages(settings);
  if (!stages.some((s) => s.key === stage)) {
    return res.status(400).json({ error: "Geçersiz pipeline aşaması." });
  }
  db.prepare("UPDATE brands SET crm_stage = ? WHERE id = ?").run(stage, brand.id);
  const label = (stages.find((s) => s.key === stage) || {}).label || stage;
  logEvent(brand.id, "stage_changed_manual", `Aşama (elle): ${label}`);
  res.json({ ok: true, crm_stage: stage });
});

// v53: Marka bazlı Timeline — send_log (gönderim denemeleri), brand_events (aşama
// değişimi, evrak yükleme, vs.) ve brands tablosundaki yanıt/bounce bilgisini tek
// kronolojik listede birleştirir. Sadece OKUMA yapar, hiçbir şeyi değiştirmez.
router.get("/api/brands/:id/timeline", (req, res) => {
  const brand = db.prepare("SELECT * FROM brands WHERE id = ?").get(req.params.id);
  if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });

  const events = [];

  events.push({
    type: "created",
    label: "Marka eklendi",
    detail: brand.batch_name || null,
    at: brand.batch_uploaded_at || brand.created_at || null,
  });

  const sendLogs = db
    .prepare("SELECT * FROM send_log WHERE brand_id = ? ORDER BY created_at ASC")
    .all(brand.id);
  for (const row of sendLogs) {
    events.push({
      type: row.status === "sent" ? "email_sent" : "send_error",
      label: row.status === "sent" ? "E-posta gönderildi" : "Gönderim hatası",
      detail: row.message || null,
      at: row.created_at,
    });
  }

  const brandEvents = db
    .prepare("SELECT * FROM brand_events WHERE brand_id = ? ORDER BY created_at ASC")
    .all(brand.id);
  for (const row of brandEvents) {
    events.push({
      type: row.event_type,
      label: eventTypeLabel(row.event_type),
      detail: row.message || null,
      at: row.created_at,
    });
  }

  if (brand.replied) {
    events.push({
      type: "replied",
      label: brand.reply_sentiment === "positive" ? "Olumlu yanıt alındı" : "Yanıt alındı",
      detail: brand.reply_snippet || null,
      at: brand.last_checked_at || null,
    });
  }
  if (brand.bounced) {
    events.push({
      type: "bounced",
      label: "E-posta geri döndü (bounce)",
      detail: brand.last_error || null,
      at: brand.last_checked_at || null,
    });
  }

  events.sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
  res.json({ brand: { id: brand.id, name: brand.name }, timeline: events });
});

function eventTypeLabel(type) {
  const map = {
    stage_changed: "CRM aşaması ilerledi",
    stage_changed_manual: "CRM aşaması değiştirildi (elle)",
    document_uploaded: "Evrak yüklendi",
    ai_personalized: "AI kişiselleştirme yapıldı",
    ai_priority_tagged: "AI öncelik/etiket verildi",
    ai_reply_classified: "AI yanıtı sınıflandırdı",
    wholesale_page_found: "Wholesale sayfası bulundu",
  };
  return map[type] || type;
}

// Opportunity Score'u tek bir marka için ya da (ids gönderilmezse) TÜM markalar
// için yeniden hesaplar. Excel'i yeni yükledikten hemen sonra skor zaten otomatik
// hesaplanıyor — bu uç nokta asıl, formülü/ağırlıkları güncelledikten sonra ESKİ
// (zaten sistemde olan) markaları da yeni formüle göre toplu güncellemek için var.
// v63: Wholesale/Distributor başvuru formunu otomatik doldurur (Playwright ile,
// isteğe bağlı — bkz. services/formFiller.js). ASLA otomatik göndermez: sadece
// doldurulmuş formun bir ekran görüntüsünü döner, kullanıcı inceleyip kendisi
// gönderir (URL'yi elle açıp aynı bilgileri kopyalayarak ya da tarayıcıda formu
// bulup göndererek). url gövdede verilmezse markanın v49'da tespit edilen
// wholesale_page_url'i kullanılır.
router.get("/api/form-filler/status", (req, res) => {
  res.json({ available: formFiller.isAvailable() });
});

router.post("/api/brands/:id/fill-wholesale-form", async (req, res) => {
  const brand = db.prepare("SELECT * FROM brands WHERE id = ?").get(req.params.id);
  if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });
  const url = (req.body && req.body.url) || brand.wholesale_page_url;
  if (!url) {
    return res.status(400).json({
      error: "Bu marka için bir wholesale/distributor sayfası tespit edilmemiş ve elle bir URL de verilmedi.",
    });
  }
  const settings = db.prepare("SELECT * FROM settings WHERE id = 1").get() || {};
  const fillData = {
    name: settings.name || "",
    email: process.env.EMAIL_USER || "",
    company: settings.company || "",
    phone: "",
    message: fillTemplateLocal(settings.offer_text || settings.main_body || "", brand.name),
  };
  try {
    const result = await formFiller.fillWholesaleForm(url, fillData);
    logEvent(brand.id, "wholesale_form_filled", `${url} (${result.filledFields.length} alan dolduruldu)`);
    res.json({ ok: true, url, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/brands/recompute-scores", (req, res) => {
  const { ids } = req.body || {};
  const targets =
    Array.isArray(ids) && ids.length > 0
      ? ids.map((id) => db.prepare("SELECT * FROM brands WHERE id = ?").get(id)).filter(Boolean)
      : db.prepare("SELECT * FROM brands").all();
  for (const brand of targets) {
    recomputeAndSaveScore(brand);
  }
  res.json({ ok: true, updated: targets.length });
});

module.exports = router;
module.exports.runAutoSend = runAutoSend;
// Aşağıdaki saf mantık fonksiyonları, kalıcı otomatik test setinin (tests/) gerçek
// üretim kodunu (kopya/simülasyon değil) doğrudan çağırıp doğrulayabilmesi için
// dışa aktarıldı — router'ın kendi davranışını değiştirmez, sadece test edilebilirlik
// ekler.
module.exports.findEmailOwner = findEmailOwner;
module.exports.resolveStatusAndDuplicateFlag = resolveStatusAndDuplicateFlag;
module.exports.getEffectiveDailyLimit = getEffectiveDailyLimit;
module.exports.isLikelyBusinessHoursForCountry = isLikelyBusinessHoursForCountry;
module.exports.QUOTA_TRACE_PATTERN = QUOTA_TRACE_PATTERN;
