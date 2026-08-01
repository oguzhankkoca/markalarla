const express = require("express");
const XLSX = require("xlsx");
const db = require("../db");
const mailer = require("../services/mailer");
const { checkRepliesForMany, checkBounces, testImapConnection } = require("../services/inboxChecker");
const { isSuppressed, addToSuppressionList } = require("../services/suppression");
const { getPipelineStages, advanceStage } = require("../services/crmPipeline");
const { logEvent } = require("../services/events");

const router = express.Router();

// brands.js'deki aynı isimli yardımcının bir kopyası — CRM pipeline'ı SADECE
// İLERİ taşır, asla geri almaz. İki dosyada da kullanıldığı için burada da
// tutuluyor (döngüsel require'dan kaçınmak için ortak bir modüle çıkarılmadı,
// mantığı zaten çok küçük).
function advanceCrmStage(brandId, currentStage, targetKey) {
  const settings = db.prepare("SELECT crm_pipeline_stages FROM settings WHERE id = 1").get();
  const stages = getPipelineStages(settings);
  const next = advanceStage(currentStage, targetKey, stages);
  if (next !== currentStage) {
    db.prepare("UPDATE brands SET crm_stage = ? WHERE id = ?").run(next, brandId);
    const label = (stages.find((s) => s.key === next) || {}).label || next;
    logEvent(brandId, "stage_changed", `Aşama: ${label}`);
  }
  return next;
}

// 3 aşamalı takip: gönderimden şu kadar gün sonra sırayla gönderilir
const FOLLOW_UP_SCHEDULE = [
  { stage: 1, afterDays: 7 },
  { stage: 2, afterDays: 14 },
  { stage: 3, afterDays: 30 },
];

const DEAL_STAGES = ["new", "meeting_scheduled", "sample_sent", "deal_closed", "rejected"];

// Bounce oranı güvenlik freni: son 24 saatte gönderilen maillerin çok yüksek bir
// oranı geri dönüyorsa (ör. yanlış/zehirli bir liste, ya da gönderici itibarının
// zaten zedelenmiş olması), sistemin körü körüne göndermeye devam etmesi hem
// paranı boşa harcar hem de itibarını daha da kötüleştirir. Bu yüzden eşik
// aşıldığında otomatik gönderim (cron ile çalışan runAutoSend) kendini durdurur;
// kullanıcı sorunu inceleyip elle "devam et" demeden tekrar başlamaz.
const CIRCUIT_BREAKER_MIN_SAMPLE = 5; // bu sayının altında örneklemde tetiklenmez (tek tük bounce normal)
const CIRCUIT_BREAKER_THRESHOLD = 0.3; // %30 ve üzeri bounce oranı

// brands.js'teki aynı isimli sabitle birebir aynı — bir marka yeniden "gönderilebilir"
// duruma alındığında (burada: soğuk marka yeniden ısıtma), önceki döngüden kalma takip
// alanlarının (bounce, yanıt, follow-up aşaması vb.) sıfırlanması için.
const RESET_TRACKING_ON_SEND_SQL = `
  bounced = 0, replied = 0, reply_sentiment = NULL, reply_snippet = NULL, reply_from = NULL,
  notified = 0, follow_up_stage = 0, last_follow_up_at = NULL, last_checked_at = NULL
`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function daysAgo(dateStr) {
  if (!dateStr) return null;
  const then = new Date(dateStr).getTime();
  const now = Date.now();
  return Math.floor((now - then) / (1000 * 60 * 60 * 24));
}

function fillTemplate(text, brandName) {
  return (text || "").replace(/{{\s*marka\s*}}/gi, brandName);
}

function getFollowUpTemplate(settings, stage) {
  if (stage === 1) {
    return {
      subject: settings.followup_subject || `Re: {{marka}} ile iş birliği teklifi`,
      body:
        settings.followup_body ||
        `Merhaba {{marka}} ekibi,\n\nGeçen hafta ilettiğim iş birliği teklifiyle ilgili görüşünüzü almak isterim. Uygun bir zamanda kısa bir görüşme ayarlayabilir miyiz?\n\n${settings.signature || ""}`,
    };
  }
  if (stage === 2) {
    return {
      subject: settings.followup2_subject || `{{marka}} - kısa bir hatırlatma`,
      body:
        settings.followup2_body ||
        `Merhaba {{marka}} ekibi,\n\nDaha önce gönderdiğim teklifle ilgili bir güncelleme var mı diye kısaca sormak istedim. Uygun olduğunuzda görüşmekten memnuniyet duyarız.\n\n${settings.signature || ""}`,
    };
  }
  return {
    subject: settings.followup3_subject || `{{marka}} - son bir kez yazıyorum`,
    body:
      settings.followup3_body ||
      `Merhaba {{marka}} ekibi,\n\nBu konuda son kez yazıyorum; şu an için uygun değilse anlayışla karşılarım. İlerleyen bir dönemde tekrar değerlendirmek isterseniz kapımız her zaman açık.\n\n${settings.signature || ""}`,
  };
}

