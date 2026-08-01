// v62: Excel/PDF raporlama sistemi. Excel için zaten bağımlılık olarak duran
// "xlsx" paketini (bkz. tracking.js'teki export özelliği) yeniden kullanır — yeni
// bir bağımlılık gerektirmez, sıfır ek risk. PDF için pdfkit eklendi: saf JS'tir
// (native derleme/tarayıcı indirmesi gerektirmez), bu yüzden Playwright'ın aksine
// Render'daki `npm install` adımını bozma riski yok.
const XLSX = require("xlsx");
const PDFDocument = require("pdfkit");
const db = require("../db");

function pct(part, whole) {
  if (!whole) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

// Excel/PDF raporlarının ikisinin de ihtiyaç duyduğu özet istatistikleri tek
// yerden hesaplar — iki rapor arasında sayılar asla tutarsız olmasın diye.
function computeSummary() {
  const totalBrands = db.prepare("SELECT COUNT(*) c FROM brands").get().c;
  const found = db.prepare("SELECT COUNT(*) c FROM brands WHERE status = 'found'").get().c;
  const sent = db.prepare("SELECT COUNT(*) c FROM brands WHERE status = 'sent' OR replied = 1").get().c;
  const replied = db.prepare("SELECT COUNT(*) c FROM brands WHERE replied = 1").get().c;
  const positive = db.prepare("SELECT COUNT(*) c FROM brands WHERE reply_sentiment = 'positive'").get().c;
  const bounced = db.prepare("SELECT COUNT(*) c FROM brands WHERE bounced = 1").get().c;
  const documentRequests = db.prepare("SELECT COUNT(*) c FROM brands WHERE document_requested = 1").get().c;

  const crmCounts = db
    .prepare("SELECT crm_stage, COUNT(*) c FROM brands GROUP BY crm_stage")
    .all();

  const topCategories = db
    .prepare(
      `SELECT COALESCE(NULLIF(TRIM(main_category), ''), 'Kategorisiz') as category,
              COUNT(*) as brandCount, SUM(COALESCE(est_monthly_revenue, 0)) as totalRevenue
       FROM brands GROUP BY category ORDER BY totalRevenue DESC LIMIT 10`
    )
    .all();

  return {
    generatedAt: new Date().toISOString(),
    totalBrands,
    found,
    sent,
    replied,
    positive,
    bounced,
    documentRequests,
    rates: {
      emailFoundRate: pct(found + sent, totalBrands),
      replyRate: pct(replied, sent),
      positiveRate: pct(positive, replied),
    },
    crmCounts,
    topCategories,
  };
}

// Excel raporu: birden fazla sekme içeren tek bir .xlsx dosyası (Buffer olarak
// döner, route içinde doğrudan indirilebilir hale getirilir).
function buildExcelReportBuffer() {
  const summary = computeSummary();
  const workbook = XLSX.utils.book_new();

  const summaryRows = [
    { Metrik: "Toplam Marka", Değer: summary.totalBrands },
    { Metrik: "E-mail Bulunan", Değer: summary.found },
    { Metrik: "Gönderilen", Değer: summary.sent },
    { Metrik: "Yanıt Gelen", Değer: summary.replied },
    { Metrik: "Olumlu Yanıt", Değer: summary.positive },
    { Metrik: "Geri Dönen (Bounce)", Değer: summary.bounced },
    { Metrik: "Belge İsteyen", Değer: summary.documentRequests },
    { Metrik: "E-mail Bulma Oranı (%)", Değer: summary.rates.emailFoundRate },
    { Metrik: "Yanıt Oranı (%)", Değer: summary.rates.replyRate },
    { Metrik: "Olumlu Yanıt Oranı (%)", Değer: summary.rates.positiveRate },
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), "Özet");

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(
      summary.crmCounts.map((r) => ({ "CRM Aşaması": r.crm_stage || "(bilinmiyor)", "Marka Sayısı": r.c }))
    ),
    "CRM Pipeline"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(
      summary.topCategories.map((c) => ({
        Kategori: c.category,
        "Marka Sayısı": c.brandCount,
        "Toplam Tahmini Ciro": c.totalRevenue,
      }))
    ),
    "Kategoriler"
  );

  const brands = db
    .prepare(
      `SELECT name, website, email, status, confidence, main_category, opportunity_score,
              crm_stage, ai_priority, replied, reply_sentiment, sent_at
       FROM brands ORDER BY COALESCE(opportunity_score, 0) DESC`
    )
    .all();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(brands), "Markalar");

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

// PDF raporu: tek sayfalık, yönetici özeti tarzında bir rapor. `res`'e (ya da
// herhangi bir yazılabilir stream'e) doğrudan pipe eder — route bunu çağırıp
// PDF bitince Content-Disposition ile indirtir.
function streamPdfReport(writableStream) {
  const summary = computeSummary();
  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(writableStream);

  doc.fontSize(20).text("Marka Outreach — Performans Raporu", { align: "left" });
  doc.fontSize(10).fillColor("#666").text(new Date(summary.generatedAt).toLocaleString("tr-TR"));
  doc.moveDown(1.5);

  doc.fillColor("#000").fontSize(14).text("Genel Durum");
  doc.moveDown(0.5);
  doc.fontSize(11);
  const lines = [
    `Toplam Marka: ${summary.totalBrands}`,
    `E-mail Bulunan: ${summary.found}`,
    `Gönderilen: ${summary.sent}`,
    `Yanıt Gelen: ${summary.replied}`,
    `Olumlu Yanıt: ${summary.positive}`,
    `Geri Dönen (Bounce): ${summary.bounced}`,
    `Belge İsteyen: ${summary.documentRequests}`,
  ];
  lines.forEach((line) => doc.text(line));
  doc.moveDown(1);

  doc.fontSize(14).text("Oranlar");
  doc.moveDown(0.5);
  doc.fontSize(11);
  doc.text(`E-mail Bulma Oranı: %${summary.rates.emailFoundRate}`);
  doc.text(`Yanıt Oranı: %${summary.rates.replyRate}`);
  doc.text(`Olumlu Yanıt Oranı: %${summary.rates.positiveRate}`);
  doc.moveDown(1);

  doc.fontSize(14).text("En Değerli 10 Kategori");
  doc.moveDown(0.5);
  doc.fontSize(11);
  if (summary.topCategories.length === 0) {
    doc.text("Kategori verisi yok.");
  } else {
    summary.topCategories.forEach((c) => {
      doc.text(`${c.category} — ${c.brandCount} marka, tahmini toplam ciro: $${Math.round(c.totalRevenue).toLocaleString("en-US")}`);
    });
  }
  doc.moveDown(1);

  doc.fontSize(14).text("CRM Pipeline Dağılımı");
  doc.moveDown(0.5);
  doc.fontSize(11);
  summary.crmCounts.forEach((r) => {
    doc.text(`${r.crm_stage || "(bilinmiyor)"}: ${r.c}`);
  });

  doc.end();
}

module.exports = { computeSummary, buildExcelReportBuffer, streamPdfReport };
