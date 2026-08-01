// AI özellikleri (v55 kişiselleştirme, v56 öncelik+etiket, v57 yanıt sınıflandırma
// + taslak yanıt). ÜÇÜ DE İSTEĞE BAĞLIDIR: hiçbiri otomatik/arka planda çalışmaz,
// sadece kullanıcı bu uç noktalardan birini ("AI Analiz Et" butonu ile) manuel
// tetiklediğinde devreye girer. Bu yüzden ANTHROPIC_API_KEY tanımlı değilse
// sistemin geri kalanı etkilenmez — sadece bu route'lar net bir hata mesajı döner.
const express = require("express");
const db = require("../db");
const { isConfigured, askClaude, extractJson } = require("../services/ai");
const { logEvent } = require("../services/events");

const router = express.Router();

function getBrandsByIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  return ids
    .map((id) => db.prepare("SELECT * FROM brands WHERE id = ?").get(id))
    .filter(Boolean);
}

function requireAi(res) {
  if (!isConfigured()) {
    res.status(400).json({
      error:
        "AI özellikleri için ANTHROPIC_API_KEY tanımlı değil. Ayarlar'a bir Anthropic API anahtarı ekleyin (console.anthropic.com).",
    });
    return false;
  }
  return true;
}

// --- v55: AI kişiselleştirme -------------------------------------------------
// Markanın adı/kategorisi/website'ine bakarak outreach mailinin başına eklenebilecek
// kısa (2-3 cümle), samimi ama profesyonel bir giriş paragrafı üretir. Kullanıcı bunu
// mail şablonuna elle kopyalar/yapıştırır (otomatik gönderime karışmaz).
async function personalizeBrand(brand) {
  const prompt = `Sen bir toptan satış (wholesale) iş geliştirme uzmanısın. Aşağıdaki markaya gönderilecek bir tanışma e-postasının GİRİŞ paragrafını (2-3 cümle, İngilizce, samimi ama profesyonel, abartısız) yaz. Marka adını ve (varsa) kategorisini doğal şekilde kullan. Sadece paragrafın kendisini döndür, başka açıklama ekleme.

Marka adı: ${brand.name}
Kategori: ${brand.main_category || "bilinmiyor"} ${brand.subcategory ? "/ " + brand.subcategory : ""}
Website: ${brand.website || "yok"}`;
  const result = await askClaude(prompt, { maxTokens: 220 });
  if (!result) return { error: "AI yapılandırılmamış." };
  if (result.error) return { error: result.error };
  const intro = (result.text || "").trim();
  if (!intro) return { error: "AI boş yanıt döndürdü." };
  db.prepare(
    "UPDATE brands SET ai_personalized_intro = ?, ai_personalized_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(intro, brand.id);
  logEvent(brand.id, "ai_personalized", "Kişiselleştirilmiş giriş oluşturuldu");
  return { intro };
}

router.post("/api/brands/ai-personalize", async (req, res) => {
  if (!requireAi(res)) return;
  const { ids } = req.body || {};
  const brands = getBrandsByIds(ids);
  if (brands.length === 0) return res.status(400).json({ error: "Marka seçilmedi." });
  const results = [];
  for (const brand of brands) {
    const r = await personalizeBrand(brand);
    results.push({ id: brand.id, name: brand.name, ...r });
  }
  res.json({ ok: true, results });
});

// --- v56: AI Lead Priority + otomatik etiketleme -----------------------------
// Opportunity Score ve marka verilerine bakarak high/medium/low öncelik ve
// kısa etiketler (ör. "Yüksek Ciro", "Rakip Az", "Yeni Marka") üretir.
async function prioritizeBrand(brand) {
  const prompt = `Aşağıdaki Amazon markası için bir toptan satış iş geliştirme uzmanı gözünden ÖNCELİK seviyesi ve kısa etiketler belirle. SADECE şu formatta geçerli JSON döndür, başka hiçbir açıklama ekleme:
{"priority": "high" | "medium" | "low", "tags": ["kısa etiket 1", "kısa etiket 2", ...]}
En fazla 4 etiket ver, her biri kısa olsun (1-3 kelime, Türkçe).

Marka: ${brand.name}
Opportunity Score (0-100): ${brand.opportunity_score ?? "bilinmiyor"}
Tahmini aylık ciro: ${brand.est_monthly_revenue ?? "bilinmiyor"}
Toplam yorum sayısı: ${brand.total_reviews ?? "bilinmiyor"}
Ortalama satıcı sayısı (rekabet): ${brand.avg_sellers ?? "bilinmiyor"}
Kategori: ${brand.main_category || "bilinmiyor"}
Güven (email kalitesi): ${brand.confidence || "bilinmiyor"}
Büyüme (12 ay): ${brand.growth_12m ?? "bilinmiyor"}`;
  const result = await askClaude(prompt, { maxTokens: 200 });
  if (!result) return { error: "AI yapılandırılmamış." };
  if (result.error) return { error: result.error };
  const parsed = extractJson(result.text);
  if (!parsed || !parsed.priority) return { error: "AI yanıtı ayrıştırılamadı." };
  const priority = ["high", "medium", "low"].includes(parsed.priority) ? parsed.priority : "medium";
  const tags = Array.isArray(parsed.tags) ? parsed.tags.slice(0, 6) : [];
  db.prepare(
    "UPDATE brands SET ai_priority = ?, ai_tags = ?, ai_analyzed_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(priority, JSON.stringify(tags), brand.id);
  logEvent(brand.id, "ai_priority_tagged", `${priority} — ${tags.join(", ")}`);
  return { priority, tags };
}

router.post("/api/brands/ai-priority", async (req, res) => {
  if (!requireAi(res)) return;
  const { ids } = req.body || {};
  const brands = getBrandsByIds(ids);
  if (brands.length === 0) return res.status(400).json({ error: "Marka seçilmedi." });
  const results = [];
  for (const brand of brands) {
    const r = await prioritizeBrand(brand);
    results.push({ id: brand.id, name: brand.name, ...r });
  }
  res.json({ ok: true, results });
});

// Kullanıcının tek tıkla "AI Analiz Et" dediği kombine uç nokta: hem kişiselleştirme
// hem öncelik/etiketleme aynı anda çalışır (tek/toplu marka için).
router.post("/api/brands/ai-analyze", async (req, res) => {
  if (!requireAi(res)) return;
  const { ids } = req.body || {};
  const brands = getBrandsByIds(ids);
  if (brands.length === 0) return res.status(400).json({ error: "Marka seçilmedi." });
  const results = [];
  for (const brand of brands) {
    const [personalize, priority] = await Promise.all([personalizeBrand(brand), prioritizeBrand(brand)]);
    results.push({ id: brand.id, name: brand.name, personalize, priority });
  }
  res.json({ ok: true, results });
});

// --- v57: AI cevap sınıflandırma + otomatik taslak yanıt ---------------------
// Zaten yanıt/gelen mesaj snippet'i olan (reply_snippet dolu) markalar için,
// yanıtı bir kategoriye ayırır (ör. "ilgileniyor", "fiyat soruyor", "reddetti",
// "belge istiyor", "spam/otomatik yanıt") ve kısa bir taslak yanıt üretir.
// Kullanıcı taslağı inceleyip elle gönderir — otomatik gönderim YAPILMAZ.
const REPLY_CATEGORIES = [
  "ilgileniyor",
  "fiyat_soruyor",
  "belge_istiyor",
  "reddetti",
  "daha_fazla_bilgi_istiyor",
  "otomatik_yanit",
  "diger",
];

async function classifyReplyForBrand(brand) {
  if (!brand.reply_snippet) return { error: "Bu markada henüz kaydedilmiş bir yanıt yok." };
  const prompt = `Aşağıda bir toptan satış teklif mailine gelen YANIT bulunuyor. Bunu şu kategorilerden birine ayır: ${REPLY_CATEGORIES.join(
    ", "
  )}. Ardından, satıcı adına (kibar, profesyonel, İngilizce) kısa bir TASLAK yanıt yaz. SADECE şu formatta geçerli JSON döndür:
{"category": "...", "draft_reply": "..."}

Marka: ${brand.name}
Gelen yanıt: """${brand.reply_snippet}"""`;
  const result = await askClaude(prompt, { maxTokens: 350 });
  if (!result) return { error: "AI yapılandırılmamış." };
  if (result.error) return { error: result.error };
  const parsed = extractJson(result.text);
  if (!parsed || !parsed.category) return { error: "AI yanıtı ayrıştırılamadı." };
  const category = REPLY_CATEGORIES.includes(parsed.category) ? parsed.category : "diger";
  const draft = (parsed.draft_reply || "").trim();
  db.prepare(
    "UPDATE brands SET reply_category = ?, ai_draft_reply = ?, ai_draft_reply_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(category, draft, brand.id);
  logEvent(brand.id, "ai_reply_classified", category);
  return { category, draft_reply: draft };
}

router.post("/api/brands/ai-classify-replies", async (req, res) => {
  if (!requireAi(res)) return;
  const { ids } = req.body || {};
  const brands = getBrandsByIds(ids);
  if (brands.length === 0) return res.status(400).json({ error: "Marka seçilmedi." });
  const results = [];
  for (const brand of brands) {
    const r = await classifyReplyForBrand(brand);
    results.push({ id: brand.id, name: brand.name, ...r });
  }
  res.json({ ok: true, results });
});

router.get("/api/ai/status", (req, res) => {
  res.json({ configured: isConfigured() });
});

module.exports = router;
