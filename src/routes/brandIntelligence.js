// Brand Intelligence + Growth Audit API rotaları (v68). Mevcut find-all/send-batch
// route'larıyla AYNI "sunucu tarafında arka plan job'ı" deseni kullanılır (bkz.
// brands.js: findAllJob/processFindAllQueue) — tarayıcı sekmesi kapansa/değişse
// bile devam eder, panel periyodik olarak durumu sorar.
const express = require("express");
const db = require("../db");
const intelSvc = require("../services/brandIntelligence");
const { isConfigured: aiConfigured } = require("../services/ai");

const router = express.Router();

function getBrand(id) {
  return db.prepare("SELECT * FROM brands WHERE id = ?").get(id);
}

// ---------------------------------------------------------------------------
// Tekli marka: mevcut Marka Detay panelindeki "Brand Intelligence" sekmesi bunu
// çağırır. level: 2 (fast screen), 3 (deep research, level2'yi de içerir), 4
// (growth audit, level3'ü ÖNCEDEN yapılmış olmasını varsayar ama zorunlu kılmaz).
router.post("/api/brands/:id/intel/research", async (req, res) => {
  const brand = getBrand(req.params.id);
  if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });
  const level = Number(req.body?.level) || 3;
  try {
    let result;
    if (level === 2) result = await intelSvc.runLevel2Screen(brand);
    else if (level === 4) result = await intelSvc.runLevel4GrowthAudit(brand);
    else result = await intelSvc.runLevel3DeepResearch(brand);
    const intel = intelSvc.getParsedIntel(brand.id);
    res.json({ ok: result.ok, reason: result.reason, trace: result.trace, intel });
  } catch (e) {
    res.status(500).json({ error: "Araştırma sırasında hata: " + e.message });
  }
});

router.get("/api/brands/:id/intel", (req, res) => {
  const brand = getBrand(req.params.id);
  if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });
  const intel = intelSvc.getParsedIntel(brand.id);
  res.json({
    ok: true,
    intel,
    stale: intelSvc.isStale(intel.researched_at),
    aiConfigured: aiConfigured(),
  });
});

// Amazon Authorization Tracking (madde 28) — bunlar AI tahmini DEĞİL, kullanıcının
// süreç ilerledikçe elle işaretlediği gerçek durumlar. growth_metrics sayaçları
// (madde 29) sadece durum GERÇEKTEN değiştiğinde bir kez artırılır.
const MANUAL_FIELDS = [
  "wholesale_approval_status",
  "loa_requested",
  "loa_received",
  "authorized_reseller_status",
  "amazon_approval_status",
  "amazon_gating_status",
];

router.put("/api/brands/:id/intel", (req, res) => {
  const brand = getBrand(req.params.id);
  if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });
  const before = intelSvc.getParsedIntel(brand.id);

  const updates = {};
  for (const field of MANUAL_FIELDS) {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  }
  if (Object.keys(updates).length === 0 && req.body.first_po_value === undefined) {
    return res.status(400).json({ error: "Güncellenecek alan yok." });
  }

  const setClauses = Object.keys(updates)
    .map((k) => `${k} = ?`)
    .concat(["updated_at = CURRENT_TIMESTAMP"]);
  const values = Object.values(updates);
  if (setClauses.length > 1) {
    db.prepare(`UPDATE brand_intelligence SET ${setClauses.join(", ")} WHERE brand_id = ?`).run(...values, brand.id);
  }

  // growth_metrics: yalnızca GERÇEK bir geçiş olduğunda (önceki durum farklıydı) artır.
  if (updates.wholesale_approval_status === "applied" && before.wholesale_approval_status !== "applied") {
    db.prepare("UPDATE growth_metrics SET wholesale_applications = wholesale_applications + 1 WHERE id = 1").run();
  }
  if (updates.wholesale_approval_status === "approved" && before.wholesale_approval_status !== "approved") {
    db.prepare("UPDATE growth_metrics SET approved_brands = approved_brands + 1 WHERE id = 1").run();
  }
  if (typeof req.body.first_po_value === "number" && req.body.first_po_value > 0 && !before.first_po_recorded_flag) {
    db.prepare(
      "UPDATE growth_metrics SET first_orders = first_orders + 1, first_po_total_value = first_po_total_value + ? WHERE id = 1"
    ).run(req.body.first_po_value);
    db.prepare("UPDATE brand_intelligence SET first_po_recorded_flag = 1 WHERE brand_id = ?").run(brand.id);
  }

  res.json({ ok: true, intel: intelSvc.getParsedIntel(brand.id) });
});

router.get("/api/growth-metrics", (req, res) => {
  const gm = db.prepare("SELECT * FROM growth_metrics WHERE id = 1").get();
  const emailsSent = db.prepare("SELECT COUNT(*) c FROM brands WHERE status = 'sent' OR replied = 1 OR bounced = 1").get().c;
  const replies = db.prepare("SELECT COUNT(*) c FROM brands WHERE replied = 1").get().c;
  const positiveReplies = db.prepare("SELECT COUNT(*) c FROM brands WHERE reply_sentiment = 'positive'").get().c;
  res.json({
    ok: true,
    metrics: {
      emailsSent,
      replies,
      positiveReplies,
      wholesaleApplications: gm.wholesale_applications,
      approvedBrands: gm.approved_brands,
      firstOrders: gm.first_orders,
      firstPoTotalValue: gm.first_po_total_value,
    },
  });
});