// Son 24 saatte gönderilen (sent ya da bounced durumundaki) markalar arasındaki
// bounce oranını hesaplar; eşiği aşıyorsa güvenlik frenini devreye sokar (bir
// dahaki runAutoSend çağrısı bunu görüp durur) ve kullanıcıya BİR KEZ bildirim
// maili gönderir (spam gibi tekrar tekrar değil — circuit_breaker_notified_at
// bunu garanti eder). Zaten aktifse tekrar tetiklemez.
function checkAndUpdateCircuitBreaker() {
  const settings = db.prepare("SELECT * FROM settings WHERE id = 1").get();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const row = db
    .prepare(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN status = 'bounced' THEN 1 ELSE 0 END) as bounced
       FROM brands
       WHERE status IN ('sent', 'bounced') AND sent_at IS NOT NULL AND sent_at >= ?`
    )
    .get(since);

  const total = row.total || 0;
  const bounced = row.bounced || 0;
  const rate = total > 0 ? bounced / total : 0;

  if (
    !settings.circuit_breaker_active &&
    total >= CIRCUIT_BREAKER_MIN_SAMPLE &&
    rate >= CIRCUIT_BREAKER_THRESHOLD
  ) {
    db.prepare("UPDATE settings SET circuit_breaker_active = 1 WHERE id = 1").run();
    if (!settings.circuit_breaker_notified_at) {
      db.prepare("UPDATE settings SET circuit_breaker_notified_at = CURRENT_TIMESTAMP WHERE id = 1").run();
      mailer
        .sendMail({
          to: process.env.EMAIL_USER,
          subject: "⚠️ Güvenlik freni devreye girdi — otomatik gönderim durduruldu",
          body:
            `Son 24 saatte gönderilen ${total} mailin ${bounced} tanesi (%${Math.round(rate * 100)}) geri döndü.\n\n` +
            `Bu, çok yüksek bir oran olduğu için sistem otomatik gönderimi (günlük limitli otomatik gönderim) kendiliğinden durdurdu — ` +
            `gönderici itibarını korumak için. Muhtemel nedenler: e-mail listesinde çok sayıda geçersiz/eski adres var, ya da gönderici hesabın ` +
            `geçici bir sorun yaşıyor olabilir.\n\n` +
            `Sorunu inceledikten sonra panelde "Ayarlar" bölümünden güvenlik frenini elle kapatıp gönderime devam edebilirsin.`,
        })
        .catch(() => {}); // bildirim gönderilemese bile freni etkilemesin
    }
    return { justTripped: true, rate, total, bounced };
  }

  return { justTripped: false, rate, total, bounced };
}

// Soğuk marka yeniden ısıtma (opt-in, varsayılan kapalı — settings.rewarm_enabled).
// İki grup markayı hedefler:
//  A) Sessiz kalanlar: 3 aşamalı takip tamamlandı (follow_up_stage >= 3), hiç yanıt/
//     bounce gelmedi, üzerinden en az 120 gün geçti — "belki zamanlama kötüydü" diye
//     bir şans daha.
//  B) Olumsuz yanıt verenler: en az 180 gün geçti — "belki koşullar değişmiştir" diye
//     daha uzun bir bekleme sonrası bir şans daha (olumsuz olduğu için daha temkinli).
// Her markaya en fazla 2 kez otomatik yeniden ısıtma uygulanır (rewarm_count). Kalıcı
// "bir daha yazma" listesindeki adresler HER ZAMAN hariç tutulur — bu koruma hiçbir
// koşulda atlanmaz.
function reWarmColdBrands() {
  const settings = db.prepare("SELECT * FROM settings WHERE id = 1").get();
  if (!settings.rewarm_enabled) return { rewarmed: 0, reason: "disabled" };

  const silentSince = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
  const negativeSince = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();

  const silentCandidates = db
    .prepare(
      `SELECT * FROM brands WHERE status = 'sent'
       AND (replied IS NULL OR replied = 0) AND (bounced IS NULL OR bounced = 0)
       AND follow_up_stage >= 3
       AND (rewarm_count IS NULL OR rewarm_count < 2)
       AND (suppressed IS NULL OR suppressed = 0)
       AND COALESCE(last_follow_up_at, sent_at) <= ?`
    )
    .all(silentSince);

  const negativeCandidates = db
    .prepare(
      `SELECT * FROM brands WHERE status = 'sent' AND replied = 1 AND reply_sentiment = 'negative'
       AND (rewarm_count IS NULL OR rewarm_count < 2)
       AND (suppressed IS NULL OR suppressed = 0)
       AND last_checked_at <= ?`
    )
    .all(negativeSince);

  const seen = new Set();
  const candidates = [...silentCandidates, ...negativeCandidates].filter((b) => {
    if (seen.has(b.id)) return false;
    seen.add(b.id);
    return true;
  });

  let rewarmedCount = 0;
  const rewarmedNames = [];

  for (const brand of candidates) {
    // Ekstra güvenlik: kalıcı "bir daha yazma" listesi her koşulda önceliklidir,
    // yukarıdaki suppressed=0 filtresi zaten bunu kapsıyor ama e-posta suppression_list'e
    // marka güncellenmeden az önce eklenmiş olabilir diye burada da tazeden kontrol ediyoruz.
    if (isSuppressed(brand.email)) continue;

    const previousStage = brand.reply_sentiment === "negative" ? "olumsuz yanıt" : "sessiz kalma (yanıtsız)";
    const noteAddition = `[Otomatik yeniden ısıtma #${(brand.rewarm_count || 0) + 1} — önceki durum: ${previousStage}, ${new Date().toLocaleDateString("tr-TR")}]`;
    const newNotes = brand.notes ? `${brand.notes}\n${noteAddition}` : noteAddition;

    db.prepare(
      `UPDATE brands SET status = 'found', ${RESET_TRACKING_ON_SEND_SQL},
        rewarm_count = COALESCE(rewarm_count, 0) + 1,
        deal_stage = CASE WHEN deal_stage = 'rejected' THEN 'new' ELSE deal_stage END,
        notes = ?
       WHERE id = ?`
    ).run(newNotes, brand.id);

    db.prepare("INSERT INTO send_log (brand_id, status, message) VALUES (?, 'sent', ?)").run(
      brand.id,
      `Soğuk marka otomatik olarak yeniden ısıtıldı (${previousStage}), tekrar gönderim kuyruğuna eklendi.`
    );

    rewarmedCount++;
    rewarmedNames.push(brand.name);
  }

  return { rewarmed: rewarmedCount, brands: rewarmedNames };
}

