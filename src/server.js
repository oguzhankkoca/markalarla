require("dotenv").config();
const path = require("path");
const express = require("express");
const cron = require("node-cron");

const settingsRoutes = require("./routes/settings");
const brandRoutes = require("./routes/brands");
const trackingRoutes = require("./routes/tracking");
const analyticsRoutes = require("./routes/analytics");
const creditsRoutes = require("./routes/credits");
const mailer = require("./services/mailer");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(settingsRoutes);
app.use(brandRoutes);
app.use(trackingRoutes);
app.use(analyticsRoutes);
app.use(creditsRoutes);
app.use(express.static(path.join(__dirname, "..", "public")));

app.listen(PORT, () => {
  console.log("");
  console.log("=================================================");
  console.log(`  Uygulama çalışıyor -> http://localhost:${PORT}`);
  console.log("  Tarayıcında bu adresi aç.");
  console.log("  Kapatmak için bu pencereyi kapatabilir ya da");
  console.log("  Ctrl+C tuşlayabilirsin.");
  console.log("=================================================");
  console.log("");

  // Her gün UTC 08:00'de (Türkiye saatiyle yaklaşık 11:00) otomatik olarak
  // gelen kutusunu kontrol et, bounce/yanıt tespiti yap ve zamanı gelen
  // follow-up maillerini gönder. Sunucu sürekli açık kaldığı sürece çalışır
  // (ücretsiz/uyuyan planlarda güvenilir değildir).
  if (mailer.isConfigured() && process.env.EMAIL_APP_PASSWORD) {
    cron.schedule("0 8 * * *", async () => {
      console.log("[cron] Günlük yanıt/bounce/follow-up kontrolü başladı...");
      try {
        const { runFullCheck } = require("./routes/tracking");
        const summary = await runFullCheck();
        console.log("[cron] Tamamlandı:", JSON.stringify(summary));
      } catch (e) {
        console.error("[cron] Hata:", e.message);
      }
    });
    console.log("Günlük otomatik kontrol zamanlayıcısı kuruldu (her gün UTC 08:00).");

    // Günlük gönderim limiti (Ayarlar'daki "daily_send_limit") ayarlanmışsa, mailleri
    // tek seferde patlatmak yerine güne yaymak için 08:00-20:00 UTC arası her 10
    // dakikada bir en fazla 1 mail gönderir. Limit 0/boşsa hiçbir şey yapmaz.
    cron.schedule("*/10 8-20 * * *", async () => {
      try {
        const { runAutoSend } = require("./routes/brands");
        const result = await runAutoSend();
        if (result.sent > 0) {
          console.log("[auto-send] Gönderildi:", result.brand);
        }
      } catch (e) {
        console.error("[auto-send] Hata:", e.message);
      }
    });
    console.log("Günlük limitli otomatik gönderim zamanlayıcısı kuruldu (08:00-20:00 UTC, her 10 dakikada bir kontrol).");
  }
});
