const db = require("../db");

// Kalıcı "bir daha yazma" listesi: bir e-posta adresi buraya bir kez girdiğinde,
// o markanın kaydı silinse, Excel'den yeniden yüklense ya da tekilleştirilse bile
// sistem BİR DAHA ASLA o adrese mail göndermez. Hem otomatik tespit (alıcı
// "unsubscribe" dediğinde, bkz. inboxChecker.js) hem elle ekleme/çıkarma
// destekleniyor.

function normalizeEmail(email) {
  return (email || "").trim().toLowerCase();
}

function isSuppressed(email) {
  const norm = normalizeEmail(email);
  if (!norm) return false;
  const row = db.prepare("SELECT 1 FROM suppression_list WHERE email = ?").get(norm);
  return Boolean(row);
}

// brands.suppressed sütunu, tabloyu her seferinde suppression_list ile JOIN
// etmeden hızlıca filtreleyebilmek (ör. otomatik gönderim sorgusunda) için
// denormalize bir bayrak — buradaki fonksiyonlar her zaman ikisini birlikte günceller.
function syncBrandsSuppressedFlag(email, value) {
  const norm = normalizeEmail(email);
  if (!norm) return;
  db.prepare("UPDATE brands SET suppressed = ? WHERE LOWER(TRIM(email)) = ?").run(
    value ? 1 : 0,
    norm
  );
}

function addToSuppressionList(email, reason, brandName) {
  const norm = normalizeEmail(email);
  if (!norm) return false;
  db.prepare(
    "INSERT OR IGNORE INTO suppression_list (email, reason, brand_name) VALUES (?, ?, ?)"
  ).run(norm, reason || "Elle eklendi", brandName || null);
  syncBrandsSuppressedFlag(norm, true);
  return true;
}

function removeFromSuppressionList(email) {
  const norm = normalizeEmail(email);
  if (!norm) return false;
  db.prepare("DELETE FROM suppression_list WHERE email = ?").run(norm);
  syncBrandsSuppressedFlag(norm, false);
  return true;
}

function listSuppressed() {
  return db.prepare("SELECT * FROM suppression_list ORDER BY created_at DESC").all();
}

module.exports = {
  isSuppressed,
  addToSuppressionList,
  removeFromSuppressionList,
  listSuppressed,
  syncBrandsSuppressedFlag,
};