// ---------------------------------------------------------------------------
// BULK PROCESSING (madde 23) — LEVEL 2/3/4 kademeli toplu işleme. Aynı find-all
// job deseni: kuyruğa alınır, arka planda işlenir, panel polling ile ilerlemeyi
// gösterir; Durdur/Devam Et destekler.
// ---------------------------------------------------------------------------
let intelJob = { remainingIds: [], running: false, total: 0, processedCount: 0, currentBrandName: null, level: 3, errors: [] };

async function processIntelQueue() {
  intelJob.running = true;
  while (intelJob.remainingIds.length > 0 && intelJob.running) {
    const id = intelJob.remainingIds.shift();
    const brand = getBrand(id);
    if (!brand) continue;
    intelJob.currentBrandName = brand.name;
    try {
      if (intelJob.level === 2) await intelSvc.runLevel2Screen(brand);
      else if (intelJob.level === 4) await intelSvc.runLevel4GrowthAudit(brand);
      else await intelSvc.runLevel3DeepResearch(brand);
    } catch (e) {
      intelJob.errors.push(`${brand.name}: ${e.message}`);
    }
    intelJob.processedCount++;
  }
  intelJob.running = false;
  intelJob.currentBrandName = null;
}

// Staleness'a göre (madde 24) hangi markaların yeniden araştırılması gerektiğini
// belirler — force=true değilse zaten taze (STALE_AFTER_DAYS içinde) araştırılmış
// markaları tekrar işlemez, gereksiz AI/arama maliyetinden kaçınır.
function filterNeedsResearch(brandIds, level, force) {
  if (force) return brandIds;
  return brandIds.filter((id) => {
    const intel = db.prepare("SELECT research_status, researched_at FROM brand_intelligence WHERE brand_id = ?").get(id);
    if (!intel) return true;
    const levelKey = level === 2 ? "level2" : level === 4 ? "level4" : "level3";
    const levelsDone = { not_researched: 0, level2: 1, level3: 2, level4: 3 };
    const targetOrder = { 2: 1, 3: 2, 4: 3 }[level];
    if ((levelsDone[intel.research_status] || 0) < targetOrder) return true;
    return intelSvc.isStale(intel.researched_at);
  });
}

router.post("/api/brands/intel/research-bulk", (req, res) => {
  if (intelJob.running) {
    return res.status(409).json({ error: "Zaten devam eden bir araştırma var. Önce durdur ya da bitmesini bekle." });
  }
  const { ids, level, limit, force } = req.body || {};
  const targetLevel = [2, 3, 4].includes(Number(level)) ? Number(level) : 3;

  let candidateIds;
  if (Array.isArray(ids) && ids.length > 0) {
    candidateIds = ids;
  } else {
    // Kademeli sistem: ID verilmediyse, LEVEL 1 (mevcut SmartScout filtreleri/
    // Opportunity Score) zaten uygulanmış sayılır — biz sadece Opportunity Score'a
    // göre en değerli N markayı seçeriz (varsayılan 20, maliyet kontrolü için).
    const topN = Number(limit) || 20;
    const rows = db
      .prepare(
        `SELECT id FROM brands WHERE email IS NOT NULL AND (suppressed IS NULL OR suppressed = 0)
         ORDER BY COALESCE(opportunity_score, 0) DESC LIMIT ?`
      )
      .all(topN);
    candidateIds = rows.map((r) => r.id);
  }

  const filtered = filterNeedsResearch(candidateIds, targetLevel, Boolean(force));

  intelJob = {
    remainingIds: filtered.slice(),
    running: false,
    total: filtered.length,
    processedCount: 0,
    currentBrandName: null,
    level: targetLevel,
    errors: [],
  };
  res.json({ ok: true, queued: filtered.length, skippedFresh: candidateIds.length - filtered.length });
  processIntelQueue();
});

router.post("/api/brands/intel/research-bulk/stop", (req, res) => {
  intelJob.running = false;
  res.json({ ok: true, remaining: intelJob.remainingIds.length });
});

router.post("/api/brands/intel/research-bulk/resume", (req, res) => {
  if (intelJob.running) return res.status(409).json({ error: "Zaten çalışıyor." });
  if (intelJob.remainingIds.length === 0) return res.status(400).json({ error: "Devam edilecek bir araştırma yok." });
  res.json({ ok: true, remaining: intelJob.remainingIds.length });
  processIntelQueue();
});

router.get("/api/brands/intel/research-bulk/status", (req, res) => {
  res.json({
    running: intelJob.running,
    remaining: intelJob.remainingIds.length,
    total: intelJob.total,
    processedCount: intelJob.processedCount,
    currentBrandName: intelJob.currentBrandName,
    level: intelJob.level,
    errors: intelJob.errors.slice(-10),
  });
});

module.exports = router;
