const express = require("express");
const XLSX = require("xlsx");
const db = require("../db");
const mailer = require("../services/mailer");
const { checkRepliesForMany, checkBounces } = require("../services/inboxChecker");

const router = express.Router();

// 3 aşamalı takip: gönderimden şu kadar gün sonra sırayla gönderilir
const FOLLOW_UP_SCHEDULE = [
  { stage: 1, afterDays: 7 },
  { stage: 2, afterDays: 14 },
  { stage: 3, afterDays: 30 },
];

const DEAL_STAGES = ["new", "meeting_scheduled", "sample_sent", "deal_closed", "rejected"];

function daysAgo(dateStr) {
  if (!dateStr) return null;
  const then = new Date(dateStr).getTime();
  const now = Date.now();
  return Math.floor((now - then) / (1000 * 60 * 60 * 24));
}

function fillTemplate(text, brandName) {
  return (text || "").replace(/{{\s*marka\s*}}/gi, brandName);
}

function getFollowUpTemplate(settings, stage) {
  if (stage === 1) {
    return {
      subject: settings.followup_subject || `Re: {{marka}} ile iş birliği teklifi`,
      body:
        settings.followup_body ||
        `Merhaba {{marka}} ekibi,\n\nGeçen hafta ilettiğim iş birliği teklifiyle ilgili görüşünüzü almak isterim. Uygun bir zamanda kısa bir görüşme ayarlayabilir miyiz?\n\n${settings.signature || ""}`,
    };
  }
  if (stage === 2) {
    return {
      subject: settings.followup2_subject || `{{marka}} - kısa bir hatırlatma`,
      body:
        settings.followup2_body ||
        `Merhaba {{marka}} ekibi,\n\nDaha önce gönderdiğim teklifle ilgili bir güncelleme var mı diye kısaca sormak istedim. Uygun olduğunuzda görüşmekten memnuniyet duyarız.\n\n${settings.signature || ""}`,
    };
  }
  return {
    subject: settings.followup3_subject || `{{marka}} - son bir kez yazıyorum`,
    body:
      settings.followup3_body ||
      `Merhaba {{marka}} ekibi,\n\nBu konuda son kez yazıyorum; şu an için uygun değilse anlayışla karşılarım. İlerleyen bir dönemde tekrar değerlendirmek isterseniz kapımız her zaman açık.\n\n${settings.signature || ""}`,
  };
}