// Haftalık özet maili: son 7 günde ne olduğunu (kaç mail gitti, kaç yanıt/bounce/
// belge talebi/olumlu yanıt geldi) tek bir mailde özetler — her gün panele girip
// kontrol etmek zorunda kalmadan haftalık bir "durum raporu" almış olursun.
// Sunucu o hafta içinde birden fazla kez yeniden başlasa bile (Render gibi platformlarda
// olabilir) settings.last_weekly_summary_at sayesinde aynı hafta ikinci bir mail gitmez.
async function sendWeeklySummary() {
  const settings = db.prepare("SELECT * FROM settings WHERE id = 1").get();
  if (settings.last_weekly_summary_at) {
    const age = daysAgo(settings.last_weekly_summary_at);
    if (age !== null && age < 6) {
      return { sent: false, reason: "already_sent_this_week" };
    }
  }

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const sentThisWeek = db
    .prepare("SELECT COUNT(*) c FROM brands WHERE sent_at IS NOT NULL AND sent_at >= ?")
    .get(since).c;
  const bouncedThisWeek = db
    .prepare("SELECT COUNT(*) c FROM brands WHERE status = 'bounced' AND sent_at IS NOT NULL AND sent_at >= ?")
    .get(since).c;
  const repliedThisWeek = db
    .prepare("SELECT COUNT(*) c FROM brands WHERE replied = 1 AND last_checked_at >= ?")
    .get(since).c;
  const positiveThisWeek = db
    .prepare("SELECT COUNT(*) c FROM brands WHERE replied = 1 AND reply_sentiment = 'positive' AND last_checked_at >= ?")
    .get(since).c;
  const documentsThisWeek = db
    .prepare("SELECT COUNT(*) c FROM brands WHERE document_requested = 1 AND last_checked_at >= ?")
    .get(since).c;
  const unsubscribesThisWeek = db
    .prepare("SELECT COUNT(*) c FROM suppression_list WHERE created_at >= ?")
    .get(since).c;

  const positiveBrands = db
    .prepare(
      `SELECT name, reply_snippet FROM brands
       WHERE replied = 1 AND reply_sentiment = 'positive' AND last_checked_at >= ?
       ORDER BY last_checked_at DESC LIMIT 10`
    )
    .all(since);

  const pendingFollowUp = db
    .prepare(
      `SELECT COUNT(*) c FROM brands WHERE status = 'sent' AND (replied IS NULL OR replied = 0)
       AND (bounced IS NULL OR bounced = 0)`
    )
    .get().c;

  const totalSentAllTime = db.prepare("SELECT COUNT(*) c FROM brands WHERE status = 'sent' OR replied = 1 OR bounced = 1").get().c;

  const lines = [];
  lines.push(`Son 7 günün özeti (${new Date(since).toLocaleDateString("tr-TR")} - ${new Date().toLocaleDateString("tr-TR")}):`);
  lines.push("");
  lines.push(`- Gönderilen mail: ${sentThisWeek}`);
  lines.push(`- Gelen yanıt: ${repliedThisWeek} (${positiveThisWeek} olumlu)`);
  lines.push(`- Geri dönen (bounce): ${bouncedThisWeek}`);
  lines.push(`- Belge/evrak isteyen: ${documentsThisWeek}`);
  lines.push(`- "Bir daha yazma" listesine yeni eklenen: ${unsubscribesThisWeek}`);
  lines.push("");
  lines.push(`Şu an yanıt bekleyen (henüz cevap/bounce gelmemiş): ${pendingFollowUp}`);
  lines.push(`Bugüne kadar toplam işlem gören marka: ${totalSentAllTime}`);

  if (positiveBrands.length > 0) {
    lines.push("");
    lines.push("Bu haftaki olumlu yanıtlar:");
    for (const b of positiveBrands) {
      lines.push(`  • ${b.name}${b.reply_snippet ? ` — "${b.reply_snippet.slice(0, 120)}..."` : ""}`);
    }
  }

  lines.push("");
  lines.push('Detaylar için panelde "Gönderim Takibi" sayfasına bakabilirsin.');

  try {
    await mailer.sendMail({
      to: process.env.EMAIL_USER,
      subject: `📊 Haftalık özet: ${sentThisWeek} mail, ${repliedThisWeek} yanıt, ${positiveThisWeek} olumlu`,
      body: lines.join("\n"),
    });
    db.prepare("UPDATE settings SET last_weekly_summary_at = CURRENT_TIMESTAMP WHERE id = 1").run();
    return { sent: true, sentThisWeek, repliedThisWeek, positiveThisWeek, bouncedThisWeek };
  } catch (e) {
    return { sent: false, reason: "error", error: e.message };
  }
}

