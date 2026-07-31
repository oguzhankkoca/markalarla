const fs = require("fs");
const db = require("../db");
const mailer = require("./mailer");

// Render gibi bulut hosting'lerde "Persistent Disk" eklenmemişse (ya da eklendiği
// halde disk arızası/yanlış silme gibi beklenmedik bir şey olursa) tüm veri
// (marka listesi, bulunan e-mailler, gönderim geçmişi) kaybolabilir. Haftalık
// olarak veritabanının kendisini (data/app.sqlite) sana mail eki olarak göndererek
// basit ama etkili bir yedekleme sağlıyoruz — bir sorun çıkarsa bu dosyayı
// data/ klasörüne geri koyup kaldığın yerden devam edebilirsin.
async function sendBackupEmail() {
  const settings = db.prepare("SELECT * FROM settings WHERE id = 1").get();
  if (settings.last_backup_at) {
    const ageMs = Date.now() - new Date(settings.last_backup_at).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays < 6) {
      return { sent: false, reason: "already_sent_this_week" };
    }
  }

  try {
    // WAL modunda çalıştığımız için önce bekleyen değişikliklerin ana dosyaya
    // yazıldığından emin oluyoruz (checkpoint), yoksa yedek eski/eksik veri içerebilir.
    db.pragma("wal_checkpoint(TRUNCATE)");

    const fileBuffer = fs.readFileSync(db.dbFilePath);
    const dateStr = new Date().toISOString().slice(0, 10);

    await mailer.sendMail({
      to: process.env.EMAIL_USER,
      subject: `💾 Haftalık yedek - ${dateStr}`,
      body:
        `Bu, marka outreach uygulamanın veritabanının (data/app.sqlite) haftalık otomatik yedeğidir.\n\n` +
        `Bir sorun çıkarsa (ör. sunucu verisi kaybolursa) bu dosyayı indirip sunucudaki data/ klasörüne\n` +
        `"app.sqlite" adıyla koyarak kaldığın yerden devam edebilirsin.\n\n` +
        `Bu maili yanlışlıkla silme — bir sonraki yedek ancak bir hafta sonra gidecek.`,
      attachments: [
        {
          filename: `app-backup-${dateStr}.sqlite`,
          content: fileBuffer,
        },
      ],
    });

    db.prepare("UPDATE settings SET last_backup_at = CURRENT_TIMESTAMP WHERE id = 1").run();
    return { sent: true, sizeBytes: fileBuffer.length };
  } catch (e) {
    return { sent: false, reason: "error", error: e.message };
  }
}

module.exports = { sendBackupEmail };