// Gelen kutusu kontrolü + bounce taraması + follow-up gönderimi. Hem manuel butondan
// hem de günlük otomatik (cron) çalıştırmadan bu fonksiyon kullanılır.
async function runFullCheck() {
  const summary = {
    checked: 0,
    repliesFound: 0,
    followUpsSent: 0,
    notificationsSent: 0,
    bouncesFound: 0,
    documentsRequested: 0,
    errors: [],
  };

  const candidates = db
    .prepare(
      `SELECT * FROM brands WHERE status = 'sent' AND (replied IS NULL OR replied = 0)
       AND (bounced IS NULL OR bounced = 0) AND email IS NOT NULL`
    )
    .all();

  if (candidates.length === 0) return summary;

  const brandList = candidates.map((b) => ({
    id: b.id,
    email: b.email,
    sentAtDate: b.sent_at ? new Date(b.sent_at) : null,
  }));

  // 1) Önce bounce (geri dönen mail) taraması yap, bounce olanları döngü dışına al
  let bouncedIds = new Set();
  try {
    bouncedIds = await checkBounces(brandList);
    for (const id of bouncedIds) {
      db.prepare(
        "UPDATE brands SET bounced = 1, status = 'bounced', last_error = 'Mail geri döndü (geçersiz adres olabilir). E-maili düzeltip tekrar deneyebilirsin.' WHERE id = ?"
      ).run(id);
      summary.bouncesFound++;
    }
  } catch (e) {
    summary.errors.push(`Bounce taraması başarısız: ${e.message}`);
  }

  const remainingCandidates = candidates.filter((b) => !bouncedIds.has(b.id));
  const remainingBrandList = brandList.filter((b) => !bouncedIds.has(b.id));

  if (remainingCandidates.length === 0) {
    summary.checked = candidates.length;
    return summary;
  }

  try {
    const results = await checkRepliesForMany(remainingBrandList);
    const settings = db.prepare("SELECT * FROM settings WHERE id = 1").get();

    for (const brand of remainingCandidates) {
      const result = results.get(brand.id);
      db.prepare("UPDATE brands SET last_checked_at = CURRENT_TIMESTAMP WHERE id = ?").run(brand.id);

      if (result && result.found && result.isBounceLike) {
        // "Yanıt" gibi görünse de (marka adresinden geldiği için eşleşti) aslında
        // otomatik bir teslim edilememe bildirimi — gerçek bir insan yanıtı sayma,
        // bounce olarak işaretle ki "Ulaşmayanlar" listesinde görünsün.
        db.prepare(
          `UPDATE brands SET bounced = 1, status = 'bounced',
           last_error = ? WHERE id = ?`
        ).run(
          result.aiReason
            ? `Mail geri döndü (AI tespiti): ${result.aiReason}`
            : "Mail geri döndü (geçersiz adres olabilir). E-maili düzeltip tekrar deneyebilirsin.",
          brand.id
        );
        summary.bouncesFound++;
        continue;
      }

      if (result && result.found) {
        db.prepare(
          `UPDATE brands SET replied = 1, reply_sentiment = ?, reply_snippet = ?, reply_from = ?,
           document_requested = ?, document_request_snippet = ?
           WHERE id = ?`
        ).run(
          result.sentiment,
          result.snippet,
          result.from,
          result.documentRequested ? 1 : 0,
          result.documentRequested ? result.snippet : null,
          brand.id
        );
        summary.repliesFound++;
        if (result.documentRequested) summary.documentsRequested++;

        if (result.sentiment === "positive" && !brand.notified) {
          try {
            await mailer.sendMail({
              to: process.env.EMAIL_USER,
              subject: `Olumlu yanıt geldi: ${brand.name}`,
              body: `${brand.name} markasından olumlu bir yanıt geldi.\n\nGönderen: ${result.from}\n\nMesaj:\n${result.snippet}\n\nPaneldeki "Gönderim Takibi" sayfasından detaylara bakabilirsin.`,
            });
            db.prepare("UPDATE brands SET notified = 1 WHERE id = ?").run(brand.id);
            summary.notificationsSent++;
          } catch (e) {
            summary.errors.push(`Bildirim gönderilemedi (${brand.name}): ${e.message}`);
          }
        }
        continue;
      }

      const age = daysAgo(brand.sent_at);
      const currentStage = brand.follow_up_stage || 0;
      const nextStep = FOLLOW_UP_SCHEDULE.find(
        (step) => step.stage === currentStage + 1 && age !== null && age >= step.afterDays
      );

      if (nextStep) {
        const template = getFollowUpTemplate(settings, nextStep.stage);
        try {
          await mailer.sendMail({
            to: brand.email,
            subject: fillTemplate(template.subject, brand.name),
            body: fillTemplate(template.body, brand.name),
          });
          db.prepare(
            `UPDATE brands SET follow_up_stage = ?, last_follow_up_at = CURRENT_TIMESTAMP,
             follow_up_sent_at = CURRENT_TIMESTAMP WHERE id = ?`
          ).run(nextStep.stage, brand.id);
          db.prepare(
            "INSERT INTO send_log (brand_id, status, message) VALUES (?, 'sent', ?)"
          ).run(brand.id, `${nextStep.stage}. aşama follow-up gönderildi: ${brand.email}`);
          summary.followUpsSent++;
        } catch (e) {
          summary.errors.push(`${brand.name}: ${e.message}`);
        }
      }
    }

    summary.checked = candidates.length;
    return summary;
  } catch (err) {
    summary.errors.push(err.message);
    return summary;
  }
}

// Gönderilmiş tüm markaları, gün sayısı ve yanıt/pipeline durumu ile birlikte listele
router.get("/api/tracking", (req, res) => {
  const brands = db
    .prepare(
      `SELECT * FROM brands WHERE status IN ('sent', 'bounced') OR replied = 1 ORDER BY sent_at DESC`
    )
    .all();

  const enriched = brands.map((b) => ({
    ...b,
    days_since_sent: daysAgo(b.sent_at),
  }));

  res.json({ brands: enriched, dealStages: DEAL_STAGES });
});