// Gelen kutusu kontrolü + bounce taraması + follow-up gönderimi. Hem manuel butondan
// hem de günlük otomatik (cron) çalıştırmadan bu fonksiyon kullanılır.
async function runFullCheck() {
  const summary = {
    checked: 0,
    repliesFound: 0,
    followUpsSent: 0,
    notificationsSent: 0,
    bouncesFound: 0,
    documentsRequested: 0,
    unsubscribesFound: 0,
    errors: [],
  };

  const candidates = db
    .prepare(
      `SELECT * FROM brands WHERE status = 'sent' AND (replied IS NULL OR replied = 0)
       AND (bounced IS NULL OR bounced = 0) AND email IS NOT NULL`
    )
    .all();

  if (candidates.length === 0) return summary;

  const brandList = candidates.map((b) => ({
    id: b.id,
    email: b.email,
    sentAtDate: b.sent_at ? new Date(b.sent_at) : null,
  }));

  // 1) Önce bounce (geri dönen mail) taraması yap, bounce olanları döngü dışına al
  let bouncedIds = new Set();
  try {
    const bounceResult = await checkBounces(brandList);
    bouncedIds = bounceResult.bouncedIds;
    // ÖNEMLİ: eskiden bir arama kalıbı ya da mesaj okuma hatası sessizce yutulup
    // hiçbir yerde gösterilmiyordu — bu yüzden gerçekte bir bağlantı/izin sorunu
    // olsa bile ekranda "0 bulundu" görünüyor, kullanıcı neden hiçbir şey
    // bulunamadığını hiç anlayamıyordu. Artık bu hatalar summary.errors'a ekleniyor
    // ve "Yanıtları Kontrol Et" sonucunda açıkça gösteriliyor.
    if (bounceResult.errors && bounceResult.errors.length > 0) {
      const uniq = [...new Set(bounceResult.errors)];
      summary.errors.push(
        `Bounce taraması sırasında ${bounceResult.errors.length} hata oluştu: ${uniq.slice(0, 3).join(" | ")}${uniq.length > 3 ? " ..." : ""}`
      );
    }
    for (const id of bouncedIds) {
      db.prepare(
        "UPDATE brands SET bounced = 1, status = 'bounced', last_error = 'Mail geri döndü (geçersiz adres olabilir). E-maili düzeltip tekrar deneyebilirsin.' WHERE id = ?"
      ).run(id);
      summary.bouncesFound++;
    }
  } catch (e) {
    summary.errors.push(`Bounce taraması tamamen başarısız oldu: ${e.message}`);
  }

  try {
    const breakerResult = checkAndUpdateCircuitBreaker();
    if (breakerResult.justTripped) {
      summary.errors.push(
        `⚠️ Güvenlik freni devreye girdi: son 24 saatte gönderilenlerin %${Math.round(breakerResult.rate * 100)}'i geri döndü (${breakerResult.bounced}/${breakerResult.total}). Otomatik gönderim durduruldu — "Ayarlar" bölümünden inceleyip elle devam ettirebilirsin.`
      );
    }
  } catch (e) {
    summary.errors.push(`Güvenlik freni kontrolü sırasında hata: ${e.message}`);
  }

  const remainingCandidates = candidates.filter((b) => !bouncedIds.has(b.id));
  const remainingBrandList = brandList.filter((b) => !bouncedIds.has(b.id));

  if (remainingCandidates.length === 0) {
    summary.checked = candidates.length;
    return summary;
  }

  try {
    const { results, errors: replyErrors } = await checkRepliesForMany(remainingBrandList);
    if (replyErrors && replyErrors.length > 0) {
      const uniq = [...new Set(replyErrors)];
      summary.errors.push(
        `Yanıt taraması sırasında ${replyErrors.length} markada hata oluştu: ${uniq.slice(0, 3).join(" | ")}${uniq.length > 3 ? " ..." : ""}`
      );
    }
    const settings = db.prepare("SELECT * FROM settings WHERE id = 1").get();

    for (const brand of remainingCandidates) {
      const result = results.get(brand.id);
      db.prepare("UPDATE brands SET last_checked_at = CURRENT_TIMESTAMP WHERE id = ?").run(brand.id);

      if (result && result.found && result.isBounceLike) {
        // "Yanıt" gibi görünse de (marka adresinden geldiği için eşleşti) aslında
        // otomatik bir teslim edilememe bildirimi — gerçek bir insan yanıtı sayma,
        // bounce olarak işaretle ki "Ulaşmayanlar" listesinde görünsün.
        db.prepare(
          `UPDATE brands SET bounced = 1, status = 'bounced',
           last_error = ? WHERE id = ?`
        ).run(
          result.aiReason
            ? `Mail geri döndü (AI tespiti): ${result.aiReason}`
            : "Mail geri döndü (geçersiz adres olabilir). E-maili düzeltip tekrar deneyebilirsin.",
          brand.id
        );
        summary.bouncesFound++;
        continue;
      }

      if (result && result.found) {
        // matchType === "domain": marka adresinin kendisinden değil, aynı domain'deki
        // FARKLI bir adresten gelen bir yanıt eşleşti (örn. şirketteki başka biri
        // cevaplamış olabilir) — bunu snippet'e not düşüyoruz ki elle kontrol edesin.
        const notePrefix =
          result.matchType === "domain"
            ? "[Not: bu yanıt marka adresinin kendisinden değil, aynı domain'deki farklı bir adresten geldi — kontrol et] "
            : "";
        db.prepare(
          `UPDATE brands SET replied = 1, reply_sentiment = ?, reply_snippet = ?, reply_from = ?,
           document_requested = ?, document_request_snippet = ?
           WHERE id = ?`
        ).run(
          result.sentiment,
          notePrefix + result.snippet,
          result.from,
          result.documentRequested ? 1 : 0,
          result.documentRequested ? result.snippet : null,
          brand.id
        );
        summary.repliesFound++;
        if (result.documentRequested) summary.documentsRequested++;

        // CRM pipeline'ı otomatik ilerlet: olumlu yanıt geldiyse "Olumlu Yanıt"a,
        // evrak istendiyse (daha ileri bir aşama olduğu için) "Evrak İstendi"ye.
        if (result.sentiment === "positive") {
          advanceCrmStage(brand.id, brand.crm_stage, "positive_reply");
        }
        if (result.documentRequested) {
          advanceCrmStage(brand.id, brand.crm_stage, "documents_requested");
        }

        // Alıcı açıkça "bir daha yazma" dediyse, bu e-postayı KALICI olarak
        // "bir daha yazma" listesine ekle — marka kaydı silinse/yeniden yüklense
        // bile bir daha ASLA bu adrese mail gitmez (bkz. services/suppression.js).
        if (result.unsubscribeRequested) {
          addToSuppressionList(
            brand.email,
            `"${brand.name}" markasına gönderilen mailin yanıtında açık bir çıkış talebi tespit edildi.`,
            brand.name
          );
          summary.unsubscribesFound++;
        }

        if (result.sentiment === "positive" && !brand.notified) {
          try {
            await mailer.sendMail({
              to: process.env.EMAIL_USER,
              subject: `Olumlu yanıt geldi: ${brand.name}`,
              body: `${brand.name} markasından olumlu bir yanıt geldi.\n\nGönderen: ${result.from}\n\nMesaj:\n${result.snippet}\n\nPaneldeki "Gönderim Takibi" sayfasından detaylara bakabilirsin.`,
            });
            db.prepare("UPDATE brands SET notified = 1 WHERE id = ?").run(brand.id);
            summary.notificationsSent++;
          } catch (e) {
            summary.errors.push(`Bildirim gönderilemedi (${brand.name}): ${e.message}`);
          }
        }
        continue;
      }

      // Bu marka daha önce (ör. başka bir alt marka adıyla) "bir daha yazma"
      // demiş bir e-postayı paylaşıyorsa, otomatik follow-up drip'i ASLA bu
      // adrese mail atmasın — kalıcı liste her şeyin önünde gelir.
      if (isSuppressed(brand.email)) {
        continue;
      }

      const age = daysAgo(brand.sent_at);
      const currentStage = brand.follow_up_stage || 0;
      const nextStep = FOLLOW_UP_SCHEDULE.find(
        (step) => step.stage === currentStage + 1 && age !== null && age >= step.afterDays
      );

      if (nextStep) {
        const template = getFollowUpTemplate(settings, nextStep.stage);
        try {
          await mailer.sendMail({
            to: brand.email,
            subject: fillTemplate(template.subject, brand.name),
            body: fillTemplate(template.body, brand.name),
          });
          db.prepare(
            `UPDATE brands SET follow_up_stage = ?, last_follow_up_at = CURRENT_TIMESTAMP,
             follow_up_sent_at = CURRENT_TIMESTAMP WHERE id = ?`
          ).run(nextStep.stage, brand.id);
          db.prepare(
            "INSERT INTO send_log (brand_id, status, message) VALUES (?, 'sent', ?)"
          ).run(brand.id, `${nextStep.stage}. aşama follow-up gönderildi: ${brand.email}`);
          summary.followUpsSent++;
          // Aynı çalıştırmada birden fazla marka follow-up gününe denk gelirse,
          // hepsini art arda hiç beklemeden göndermek yerine (bot gibi görünen bir
          // patlama) rastgele kısa bir ara veriyoruz — gönderici itibarını korumaya
          // yardımcı olur.
          await sleep(2000 + Math.floor(Math.random() * 3000));
        } catch (e) {
          summary.errors.push(`${brand.name}: ${e.message}`);
        }
      }
    }

    summary.checked = candidates.length;
    return summary;
  } catch (err) {
    summary.errors.push(err.message);
    return summary;
  }
}

