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

router.post("/api/settings", (req, res) => {
  const { name, company, offer_text, signature } = req.body;
  db.prepare(
    "UPDATE settings SET name = ?, company = ?, offer_text = ?, signature = ? WHERE id = 1"
  ).run(name || "", company || "", offer_text || "", signature || "");
  res.json({ ok: true });
});

module.exports = router;
