const express = require("express");
const db = require("../db");
const { buildExcelReportBuffer, streamPdfReport } = require("../services/reporting");

const router = express.Router();

function pct(part, whole) {
  if (!whole) return 0;
  return Math.round((part / whole) * 1000) / 10; // bir ondalık basamak
}

router.get("/api/analytics", (req, res) => {
  const totalBrands = db.prepare("SELECT COUNT(*) c FROM brands").get().c;
  const foundEmails = db
    .prepare("SELECT COUNT(*) c FROM brands WHERE status IN ('found','sent','bounced') OR replied = 1")
    .get().c;
  const notFound = db.prepare("SELECT COUNT(*) c FROM brands WHERE status = 'not_found'").get().c;
  const sent = db.prepare("SELECT COUNT(*) c FROM brands WHERE status = 'sent' OR replied = 1 OR status = 'bounced'").get().c;
  const bounced = db.prepare("SELECT COUNT(*) c FROM brands WHERE bounced = 1").get().c;
  const replied = db.prepare("SELECT COUNT(*) c FROM brands WHERE replied = 1").get().c;
  const positive = db.prepare("SELECT COUNT(*) c FROM brands WHERE reply_sentiment = 'positive'").get().c;
  const negative = db.prepare("SELECT COUNT(*) c FROM brands WHERE reply_sentiment = 'negative'").get().c;
  const duplicateBlocked = db.prepare("SELECT COUNT(*) c FROM brands WHERE status = 'duplicate_blocked'").get().c;

  const dealStages = db
    .prepare(
      `SELECT deal_stage, COUNT(*) c FROM brands WHERE status = 'sent' OR replied = 1
       GROUP BY deal_stage`
    )
    .all();
  const dealStageCounts = { new: 0, meeting_scheduled: 0, sample_sent: 0, deal_closed: 0, rejected: 0 };
  dealStages.forEach((row) => {
    if (row.deal_stage && dealStageCounts.hasOwnProperty(row.deal_stage)) {
      dealStageCounts[row.deal_stage] = row.c;
    }
  });

  res.json({
    totalBrands,
    foundEmails,
    notFound,
    sent,
    bounced,
    replied,
    positive,
    negative,
    duplicateBlocked,
    dealStageCounts,
    rates: {
      emailFoundRate: pct(foundEmails, totalBrands),
      replyRate: pct(replied, sent),
      positiveRate: pct(positive, replied),
      dealClosedRate: pct(dealStageCounts.deal_closed, sent),
    },
  });
});

// v60: Gelişmiş analiz paneli (grafikler) için zaman serisi — son N günde her
// gün kaç mail gönderilmiş, kaç yanıt/olumlu yanıt gelmiş. sent_at/last_checked_at
// zaten ISO string olarak tutulduğu için substr(...,1,10) ile günlük gruplama yapılır.
router.get("/api/analytics/timeseries", (req, res) => {
  const days = Math.min(90, Math.max(7, Number(req.query.days) || 30));
  const sentRows = db
    .prepare(
      `SELECT substr(sent_at, 1, 10) as day, COUNT(*) c FROM brands
       WHERE sent_at IS NOT NULL AND sent_at >= date('now', ?)
       GROUP BY day ORDER BY day ASC`
    )
    .all(`-${days} days`);
  const repliedRows = db
    .prepare(
      `SELECT substr(last_checked_at, 1, 10) as day, COUNT(*) c FROM brands
       WHERE replied = 1 AND last_checked_at IS NOT NULL AND last_checked_at >= date('now', ?)
       GROUP BY day ORDER BY day ASC`
    )
    .all(`-${days} days`);
  const positiveRows = db
    .prepare(
      `SELECT substr(last_checked_at, 1, 10) as day, COUNT(*) c FROM brands
       WHERE replied = 1 AND reply_sentiment = 'positive' AND last_checked_at IS NOT NULL AND last_checked_at >= date('now', ?)
       GROUP BY day ORDER BY day ASC`
    )
    .all(`-${days} days`);

  res.json({
    days,
    sent: sentRows,
    replied: repliedRows,
    positive: positiveRows,
  });
});