// Gönderilmiş tüm markaları, gün sayısı ve yanıt/pipeline durumu ile birlikte listele
router.get("/api/tracking", (req, res) => {
  const brands = db
    .prepare(
      `SELECT * FROM brands WHERE status IN ('sent', 'bounced') OR replied = 1 ORDER BY sent_at DESC`
    )
    .all();

  const enriched = brands.map((b) => ({
    ...b,
    days_since_sent: daysAgo(b.sent_at),
  }));

  res.json({ brands: enriched, dealStages: DEAL_STAGES });
});

// Takip mail şablonlarını getir/kaydet (3 aşama)
router.get("/api/tracking/followup-template", (req, res) => {
  const settings = db
    .prepare(
      `SELECT followup_subject, followup_body, followup2_subject, followup2_body,
              followup3_subject, followup3_body
       FROM settings WHERE id = 1`
    )
    .get();
  res.json({ settings });
});

router.post("/api/tracking/followup-template", (req, res) => {
  const { stage1, stage2, stage3 } = req.body;
  db.prepare(
    `UPDATE settings SET
      followup_subject = ?, followup_body = ?,
      followup2_subject = ?, followup2_body = ?,
      followup3_subject = ?, followup3_body = ?
     WHERE id = 1`
  ).run(
    stage1?.subject || "",
    stage1?.body || "",
    stage2?.subject || "",
    stage2?.body || "",
    stage3?.subject || "",
    stage3?.body || ""
  );
  res.json({ ok: true });
});

