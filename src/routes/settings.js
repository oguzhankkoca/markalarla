const express = require("express");
const db = require("../db");
const mailer = require("../services/mailer");
const { sendBackupEmail } = require("../services/backup");
const { checkSenderDnsHealth } = require("../services/dnsCheck");
const { getPipelineStages, DEFAULT_PIPELINE_STAGES } = require("../services/crmPipeline");
const { safeParseArray } = require("../services/mailerHelpers");

const router = express.Router();

router.get("/api/settings", (req, res) => {
  const settings = db.prepare("SELECT * FROM settings WHERE id = 1").get();
  res.json({
    settings,
    emailConfigured: mailer.isConfigured(),
    emailAddress: process.env.EMAIL_USER || null,
  });
});

// Kısmi güncelleme: body'de gönderilmeyen alanlar veritabanındaki mevcut değerini korur.
// Böylece "Bilgilerin" formu kaydedilince mail şablonu, "Şablonu kaydet" ile de bilgiler
// silinmiyor — her buton sadece kendi ilgilendiği alanları gönderiyor.
router.post("/api/settings", (req, res) => {
  const current = db.prepare("SELECT * FROM settings WHERE id = 1").get();
  const merged = { ...current, ...req.body };

  // Kademeli ısınma KAPALIYDI ve şimdi AÇILIYORSA, ısınma başlangıç zamanını şimdi
  // olarak ayarla (haftalık artış buradan sayılır). KAPATILIYORSA, bir dahaki
  // açılışta ısınmanın sıfırdan başlaması için başlangıç zamanını temizle.
  let warmupStartedAt = current.warmup_started_at;
  const warmupEnabled = merged.warmup_enabled ? 1 : 0;
  if (warmupEnabled && !current.warmup_enabled) {
    warmupStartedAt = new Date().toISOString();
  } else if (!warmupEnabled) {
    warmupStartedAt = null;
  }

  db.prepare(
    `UPDATE settings SET name = ?, company = ?, offer_text = ?, signature = ?,
      main_subject = ?, main_body = ?, daily_send_limit = ?, company_address = ?,
      rewarm_enabled = ?, warmup_enabled = ?, warmup_start_limit = ?, warmup_increment = ?,
      warmup_started_at = ?
     WHERE id = 1`
  ).run(
    merged.name || "",
    merged.company || "",
    merged.offer_text || "",
    merged.signature || "",
    merged.main_subject || "",
    merged.main_body || "",
    Number(merged.daily_send_limit) || 0,
    merged.company_address || "",
    merged.rewarm_enabled ? 1 : 0,
    warmupEnabled,
    Number(merged.warmup_start_limit) || 10,
    Number(merged.warmup_increment) || 10,
    warmupStartedAt
  );
  res.json({ ok: true });
});

// Veritabanının bir kopyasını hemen mail eki olarak gönder (test etmek ya da
// hemen bir yedek almak için) — normalde her Pazartesi otomatik gider.
router.post("/api/settings/backup/send-now", async (req, res) => {
  try {
    const result = await sendBackupEmail();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Yedek gönderilemedi: " + err.message });
  }
});

// SPF/DKIM/DMARC kayıtlarının gerçekten kurulu olup olmadığını canlı DNS
// sorgusuyla kontrol eder — README'deki manuel kurulum talimatına güvenmek yerine
// kesin bir sonuç verir.
router.get("/api/settings/dns-health", async (req, res) => {
  try {
    const result = await checkSenderDnsHealth();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "DNS kontrolü sırasında hata: " + err.message });
  }
});

// CRM Pipeline: kullanıcının aşama listesini (New Lead → ... → Repeat Orders)
// görüntülemesi ve markaların şu an hangi aşamada olduğunun toplam sayısını
// (huninin her basamağındaki marka sayısı) görmesi için.
router.get("/api/crm/stages", (req, res) => {
  const settings = db.prepare("SELECT crm_pipeline_stages FROM settings WHERE id = 1").get();
  const stages = getPipelineStages(settings);
  const counts = db
    .prepare("SELECT crm_stage, COUNT(*) as c FROM brands GROUP BY crm_stage")
    .all()
    .reduce((acc, row) => {
      acc[row.crm_stage] = row.c;
      return acc;
    }, {});
  res.json({
    stages: stages.map((s) => ({ ...s, count: counts[s.key] || 0 })),
    isDefault: !settings.crm_pipeline_stages,
  });
});

