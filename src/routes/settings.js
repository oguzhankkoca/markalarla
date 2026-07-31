const express = require("express");
const db = require("../db");
const mailer = require("../services/mailer");
const { sendBackupEmail } = require("../services/backup");
const { checkSenderDnsHealth } = require("../services/dnsCheck");

const router = express.Router();

router.get("/api/settings", (req, res) => {
  const settings = db.prepare("SELECT * FROM settings WHERE id = 1").get();
  res.json({
    settings,
    emailConfigured: mailer.isConfigured(),
    emailAddress: process.env.EMAIL_USER || null,
  });
});

// Kısmi güncelleme: body'de gönderilmeyen alanlar veritabanındaki mevcut değerini korur.
// Böylece "Bilgilerin" formu kaydedilince mail şablonu, "Şablonu kaydet" ile de bilgiler
// silinmiyor — her buton sadece kendi ilgilendiği alanları gönderiyor.
router.post("/api/settings", (req, res) => {
  const current = db.prepare("SELECT * FROM settings WHERE id = 1").get();
  const merged = { ...current, ...req.body };

  // Kademeli ısınma KAPALIYDI ve şimdi AÇILIYORSA, ısınma başlangıç zamanını şimdi
  // olarak ayarla (haftalık artış buradan sayılır). KAPATILIYORSA, bir dahaki
  // açılışta ısınmanın sıfırdan başlaması için başlangıç zamanını temizle.
  let warmupStartedAt = current.warmup_started_at;
  const warmupEnabled = merged.warmup_enabled ? 1 : 0;
  if (warmupEnabled && !current.warmup_enabled) {
    warmupStartedAt = new Date().toISOString();
  } else if (!warmupEnabled) {
    warmupStartedAt = null;
  }

  db.prepare(
    `UPDATE settings SET name = ?, company = ?, offer_text = ?, signature = ?,
      main_subject = ?, main_body = ?, daily_send_limit = ?, company_address = ?,
      rewarm_enabled = ?, warmup_enabled = ?, warmup_start_limit = ?, warmup_increment = ?,
      warmup_started_at = ?
     WHERE id = 1`
  ).run(
    merged.name || "",
    merged.company || "",
    merged.offer_text || "",
    merged.signature || "",
    merged.main_subject || "",
    merged.main_body || "",
    Number(merged.daily_send_limit) || 0,
    merged.company_address || "",
    merged.rewarm_enabled ? 1 : 0,
    warmupEnabled,
    Number(merged.warmup_start_limit) || 10,
    Number(merged.warmup_increment) || 10,
    warmupStartedAt
  );
  res.json({ ok: true });
});

// Veritabanının bir kopyasını hemen mail eki olarak gönder (test etmek ya da
// hemen bir yedek almak için) — normalde her Pazartesi otomatik gider.
router.post("/api/settings/backup/send-now", async (req, res) => {
  try {
    const result = await sendBackupEmail();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Yedek gönderilemedi: " + err.message });
  }
});

// SPF/DKIM/DMARC kayıtlarının gerçekten kurulu olup olmadığını canlı DNS
// sorgusuyla kontrol eder — README'deki manuel kurulum talimatına güvenmek yerine
// kesin bir sonuç verir.
router.get("/api/settings/dns-health", async (req, res) => {
  try {
    const result = await checkSenderDnsHealth();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "DNS kontrolü sırasında hata: " + err.message });
  }
});

module.exports = router;