// Soğuk marka yeniden ısıtmayı elle (test amaçlı) hemen çalıştırmak için.
router.post("/api/tracking/rewarm/run-now", (req, res) => {
  try {
    const result = reWarmColdBrands();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Yeniden ısıtma sırasında hata: " + err.message });
  }
});

// Haftalık özet mailini elle (test amaçlı ya da unutulmuşsa) hemen göndermek için.
// "already_sent_this_week" korumasını bu da uygular — art arda basılırsa spam gibi
// tekrar tekrar göndermez.
router.post("/api/tracking/weekly-summary/send-now", async (req, res) => {
  try {
    const result = await sendWeeklySummary();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Haftalık özet gönderilemedi: " + err.message });
  }
});

// Güvenlik freni devreye girdikten sonra kullanıcı sorunu inceleyip devam etmek
// istediğinde bunu elle sıfırlamak için (otomatik gönderim tekrar açılır).
router.post("/api/tracking/circuit-breaker/reset", (req, res) => {
  db.prepare(
    "UPDATE settings SET circuit_breaker_active = 0, circuit_breaker_notified_at = NULL WHERE id = 1"
  ).run();
  res.json({ ok: true });
});

// Gelen kutusunu kontrol et (manuel buton)
router.post("/api/tracking/check-replies", async (req, res) => {
  try {
    const summary = await runFullCheck();
    res.json({ ok: true, ...summary });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gelen kutusu kontrol edilirken hata oluştu: " + err.message });
  }
});