// Kullanıcı pipeline'ı ayarlardan yeniden adlandırıp sıralayabilir/ekleyip
// çıkarabilir. "key" alanları stabil kalmalı (brands.crm_stage bunlara referans
// verir) — yeni bir aşama eklerken benzersiz bir key ver, var olanları silersen
// o aşamadaki markalar "bilinmeyen aşama" gibi görünmeye devam eder ama veri
// kaybolmaz (crm_stage değeri DB'de saklı kalır, sadece listede görünmez).
router.post("/api/crm/stages", (req, res) => {
  const { stages } = req.body || {};
  if (!Array.isArray(stages) || stages.length === 0 || !stages.every((s) => s && s.key && s.label)) {
    return res.status(400).json({ error: "Geçersiz aşama listesi — her aşamada 'key' ve 'label' olmalı." });
  }
  const keys = stages.map((s) => s.key);
  if (new Set(keys).size !== keys.length) {
    return res.status(400).json({ error: "Aşama key'leri birbirinden farklı olmalı." });
  }
  db.prepare("UPDATE settings SET crm_pipeline_stages = ? WHERE id = 1").run(JSON.stringify(stages));
  res.json({ ok: true, stages });
});

// Kullanıcı pipeline'ı bozarsa/karıştırırsa varsayılan 10 aşamaya geri dönebilsin.
router.post("/api/crm/stages/reset", (req, res) => {
  db.prepare("UPDATE settings SET crm_pipeline_stages = NULL WHERE id = 1").run();
  res.json({ ok: true, stages: DEFAULT_PIPELINE_STAGES });
});

// v58: Subject Rotation + A/B test — birden fazla konu satırı (ve isteğe bağlı
// gövde varyantı) tanımlanabilir. Toplu/otomatik gönderimlerde her seferinde
// rastgele biri seçilir; hangi varyant hangi markaya gittiği brands.sent_variant_*
// alanlarına kaydedilir (Analiz sayfasında yanıt oranı karşılaştırılabilir).
// Boş bırakılırsa (varsayılan) eski davranış aynen devam eder: tek sabit şablon.
router.get("/api/settings/ab-test", (req, res) => {
  const settings = db.prepare("SELECT subject_variants, body_variants FROM settings WHERE id = 1").get();
  res.json({
    subjectVariants: safeParseArray(settings.subject_variants),
    bodyVariants: safeParseArray(settings.body_variants),
  });
});

router.post("/api/settings/ab-test", (req, res) => {
  const { subjectVariants, bodyVariants } = req.body || {};
  db.prepare("UPDATE settings SET subject_variants = ?, body_variants = ? WHERE id = 1").run(
    JSON.stringify(Array.isArray(subjectVariants) ? subjectVariants.filter(Boolean) : []),
    JSON.stringify(Array.isArray(bodyVariants) ? bodyVariants.filter(Boolean) : [])
  );
  res.json({ ok: true });
});

// v59: Çoklu gönderici hesabı (round robin) altyapısı. Birincil hesap her zaman
// .env'deki EMAIL_USER/EMAIL_APP_PASSWORD'dür ve DEĞİŞMEZ; burada eklenenler
// SADECE EK hesaplardır. Hiç ek hesap eklenmezse sistem eskisi gibi tek hesaptan
// gönderir. Güvenlik için app password'ler GET ile asla geri döndürülmez —
// düzenlemek isteyen kullanıcı listeyi (şifrelerle birlikte) yeniden gönderir.
router.get("/api/settings/sender-accounts", (req, res) => {
  const settings = db.prepare("SELECT sender_accounts FROM settings WHERE id = 1").get();
  const accounts = safeParseArray(settings.sender_accounts);
  res.json({
    primary: process.env.EMAIL_USER || null,
    accounts: accounts.map((a) => ({ email: a.email, fromName: a.fromName || "" })),
  });
});

router.post("/api/settings/sender-accounts", (req, res) => {
  const { accounts } = req.body || {};
  if (!Array.isArray(accounts)) return res.status(400).json({ error: "accounts bir dizi olmalı." });
  const cleaned = accounts
    .filter((a) => a && a.email && a.appPassword)
    .map((a) => ({
      email: String(a.email).trim(),
      appPassword: String(a.appPassword).trim(),
      fromName: String(a.fromName || "").trim(),
    }));
  db.prepare("UPDATE settings SET sender_accounts = ? WHERE id = 1").run(JSON.stringify(cleaned));
  res.json({ ok: true, count: cleaned.length });
});

module.exports = router;
