require("dotenv").config();
const path = require("path");
const express = require("express");
const cron = require("node-cron");

const settingsRoutes = require("./routes/settings");
const brandRoutes = require("./routes/brands");
const trackingRoutes = require("./routes/tracking");
const analyticsRoutes = require("./routes/analytics");
const mailer = require("./services/mailer");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(settingsRoutes);
app.use(brandRoutes);
app.use(trackingRoutes);
app.use(analyticsRoutes);
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
  }
});
