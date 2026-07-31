const express = require("express");
const {
  listSuppressed,
  addToSuppressionList,
  removeFromSuppressionList,
} = require("../services/suppression");

const router = express.Router();

// Kalıcı "bir daha yazma" listesini getir (otomatik tespit edilenler + elle eklenenler)
router.get("/api/suppression", (req, res) => {
  res.json({ entries: listSuppressed() });
});

// Elle bir e-posta ekle (ör. telefonda/başka bir kanalda "bir daha yazma" denildiyse)
router.post("/api/suppression", (req, res) => {
  const { email, reason } = req.body;
  if (!email || !email.includes("@")) {
    return res.status(400).json({ error: "Geçerli bir e-posta adresi gir." });
  }
  addToSuppressionList(email, reason || "Elle eklendi");
  res.json({ ok: true, entries: listSuppressed() });
});

// Yanlışlıkla eklenmiş bir adresi listeden çıkar (o adrese tekrar gönderim açılır)
router.delete("/api/suppression/:email", (req, res) => {
  removeFromSuppressionList(req.params.email);
  res.json({ ok: true, entries: listSuppressed() });
});

module.exports = router;