// Hızlı tanı: IMAP bağlantısı gerçekten çalışıyor mu, gelen kutusunda kaç mesaj
// var? "Yanıtları Kontrol Et" sürekli 0 sonuç döndürüyorsa önce bunu dene —
// saniyeler içinde kimlik bilgisi/erişim sorunu mu yoksa gerçekten eşleşen bir
// şey mi yok olduğunu ayırt edebilirsin.
router.get("/api/tracking/imap-test", async (req, res) => {
  try {
    const result = await testImapConnection();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: "IMAP bağlantısı kurulamadı: " + err.message,
    });
  }
});

// Bir markanın yanıt durumunu ve/veya pipeline aşamasını elle düzelt
router.put("/api/tracking/:id", (req, res) => {
  const { reply_sentiment, deal_stage, document_requested } = req.body;
  const brand = db.prepare("SELECT * FROM brands WHERE id = ?").get(req.params.id);
  if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });

  if (reply_sentiment !== undefined) {
    db.prepare("UPDATE brands SET reply_sentiment = ? WHERE id = ?").run(reply_sentiment, brand.id);
  }
  if (deal_stage !== undefined) {
    if (!DEAL_STAGES.includes(deal_stage)) {
      return res.status(400).json({ error: "Geçersiz aşama." });
    }
    db.prepare("UPDATE brands SET deal_stage = ? WHERE id = ?").run(deal_stage, brand.id);
  }
  if (document_requested !== undefined) {
    db.prepare("UPDATE brands SET document_requested = ? WHERE id = ?").run(
      document_requested ? 1 : 0,
      brand.id
    );
  }
  res.json({ ok: true });
});