// Takip mail şablonlarını getir/kaydet (3 aşama)
router.get("/api/tracking/followup-template", (req, res) => {
  const settings = db
    .prepare(
      `SELECT followup_subject, followup_body, followup2_subject, followup2_body,
              followup3_subject, followup3_body
       FROM settings WHERE id = 1`
    )
    .get();
  res.json({ settings });
});

router.post("/api/tracking/followup-template", (req, res) => {
  const { stage1, stage2, stage3 } = req.body;
  db.prepare(
    `UPDATE settings SET
      followup_subject = ?, followup_body = ?,
      followup2_subject = ?, followup2_body = ?,
      followup3_subject = ?, followup3_body = ?
     WHERE id = 1`
  ).run(
    stage1?.subject || "",
    stage1?.body || "",
    stage2?.subject || "",
    stage2?.body || "",
    stage3?.subject || "",
    stage3?.body || ""
  );
  res.json({ ok: true });
});

// Gelen kutusunu kontrol et (manuel buton)
router.post("/api/tracking/check-replies", async (req, res) => {
  try {
    const summary = await runFullCheck();
    res.json({ ok: true, ...summary });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gelen kutusu kontrol edilirken hata oluştu: " + err.message });
  }
});

// Bir markanın yanıt durumunu ve/veya pipeline aşamasını elle düzelt
router.put("/api/tracking/:id", (req, res) => {
  const { reply_sentiment, deal_stage, document_requested } = req.body;
  const brand = db.prepare("SELECT * FROM brands WHERE id = ?").get(req.params.id);
  if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });

  if (reply_sentiment !== undefined) {
    db.prepare("UPDATE brands SET reply_sentiment = ? WHERE id = ?").run(reply_sentiment, brand.id);
  }
  if (deal_stage !== undefined) {
    if (!DEAL_STAGES.includes(deal_stage)) {
      return res.status(400).json({ error: "Geçersiz aşama." });
    }
    db.prepare("UPDATE brands SET deal_stage = ? WHERE id = ?").run(deal_stage, brand.id);
  }
  if (document_requested !== undefined) {
    db.prepare("UPDATE brands SET document_requested = ? WHERE id = ?").run(
      document_requested ? 1 : 0,
      brand.id
    );
  }
  res.json({ ok: true });
});

// Bir markaya ait tüm gönderim/takip geçmişini (ilk gönderim, her follow-up aşaması,
// hatalar) kronolojik sırayla döner — "kaçıncı takibi ne zaman attık" sorusuna cevap.
router.get("/api/tracking/:id/history", (req, res) => {
  const brand = db.prepare("SELECT * FROM brands WHERE id = ?").get(req.params.id);
  if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });
  const logs = db
    .prepare("SELECT * FROM send_log WHERE brand_id = ? ORDER BY created_at ASC")
    .all(brand.id);
  res.json({ brand: { id: brand.id, name: brand.name }, logs });
});

// Tüm marka + durum verisini Excel olarak indir
router.get("/api/tracking/export", (req, res) => {
  const brands = db.prepare("SELECT * FROM brands ORDER BY id").all();

  const rows = brands.map((b) => ({
    Marka: b.name,
    Website: b.website || "",
    Email: b.email || "",
    Durum: b.status,
    "Gönderim Tarihi": b.sent_at || "",
    "Gönderim Yöntemi": b.sent_via === "contact_form" ? "İletişim Formu" : b.sent_at ? "E-mail" : "",
    "Yanıt Geldi mi": b.replied ? "Evet" : "Hayır",
    "Yanıt Tonu": b.reply_sentiment || "",
    "Yanıt Özeti": b.reply_snippet || "",
    "Takip Aşaması": b.follow_up_stage || 0,
    "Anlaşma Aşaması": b.deal_stage || "new",
    "Geri Döndü mü": b.bounced ? "Evet" : "Hayır",
    "Belge İstendi mi": b.document_requested ? "Evet" : "Hayır",
    "Marka Skoru": b.brand_score ?? "",
    "Tahmini Aylık Ciro": b.est_monthly_revenue ?? "",
    "Ort. Satıcı Sayısı": b.avg_sellers ?? "",
    "Amazon Stok Oranı": b.amazon_in_stock_rate ?? "",
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Markalar");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", "attachment; filename=marka-takip.xlsx");
  res.send(buffer);
});

module.exports = router;
module.exports.runFullCheck = runFullCheck;
