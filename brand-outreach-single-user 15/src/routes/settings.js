const express = require("express");
const db = require("../db");
const mailer = require("../services/mailer");

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
  db.prepare(
    `UPDATE settings SET name = ?, company = ?, offer_text = ?, signature = ?,
      main_subject = ?, main_body = ?, daily_send_limit = ?
     WHERE id = 1`
  ).run(
    merged.name || "",
    merged.company || "",
    merged.offer_text || "",
    merged.signature || "",
    merged.main_subject || "",
    merged.main_body || "",
    Number(merged.daily_send_limit) || 0
  );
  res.json({ ok: true });
});

module.exports = router;
