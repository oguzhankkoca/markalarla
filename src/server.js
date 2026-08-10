require("dotenv").config();
const path = require("path");
const express = require("express");
const cron = require("node-cron");

const settingsRoutes = require("./routes/settings");
const brandRoutes = require("./routes/brands");
const trackingRoutes = require("./routes/tracking");
const analyticsRoutes = require("./routes/analytics");
const creditsRoutes = require("./routes/credits");
const suppressionRoutes = require("./routes/suppression");
const tasksRoutes = require("./routes/tasks");
const documentsRoutes = require("./routes/documents");
const aiFeaturesRoutes = require("./routes/aiFeatures");
const dashboardRoutes = require("./routes/dashboard");
const brandIntelligenceRoutes = require("./routes/brandIntelligence");
const mailer = require("./services/mailer");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(settingsRoutes);
app.use(brandRoutes);
app.use(trackingRoutes);
app.use(analyticsRoutes);
app.use(creditsRoutes);
app.use(suppressionRoutes);
app.use(tasksRoutes);
app.use(documentsRoutes);
app.use(aiFeaturesRoutes);
app.use(dashboardRoutes);
app.use(brandIntelligenceRoutes);
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
        const { runFullCheck, reWarmColdBrands } = require("./routes/tracking");
        const summary = await runFullCheck();
        console.log("[cron] Tamamlandı:", JSON.stringify(summary));
        // Soğuk marka yeniden ısıtma varsayılan KAPALI (settings.rewarm_enabled) —
        // fonksiyon zaten kapalıysa hiçbir şey yapmadan döner, burada her zaman çağırmak güvenli.
        const rewarmResult = reWarmColdBrands();
        if (rewarmResult.rewarmed > 0) {
          console.log("[cron] Yeniden ısıtılan markalar:", JSON.stringify(rewarmResult));
        }
      } catch (e) {
        console.error("[cron] Hata:", e.message);
      }
    });
    console.log("Günlük otomatik kontrol zamanlayıcısı kuruldu (her gün UTC 08:00).");

    // Her Pazartesi günlük kontrolden kısa bir süre sonra (08:05 UTC), son 7 günün
    // özetini (kaç mail gitti, kaç yanıt/bounce/olumlu geldi) tek bir mailde gönderir.
    cron.schedule("5 8 * * 1", async () => {
      console.log("[cron] Haftalık özet maili gönderiliyor...");
      try {
        const { sendWeeklySummary } = require("./routes/tracking");
        const result = await sendWeeklySummary();
        console.log("[cron] Haftalık özet:", JSON.stringify(result));
      } catch (e) {
        console.error("[cron] Haftalık özet hatası:", e.message);
      }
    });
    console.log("Haftalık özet maili zamanlayıcısı kuruldu (her Pazartesi UTC 08:05).");

    // Haftalık özet mailinden hemen sonra (08:10 UTC), veritabanının kendisini
    // (data/app.sqlite) mail eki olarak gönderir — Render disk sorununa karşı
    // basit bir yedekleme sigortası.
    cron.schedule("10 8 * * 1", async () => {
      console.log("[cron] Haftalık veritabanı yedeği gönderiliyor...");
      try {
        const { sendBackupEmail } = require("./services/backup");
        const result = await sendBackupEmail();
        console.log("[cron] Yedek sonucu:", JSON.stringify(result));
      } catch (e) {
        console.error("[cron] Yedek hatası:", e.message);
      }
    });
    console.log("Haftalık veritabanı yedeği zamanlayıcısı kuruldu (her Pazartesi UTC 08:10).");

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
