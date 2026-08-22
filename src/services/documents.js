// Evrak yönetim sistemi (v54): Resale Certificate, W-9, EIN Letter, katalog ve
// sözleşme gibi dosyaları marka bazında saklar. Dosyanın kendisi diske yazılır
// (veritabanına blob olarak GÖMÜLMEZ — SQLite dosyası şişip yedeklemeyi/indirmeyi
// yavaşlatmasın diye); DATA_DIR aynı persistent disk mantığını kullanır (bkz.
// src/db.js) — Render'da bir disk bağlıysa evraklar da veritabanı gibi kalıcıdır.
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const dataDir = process.env.DATA_DIR || path.join(__dirname, "..", "..", "data");
const documentsDir = path.join(dataDir, "documents");
if (!fs.existsSync(documentsDir)) fs.mkdirSync(documentsDir, { recursive: true });

function brandDir(brandId) {
  const dir = path.join(documentsDir, String(brandId));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Buffer'ı diske yazar, benzersiz bir dosya adı üretir (orijinal adı, iki farklı
// dosya aynı isimle yüklense bile üzerine yazmasın diye rastgele bir önekle birlikte).
function saveDocumentFile(brandId, originalName, buffer) {
  const ext = path.extname(originalName || "") || "";
  const storedFilename = `${crypto.randomUUID()}${ext}`;
  const fullPath = path.join(brandDir(brandId), storedFilename);
  fs.writeFileSync(fullPath, buffer);
  return storedFilename;
}

function documentFilePath(brandId, storedFilename) {
  return path.join(brandDir(brandId), storedFilename);
}

function deleteDocumentFile(brandId, storedFilename) {
  const p = documentFilePath(brandId, storedFilename);
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (e) {
    // dosya silinemese bile DB kaydı silinmeye devam etsin — kritik değil
  }
}

// v77: Bir marka tamamen silindiğinde (bkz. routes/brands.js DELETE /api/brands/:id),
// o markaya ait TÜM evrak klasörünü (ve içindeki dosyaları) diskten kaldırır.
// Marka zaten hiç evrak yüklemediyse klasör hiç oluşmamış olabilir — sorun değil.
function deleteBrandDir(brandId) {
  const dir = path.join(documentsDir, String(brandId));
  try {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    // dosyalar silinemese bile DB kaydı silinmeye devam etsin — kritik değil
  }
}

const DOCUMENT_TYPES = [
  "Resale Certificate",
  "W-9",
  "EIN Letter",
  "Katalog",
  "Sözleşme",
  "Diğer",
];

module.exports = { saveDocumentFile, documentFilePath, deleteDocumentFile, deleteBrandDir, DOCUMENT_TYPES };
