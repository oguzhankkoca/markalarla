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

router.post("/api/brands/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Dosya bulunamadı." });
  try {
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    const { nameKey, websiteKey } = guessColumns(rows);
    if (!nameKey) return res.status(400).json({ error: "Marka adı sütunu bulunamadı." });

    const batch = crypto.randomUUID();
    const insert = db.prepare(
      "INSERT INTO brands (batch, name, website, status) VALUES (?, ?, ?, 'pending')"
    );
    const insertMany = db.transaction((items) => {
      for (const item of items) {
        const name = String(item[nameKey] || "").trim();
        if (!name) continue;
        const website = websiteKey ? String(item[websiteKey] || "").trim() : "";
        insert.run(batch, name, website);
      }
    });
    insertMany(rows);

    const brands = db.prepare("SELECT * FROM brands WHERE batch = ? ORDER BY id").all(batch);
    res.json({ ok: true, batch, count: brands.length, brands });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Dosya işlenirken hata oluştu: " + err.message });
  }
});

router.get("/api/brands", (req, res) => {
  const lastBatchRow = db
    .prepare("SELECT batch FROM brands ORDER BY id DESC LIMIT 1")
    .get();
  if (!lastBatchRow) return res.json({ brands: [], batch: null });
  const brands = db
    .prepare("SELECT * FROM brands WHERE batch = ? ORDER BY id")
    .all(lastBatchRow.batch);
  res.json({ brands, batch: lastBatchRow.batch });
});

router.post("/api/brands/:id/find-email", async (req, res) => {
  const brand = db.prepare("SELECT * FROM brands WHERE id = ?").get(req.params.id);
  if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });

  try {
    const result = await findBrandEmail(brand.name, brand.website);
    db.prepare(
      `UPDATE brands SET email = ?, website = COALESCE(?, website), email_source = ?, confidence = ?, status = ?
       WHERE id = ?`
    ).run(
      result.email,
      result.website,
      result.source,
      result.confidence,
      result.email ? "found" : "not_found",
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

router.post("/api/brands/find-all", async (req, res) => {
  const { batch } = req.body;
  const brands = db
    .prepare("SELECT * FROM brands WHERE batch = ? AND status != 'sent'")
    .all(batch);

  res.json({ ok: true, queued: brands.length });

  (async () => {
    for (const brand of brands) {
      try {
        const result = await findBrandEmail(brand.name, brand.website);
        db.prepare(
          `UPDATE brands SET email = ?, website = COALESCE(?, website), email_source = ?, confidence = ?, status = ?
           WHERE id = ?`
        ).run(
          result.email,
          result.website,
          result.source,
          result.confidence,
          result.email ? "found" : "not_found",
          brand.id
        );
      } catch (err) {
        db.prepare("UPDATE brands SET status = 'error', last_error = ? WHERE id = ?").run(
          err.message,
          brand.id
        );
      }
    }
  })();
});

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

module.exports = router;
