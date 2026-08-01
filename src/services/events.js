// Marka bazlı Timeline (v53): önemli olayları (email bulundu, gönderildi, yanıt
// geldi, bounce, aşama değişti, evrak yüklendi, AI analiz edildi vs.) brand_events
// tablosuna kaydeder. Bu tamamen bilgilendirme amaçlıdır — bir kayıt başarısız
// olsa bile (örn. tablo henüz yoksa) ana akış ASLA etkilenmemeli, bu yüzden
// her çağrı try/catch içinde sessizce yutulur.
const db = require("../db");

function logEvent(brandId, eventType, message) {
  if (!brandId || !eventType) return;
  try {
    db.prepare("INSERT INTO brand_events (brand_id, event_type, message) VALUES (?, ?, ?)").run(
      brandId,
      eventType,
      message || null
    );
  } catch (e) {
    // sessizce geç
  }
}

module.exports = { logEvent };
