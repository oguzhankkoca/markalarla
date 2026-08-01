// v47: Dashboard'a "Bugün Yapılacaklar" akıllı paneli — sistemde dağınık halde
// bulunan (görevler, olumlu yanıtlar, belge istekleri, yüksek öncelikli markalar,
// otomatik gönderim durumu) bilgileri TEK bir uç noktada birleştirir; kullanıcı
// güne başlarken tek bir yere bakıp "bugün ne yapmam lazım" sorusuna cevap bulsun.
// SADECE OKUMA yapar, hiçbir veriyi değiştirmez.
const express = require("express");
const db = require("../db");
const { findFuzzyDuplicateGroups } = require("../services/fuzzyDedup");

const router = express.Router();

router.get("/api/dashboard/today", (req, res) => {
  const todayStr = new Date().toISOString().slice(0, 10);

  const tasksDue = db
    .prepare(
      `SELECT tasks.*, brands.name as brand_name FROM tasks
       JOIN brands ON brands.id = tasks.brand_id
       WHERE tasks.completed = 0 AND tasks.due_date IS NOT NULL AND tasks.due_date <= ?
       ORDER BY tasks.due_date ASC LIMIT 25`
    )
    .all(todayStr);

  // Yanıt geldi ama henüz AI ile sınıflandırılmamış (ya da elle değerlendirilmemiş)
  // markalar — kullanıcının cevap yazması gereken en acil öğeler.
  const pendingReplies = db
    .prepare(
      `SELECT id, name, email, reply_sentiment, reply_snippet, last_checked_at FROM brands
       WHERE replied = 1 AND (reply_category IS NULL OR reply_category = '')
       ORDER BY last_checked_at DESC LIMIT 15`
    )
    .all();

  const documentRequests = db
    .prepare(
      `SELECT id, name, email, document_request_snippet, last_checked_at FROM brands
       WHERE document_requested = 1
       ORDER BY last_checked_at DESC LIMIT 15`
    )
    .all();

  // AI tarafından "high" öncelikli işaretlenmiş ama henüz mail gönderilmemiş markalar.
  const highPriorityUnsent = db
    .prepare(
      `SELECT id, name, email, ai_priority, ai_tags, opportunity_score FROM brands
       WHERE ai_priority = 'high' AND status = 'found' AND email IS NOT NULL
       ORDER BY COALESCE(opportunity_score, 0) DESC LIMIT 15`
    )
    .all();

  // Fuzzy duplicate taraması — sadece SAYI göster (tam liste /api/brands/fuzzy-duplicates'te),
  // dashboard'da sadece "X grup incelemeni bekliyor" uyarısı için.
  let fuzzyDuplicateGroupCount = 0;
  try {
    const brandsForFuzzy = db.prepare("SELECT id, name FROM brands").all();
    fuzzyDuplicateGroupCount = findFuzzyDuplicateGroups(brandsForFuzzy).length;
  } catch (e) {
    fuzzyDuplicateGroupCount = 0;
  }

  const settings = db.prepare("SELECT * FROM settings WHERE id = 1").get() || {};
  const sentTodayRow = db
    .prepare("SELECT COUNT(*) as c FROM brands WHERE status = 'sent' AND substr(sent_at, 1, 10) = ?")
    .get(todayStr);

  res.json({
    date: todayStr,
    tasksDue,
    pendingReplies,
    documentRequests,
    highPriorityUnsent,
    fuzzyDuplicateGroupCount,
    autoSend: {
      enabled: Number(settings.daily_send_limit) > 0,
      limit: Number(settings.daily_send_limit) || 0,
      sentToday: sentTodayRow ? sentTodayRow.c : 0,
      circuitBreakerActive: Boolean(settings.circuit_breaker_active),
    },
    totalActionItems:
      tasksDue.length + pendingReplies.length + documentRequests.length + highPriorityUnsent.length,
  });
});

module.exports = router;
