const express = require("express");
const multer = require("multer");
const db = require("../db");
const { saveDocumentFile, documentFilePath, deleteDocumentFile, DOCUMENT_TYPES } = require("../services/documents");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

router.get("/api/documents/types", (req, res) => {
  res.json({ types: DOCUMENT_TYPES });
});

router.get("/api/brands/:id/documents", (req, res) => {
  const docs = db
    .prepare("SELECT * FROM brand_documents WHERE brand_id = ? ORDER BY uploaded_at DESC")
    .all(req.params.id);
  res.json({ documents: docs });
});

router.post("/api/brands/:id/documents", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Dosya bulunamadı." });
  const brand = db.prepare("SELECT id FROM brands WHERE id = ?").get(req.params.id);
  if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });
  const docType = req.body.doc_type || "Diğer";
  const storedFilename = saveDocumentFile(brand.id, req.file.originalname, req.file.buffer);
  const result = db
    .prepare(
      "INSERT INTO brand_documents (brand_id, doc_type, original_name, stored_filename) VALUES (?, ?, ?, ?)"
    )
    .run(brand.id, docType, req.file.originalname, storedFilename);
  db.prepare("INSERT INTO brand_events (brand_id, event_type, message) VALUES (?, 'document_uploaded', ?)").run(
    brand.id,
    `${docType}: ${req.file.originalname}`
  );
  const doc = db.prepare("SELECT * FROM brand_documents WHERE id = ?").get(result.lastInsertRowid);
  res.json({ ok: true, document: doc });
});

router.get("/api/documents/:id/download", (req, res) => {
  const doc = db.prepare("SELECT * FROM brand_documents WHERE id = ?").get(req.params.id);
  if (!doc) return res.status(404).json({ error: "Evrak bulunamadı." });
  const filePath = documentFilePath(doc.brand_id, doc.stored_filename);
  res.download(filePath, doc.original_name || doc.stored_filename, (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ error: "Dosya diskte bulunamadı (silinmiş olabilir)." });
    }
  });
});

router.delete("/api/documents/:id", (req, res) => {
  const doc = db.prepare("SELECT * FROM brand_documents WHERE id = ?").get(req.params.id);
  if (!doc) return res.status(404).json({ error: "Evrak bulunamadı." });
  deleteDocumentFile(doc.brand_id, doc.stored_filename);
  db.prepare("DELETE FROM brand_documents WHERE id = ?").run(doc.id);
  res.json({ ok: true });
});

module.exports = router;