// v58/v60: A/B test (Subject Rotation) sonuçları — hangi konu satırı varyantı kaç
// kez gönderildi, kaçı yanıt aldı, kaçı olumlu oldu. Hiç varyant kullanılmadıysa
// (subject_variants hiç tanımlanmadıysa) boş bir liste döner, panel bunu gösterir.
router.get("/api/analytics/ab-test", (req, res) => {
  const rows = db
    .prepare(
      `SELECT sent_variant_subject as variant, COUNT(*) as sentCount,
              SUM(CASE WHEN replied = 1 THEN 1 ELSE 0 END) as repliedCount,
              SUM(CASE WHEN replied = 1 AND reply_sentiment = 'positive' THEN 1 ELSE 0 END) as positiveCount
       FROM brands
       WHERE sent_variant_subject IS NOT NULL AND sent_variant_subject != ''
       GROUP BY sent_variant_subject
       ORDER BY sentCount DESC`
    )
    .all();
  res.json({ variants: rows });
});

// v61: Amazon analiz modülü — SmartScout tarzı Excel'lerden gelen Amazon
// metriklerini (ciro, rekabet, kategori) portföy genelinde özetler. Bu veriler
// zaten marka satırlarında tek tek görünüyor; burada TOPLU/karşılaştırmalı bir
// bakış sağlanır (hangi kategori en değerli, rekabet dağılımı nasıl, vs.).
router.get("/api/analytics/amazon-insights", (req, res) => {
  const withRevenue = db
    .prepare("SELECT COUNT(*) c FROM brands WHERE est_monthly_revenue IS NOT NULL AND est_monthly_revenue > 0")
    .get().c;
  const totals = db
    .prepare(
      `SELECT
         AVG(est_monthly_revenue) as avgRevenue,
         AVG(avg_price) as avgPrice,
         AVG(total_reviews) as avgReviews,
         AVG(avg_rating) as avgRating,
         SUM(CASE WHEN storefront_url IS NOT NULL AND storefront_url != '' THEN 1 ELSE 0 END) as withStorefront
       FROM brands`
    )
    .get();

  // Rekabet dağılımı: avg_sellers'a göre 3 kova (düşük/orta/yüksek rekabet).
  const competitionBuckets = db
    .prepare(
      `SELECT
         SUM(CASE WHEN avg_sellers IS NOT NULL AND avg_sellers <= 3 THEN 1 ELSE 0 END) as low,
         SUM(CASE WHEN avg_sellers > 3 AND avg_sellers <= 10 THEN 1 ELSE 0 END) as medium,
         SUM(CASE WHEN avg_sellers > 10 THEN 1 ELSE 0 END) as high,
         SUM(CASE WHEN avg_sellers IS NULL THEN 1 ELSE 0 END) as unknown
       FROM brands`
    )
    .get();

  // En değerli 10 kategori (toplam tahmini aylık ciroya göre).
  const topCategories = db
    .prepare(
      `SELECT COALESCE(NULLIF(TRIM(main_category), ''), 'Kategorisiz') as category,
              COUNT(*) as brandCount, SUM(COALESCE(est_monthly_revenue, 0)) as totalRevenue
       FROM brands
       GROUP BY category
       ORDER BY totalRevenue DESC
       LIMIT 10`
    )
    .all();

  const totalBrands = db.prepare("SELECT COUNT(*) c FROM brands").get().c;

  res.json({
    totalBrands,
    brandsWithRevenueData: withRevenue,
    avgMonthlyRevenue: Math.round(totals.avgRevenue || 0),
    avgPrice: Math.round((totals.avgPrice || 0) * 100) / 100,
    avgReviews: Math.round(totals.avgReviews || 0),
    avgRating: Math.round((totals.avgRating || 0) * 10) / 10,
    storefrontCoverage: pct(totals.withStorefront || 0, totalBrands),
    competitionBuckets,
    topCategories,
  });
});

// v62: Excel/PDF raporlama sistemi — mevcut Genel Durum panelinin (özet, oranlar,
// CRM dağılımı, en değerli kategoriler, TÜM markaların tam listesi) tek bir
// dosyada indirilebilir hali. Tracking sayfasındaki export (sadece takip
// tablosu) ile karışmasın diye burada ayrı, daha kapsamlı bir rapor üretilir.
router.get("/api/reports/excel", (req, res) => {
  try {
    const buffer = buildExcelReportBuffer();
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", "attachment; filename=performans-raporu.xlsx");
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Excel raporu oluşturulurken hata: " + err.message });
  }
});

router.get("/api/reports/pdf", (req, res) => {
  try {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=performans-raporu.pdf");
    streamPdfReport(res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: "PDF raporu oluşturulurken hata: " + err.message });
  }
});

module.exports = router;