// Bir markaya ait tüm gönderim/takip geçmişini (ilk gönderim, her follow-up aşaması,
// hatalar) kronolojik sırayla döner — "kaçıncı takibi ne zaman attık" sorusuna cevap.
router.get("/api/tracking/:id/history", (req, res) => {
  const brand = db.prepare("SELECT * FROM brands WHERE id = ?").get(req.params.id);
  if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });
  const logs = db
    .prepare("SELECT * FROM send_log WHERE brand_id = ? ORDER BY created_at ASC")
    .all(brand.id);
  res.json({ brand: { id: brand.id, name: brand.name }, logs });
});

// Tüm marka + durum verisini Excel olarak indir
router.get("/api/tracking/export", (req, res) => {
  const brands = db.prepare("SELECT * FROM brands ORDER BY id").all();

  const rows = brands.map((b) => ({
    Marka: b.name,
    Website: b.website || "",
    Email: b.email || "",
    Durum: b.status,
    "Gönderim Tarihi": b.sent_at || "",
    "Gönderim Yöntemi": b.sent_via === "contact_form" ? "İletişim Formu" : b.sent_at ? "E-mail" : "",
    "Yanıt Geldi mi": b.replied ? "Evet" : "Hayır",
    "Yanıt Tonu": b.reply_sentiment || "",
    "Yanıt Özeti": b.reply_snippet || "",
    "Takip Aşaması": b.follow_up_stage || 0,
    "Anlaşma Aşaması": b.deal_stage || "new",
    "Geri Döndü mü": b.bounced ? "Evet" : "Hayır",
    "Belge İstendi mi": b.document_requested ? "Evet" : "Hayır",
    "Bir Daha Yazma Listesinde mi": b.suppressed ? "Evet" : "Hayır",
    Not: b.notes || "",
    Telefon: b.phone || "",
    Ülke: b.country || "",
    "Marka Skoru": b.brand_score ?? "",
    "Tahmini Aylık Ciro": b.est_monthly_revenue ?? "",
    "Ort. Satıcı Sayısı": b.avg_sellers ?? "",
    "Amazon Stok Oranı": b.amazon_in_stock_rate ?? "",
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Markalar");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", "attachment; filename=marka-takip.xlsx");
  res.send(buffer);
});

// v58: A/B test için mail açılma (open) takip pikseli. sendMail() otomatik/toplu
// gönderimlere bu adresi gösteren 1x1'lik görünmez bir resim ekler (bkz.
// services/mailer.js -> trackOpenBrandId). Alıcının mail istemcisi resimleri
// otomatik indirirse bu uç nokta çağrılır ve "opened" bayrağı bir kez set edilir.
// Resim hiç yüklenmese bile (birçok istemci resimleri engeller) sistemin geri
// kalanı etkilenmez — bu sadece EK bir sinyal, zorunlu bir mekanizma değil.
const TRANSPARENT_PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);
router.get("/api/track/o/:brandId", (req, res) => {
  const brandId = parseInt(req.params.brandId, 10);
  if (brandId) {
    try {
      db.prepare(
        "UPDATE brands SET opened = 1, opened_at = COALESCE(opened_at, CURRENT_TIMESTAMP) WHERE id = ?"
      ).run(brandId);
    } catch (e) {
      // sessizce geç — takip pikseli asla hata döndürmemeli (mail istemcisinde kırık resim gösterir)
    }
  }
  res.set("Content-Type", "image/png");
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.send(TRANSPARENT_PNG_1X1);
});

module.exports = router;
module.exports.runFullCheck = runFullCheck;
module.exports.sendWeeklySummary = sendWeeklySummary;
module.exports.reWarmColdBrands = reWarmColdBrands;
// Test setinin (tests/) gerçek güvenlik freni mantığını doğrudan çağırabilmesi için.
module.exports.checkAndUpdateCircuitBreaker = checkAndUpdateCircuitBreaker;
module.exports.CIRCUIT_BREAKER_MIN_SAMPLE = CIRCUIT_BREAKER_MIN_SAMPLE;
module.exports.CIRCUIT_BREAKER_THRESHOLD = CIRCUIT_BREAKER_THRESHOLD;
