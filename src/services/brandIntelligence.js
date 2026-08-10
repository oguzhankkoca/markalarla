// BRAND INTELLIGENCE + GROWTH AUDIT (v68)
// ============================================================================
// Bu servis SmartScout'un cevaplamadığı soruyu cevaplar: "Bu marka Neofa ile
// çalışır mı, markaya nasıl yaklaşmalıyız?" SmartScout'tan gelen alanlara
// (brand_score, est_monthly_revenue, avg_sellers vb.) HİÇ dokunmaz, onları
// yeniden tahmin etmez — sadece markanın kendi web sitesi ve public
// kaynaklarından (arama motorları) yeni bilgi toplar.
//
// KADEMELİ İŞLEME (madde 23): maliyeti kontrol altında tutmak için 3 seviye:
//   Level 2 (fast screen)  — website + wholesale sayfası var mı, Amazon izni,
//                            temel iletişim — TÜM markalar için uygun, ucuz.
//   Level 3 (deep research)— company/distributor/contact/red flag/skor/strateji
//                            — sadece yüksek potansiyelli markalarda.
//   Level 4 (growth audit) — Amazon listing/görsel denetimi — sadece EN yüksek
//                            potansiyelli markalarda (en pahalı seviye).
//
// NO HALLUCINATION (madde 26): her AI çağrısında prompt AÇIKÇA "kanıt yoksa
// UNKNOWN yaz, tahmin etme" der. JSON şemasının HER alanı UNKNOWN'a izin verir.
// Görsele erişilemediyse "IMAGE_AUDIT_UNAVAILABLE" yazılır.
const axios = require("axios");
const cheerio = require("cheerio");
const db = require("../db");
const ai = require("./ai");
const { computeAccessibilityScore, computeNeofaPriority } = require("./brandAccessibilityScore");
const { logEvent } = require("./events");

const httpClient = axios.create({
  timeout: 10000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  },
  validateStatus: () => true,
});

const DEFAULT_STALE_DAYS = 45; // 30-60 gün aralığının ortası (madde 24), Ayarlar'dan değiştirilebilir

function daysSince(dateStr) {
  if (!dateStr) return Infinity;
  return (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24);
}

// v69: sabit 45 gün yerine Ayarlar'dan okunan, kullanıcının 30-60 gün aralığında
// ayarlayabildiği bir değer (settings.intel_stale_days). Ayar yoksa/geçersizse
// varsayılana düşer — mevcut davranış bozulmaz.
function getStaleDays() {
  try {
    const settings = db.prepare("SELECT intel_stale_days FROM settings WHERE id = 1").get();
    const n = Number(settings && settings.intel_stale_days);
    if (n && n >= 7 && n <= 365) return n;
  } catch (e) {
    // settings tablosu/kolonu yoksa (çok eski bir DB) sessizce varsayılana düş.
  }
  return DEFAULT_STALE_DAYS;
}

function isStale(researchedAt) {
  return daysSince(researchedAt) > getStaleDays();
}

// ---------------------------------------------------------------------------
// brand_intelligence satırını getirir/oluşturur, JSON kolonlarını parse eder.
// ---------------------------------------------------------------------------
function getIntelRow(brandId) {
  let row = db.prepare("SELECT * FROM brand_intelligence WHERE brand_id = ?").get(brandId);
  if (!row) {
    db.prepare("INSERT INTO brand_intelligence (brand_id) VALUES (?)").run(brandId);
    row = db.prepare("SELECT * FROM brand_intelligence WHERE brand_id = ?").get(brandId);
  }
  return row;
}

function parseJsonSafe(str, fallback) {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch (e) {
    return fallback;
  }
}

function getParsedIntel(brandId) {
  const row = getIntelRow(brandId);
  return {
    ...row,
    companyData: parseJsonSafe(row.company_data, {}),
    wholesaleData: parseJsonSafe(row.wholesale_data, {}),
    marketplacePolicy: parseJsonSafe(row.marketplace_policy, {}),
    distributorData: parseJsonSafe(row.distributor_data, {}),
    contacts: parseJsonSafe(row.contacts, []),
    redFlags: parseJsonSafe(row.red_flags, []),
    listingAudit: parseJsonSafe(row.listing_audit, {}),
    imageAudit: parseJsonSafe(row.image_audit, { available: false }),
    topOpportunities: parseJsonSafe(row.top_opportunities, []),
    valueProposition: parseJsonSafe(row.value_proposition, []),
    accessibilityBreakdown: parseJsonSafe(row.accessibility_breakdown, null),
  };
}

// ---------------------------------------------------------------------------
// Basit sayfa metni çekme (emailFinder.js'teki scrapePage ile aynı ruhta ama
// bağımsız — Brand Intelligence'ın kendi hata toleransı/loglama ihtiyacı var).
// ---------------------------------------------------------------------------
async function fetchPageText(url) {
  try {
    const { data, status } = await httpClient.get(url);
    if (status >= 400 || typeof data !== "string") return null;
    const $ = cheerio.load(data);
    return {
      title: $("title").text().trim(),
      text: $("body").text().replace(/\s+/g, " ").trim().slice(0, 4000),
      html: data,
    };
  } catch (e) {
    return null;
  }
}

// Wholesale/dealer/distributor sayfası olası yollar — bulunursa homepage metnine
// ek olarak bu sayfanın içeriği de AI'a verilir (daha isabetli MOQ/terms tespiti).
const WHOLESALE_PATH_GUESSES = [
  "/wholesale", "/wholesale-inquiry", "/pages/wholesale", "/wholesale-program",
  "/dealers", "/become-a-dealer", "/distributors", "/trade", "/b2b",
  "/retailers", "/reseller", "/pages/dealer-application", "/pages/wholesale-application",
];

async function findWholesalePageText(website, existingWholesaleUrl, trace) {
  const candidates = [];
  if (existingWholesaleUrl) candidates.push(existingWholesaleUrl);
  if (website) {
    const base = website.replace(/\/$/, "");
    for (const path of WHOLESALE_PATH_GUESSES) candidates.push(base + path);
  }
  for (const url of candidates.slice(0, 6)) {
    const page = await fetchPageText(url);
    if (page && page.text && page.text.length > 100) {
      trace.push(`Wholesale sayfası bulundu: ${url}`);
      return { url, ...page };
    }
  }
  trace.push("Wholesale/dealer sayfası bulunamadı (denenen yollar arasında).");
  return null;
}

// Hafif, bağımsız arama yardımcı fonksiyonu — emailFinder.js'in domain bulma
// mantığından FARKLI bir amaç için (genel bilgi arama, domain seçimi değil),
// bu yüzden ayrı ve basit tutuldu. Sadece Serper/SerpAPI tanımlıysa çalışır;
// ikisi de yoksa boş döner (sistemin geri kalanını bozmaz).
async function quickSearch(query, trace) {
  try {
    if (process.env.SERPER_API_KEY) {
      const { data, status } = await httpClient.post(
        "https://google.serper.dev/search",
        { q: query },
        { headers: { "X-API-KEY": process.env.SERPER_API_KEY, "Content-Type": "application/json" } }
      );
      if (status === 200 && Array.isArray(data.organic)) {
        return data.organic.slice(0, 5).map((r) => ({ title: r.title, snippet: r.snippet, link: r.link }));
      }
    }
  } catch (e) {
    trace.push(`quickSearch (Serper) hata: ${e.message}`);
  }
  try {
    if (process.env.SERPAPI_KEY) {
      const { data, status } = await httpClient.get("https://serpapi.com/search.json", {
        params: { q: query, api_key: process.env.SERPAPI_KEY, num: 5 },
      });
      if (status === 200 && Array.isArray(data.organic_results)) {
        return data.organic_results.slice(0, 5).map((r) => ({ title: r.title, snippet: r.snippet, link: r.link }));
      }
    }
  } catch (e) {
    trace.push(`quickSearch (SerpAPI) hata: ${e.message}`);
  }
  return [];
}

function formatSearchResults(results) {
  if (!results || results.length === 0) return "(arama sonucu yok)";
  return results.map((r, i) => `${i + 1}. ${r.title || ""} — ${r.snippet || ""} (${r.link || ""})`).join("\n");
}

// ---------------------------------------------------------------------------
// RED FLAG ENGINE — kural bazlı (AI'sız) kısım (madde 13). SmartScout'un KENDİ
// sayısal alanlarından (opportunityScore.js'in de kullandığı ham veri, yeniden
// tahmin YOK) deterministik olarak türetilir; AI'ın page-content'ten bulduğu
// flag'lere (yukarıdaki RED FLAG ENGINE checklist'i) EK olarak birleştirilir,
// onların yerine geçmez. Aynı flag ismiyle tekrar eklenmeyi önlemek çağıran
// tarafın (runLevel2Screen/runLevel3DeepResearch) sorumluluğunda.
// ---------------------------------------------------------------------------
const RED_FLAG_THRESHOLDS = {
  tooManySellers: 15, // avg_sellers bu değerin üzerindeyse
  highMoq: 5000, // moq/opening_order_minimum (sayısal olarak ayrıştırılabiliyorsa) bu değerin üzerindeyse
};

function fieldValueLocal(obj, key) {
  const f = obj && obj[key];
  if (!f) return "UNKNOWN";
  if (typeof f === "object" && "value" in f) return f.value;
  if (typeof f === "object" && "status" in f) return f.status;
  return f;
}
function parseMoneyishLocal(str) {
  if (!str || typeof str !== "string") return null;
  const match = str.replace(/,/g, "").match(/(\d+(\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function deriveRuleBasedRedFlags(brand, wholesaleData) {
  const flags = [];
  if (typeof brand.avg_sellers === "number" && brand.avg_sellers > RED_FLAG_THRESHOLDS.tooManySellers) {
    flags.push({
      flag: "TOO_MANY_SELLERS",
      note: `SmartScout verisine göre bu markada ortalama ${brand.avg_sellers} satıcı var — yüksek rekabet riski.`,
      source: "SmartScout (avg_sellers)",
    });
  }
  if (brand.dominant_seller && /amazon/i.test(String(brand.dominant_seller))) {
    flags.push({
      flag: "DOMINANT_SELLER_AMAZON_RETAIL",
      note: `Baskın satıcı: "${brand.dominant_seller}" — Amazon Retail'in kendisi bu markayı satıyor olabilir, bu da rekabeti zorlaştırır.`,
      source: "SmartScout (dominant_seller)",
    });
  }
  const moq =
    parseMoneyishLocal(wholesaleData && fieldValueLocal(wholesaleData, "moq")) ??
    parseMoneyishLocal(wholesaleData && fieldValueLocal(wholesaleData, "opening_order_minimum"));
  if (moq !== null && moq > RED_FLAG_THRESHOLDS.highMoq) {
    flags.push({
      flag: "VERY_HIGH_MOQ",
      note: `Minimum sipariş miktarı/tutarı çok yüksek görünüyor (~${moq}) — başlangıç için erişilebilirliği düşürür.`,
      source: "wholesale sayfası (moq/opening_order_minimum)",
    });
  }
  if (wholesaleData && String(fieldValueLocal(wholesaleData, "wholesale_program")).toUpperCase() === "NO") {
    flags.push({
      flag: "NO_WHOLESALE_PROGRAM",
      note: "Markanın herkese açık bir toptan satış/dealer programı bulunamadı — distribütör rotası gerekebilir.",
      source: "website taraması",
    });
  }
  return flags;
}

// Aynı "flag" ismiyle birden fazla kayıt varsa tekilleştirir (AI'nın bulduğu +
// kural bazlı olanlar arasında çakışma olabilir).
function mergeRedFlags(...lists) {
  const seen = new Set();
  const merged = [];
  for (const list of lists) {
    for (const f of list || []) {
      if (!f || !f.flag || seen.has(f.flag)) continue;
      seen.add(f.flag);
      merged.push(f);
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// LEVEL 2 — FAST BRAND SCREEN
// Website + wholesale sayfası var mı, Amazon izni, temel iletişim. Tek bir AI
// çağrısı (ucuz Haiku modeli yeterli, hacim yüksek olacağı için).
// ---------------------------------------------------------------------------
async function runLevel2Screen(brand) {
  const trace = [];
  const intel = getParsedIntel(brand.id);

  if (!brand.website) {
    trace.push("Marka için henüz bir website yok (e-mail bulma adımı tamamlanmamış) — Level 2 atlanıyor.");
    db.prepare(
      "UPDATE brand_intelligence SET research_status = 'not_researched', research_error = ?, updated_at = CURRENT_TIMESTAMP WHERE brand_id = ?"
    ).run(trace.join(" | "), brand.id);
    return { ok: false, reason: "no_website", trace };
  }

  const homepage = await fetchPageText(brand.website);
  const wholesalePage = await findWholesalePageText(brand.website, brand.wholesale_page_url, trace);

  if (!ai.isConfigured()) {
    trace.push("ANTHROPIC_API_KEY tanımlı değil — sadece sayfa taraması yapıldı, AI çıkarımı atlandı.");
    db.prepare(
      `UPDATE brand_intelligence SET research_status = 'level2', researched_at = CURRENT_TIMESTAMP,
       last_level2_at = CURRENT_TIMESTAMP, research_error = ?, updated_at = CURRENT_TIMESTAMP WHERE brand_id = ?`
    ).run(trace.join(" | "), brand.id);
    return { ok: false, reason: "ai_not_configured", trace };
  }

  const prompt = `Sen bir Amazon toptan satış/distribütörlük şirketi (Neofa LLC) için marka araştırması yapan bir analistsin.
KURAL: Sadece aşağıda verilen GERÇEK sayfa metnine dayan. Hiçbir zaman tahmin yürütme. Kanıt yoksa "UNKNOWN" yaz.
"source" alanına hangi sayfadan bu bilgiyi çıkardığını (URL) yaz; kanıt yoksa source: null.

MARKA: ${brand.name}
Website: ${brand.website}

ANA SAYFA METNİ (${brand.website}):
"""${(homepage && homepage.text) || "(erişilemedi)"}"""

WHOLESALE/DEALER SAYFASI${wholesalePage ? ` (${wholesalePage.url})` : " (bulunamadı)"}:
"""${(wholesalePage && wholesalePage.text) || "(yok)"}"""

Sadece şu JSON formatında cevap ver, başka açıklama ekleme:
{
  "wholesale_program": {"value": "YES"|"NO"|"UNKNOWN", "source": "url or null"},
  "amazon_allowed": {"status": "ALLOWED"|"UNCLEAR"|"PROHIBITED", "source": "url or null", "note": "kısa kanıt alıntısı or null"},
  "general_email": {"value": "email or UNKNOWN", "source": "url or null"},
  "wholesale_contact": {"value": "email/phone or UNKNOWN", "source": "url or null"},
  "sales_contact": {"value": "email/phone or UNKNOWN", "source": "url or null"},
  "ecommerce_contact": {"value": "email/phone or UNKNOWN", "source": "url or null"},
  "marketplace_contact": {"value": "email/phone or UNKNOWN", "source": "url or null"},
  "phone": {"value": "phone or UNKNOWN", "source": "url or null"},
  "moq": {"value": "sayı/açıklama or UNKNOWN", "source": "url or null"},
  "opening_order_minimum": {"value": "sayı/tutar or UNKNOWN", "source": "url or null"},
  "reorder_minimum": {"value": "sayı/tutar or UNKNOWN", "source": "url or null"},
  "payment_terms": {"value": "ör. Net 30, prepayment or UNKNOWN", "source": "url or null"},
  "wholesale_application_url": {"value": "url or UNKNOWN", "source": "url or null"},
  "dealer_program": {"value": "YES"|"NO"|"UNKNOWN", "source": "url or null"},
  "reseller_program": {"value": "YES"|"NO"|"UNKNOWN", "source": "url or null"},
  "retailer_program": {"value": "YES"|"NO"|"UNKNOWN", "source": "url or null"},
  "online_retailers_allowed": {"value": "YES"|"NO"|"UNKNOWN", "source": "url or null"},
  "third_party_marketplace_allowed": {"value": "YES"|"NO"|"UNKNOWN", "source": "url or null"},
  "marketplace_restrictions": {"value": "kısa açıklama or UNKNOWN", "source": "url or null"},
  "amazon_seller_restrictions": {"value": "kısa açıklama or UNKNOWN", "source": "url or null"},
  "authorized_reseller_requirements": {"value": "kısa açıklama or UNKNOWN", "source": "url or null"},
  "map_policy": {"value": "YES"|"NO"|"UNKNOWN", "source": "url or null"},
  "reseller_policy": {"value": "kısa özet/url or UNKNOWN", "source": "url or null"},
  "dealer_agreement": {"value": "YES"|"NO"|"UNKNOWN", "source": "url or null"},
  "marketplace_agreement": {"value": "YES"|"NO"|"UNKNOWN", "source": "url or null"},
  "red_flags": [{"flag": "kısa etiket", "note": "kısa açıklama", "source": "url"}]
}
Amazon izni için: sayfada "we do not sell on Amazon", "authorized retailers only", "unauthorized sellers will be prosecuted" gibi net bir ifade YOKSA "UNCLEAR" yaz — asla kanıt olmadan "ALLOWED" varsayma.
Yukarıdaki alanların HER BİRİ için: sayfa metninde açıkça geçmiyorsa "UNKNOWN" yaz (YES/NO alanlarında da), asla tahmin etme.

RED FLAG ENGINE — "red_flags" dizisini doldururken AŞAĞIDAKİ listedeki her birini TEK TEK kontrol et,
sayfa metninde gerçekten kanıtı olanları ekle (flag alanına TAM OLARAK bu ismi yaz), kanıtı olmayanı hiç ekleme:
- AMAZON_PROHIBITED: Amazon'da satışın açıkça yasaklandığına dair ifade var mı?
- MARKETPLACE_PROHIBITED: Diğer 3. parti pazaryerlerinde (eBay, Walmart Marketplace vb.) satışın yasaklandığına dair ifade var mı?
- EXCLUSIVE_DISTRIBUTOR_ONLY: Marka SADECE tek bir yetkili distribütör üzerinden mi satılıyor?
- MAP_VIOLATION_RISK: Sıkı bir MAP (Minimum Advertised Price) politikası ve uygulama/ceza dili var mı?
- MARKETPLACE_RESTRICTIONS: Online satışa dair başka açık kısıtlamalar (bölge, kanal vb.) var mı?
- AUTHORIZED_RESELLER_ONLY: Yeniden satıcı olmak için resmi bir onay/sözleşme süreci ZORUNLU mu?
- LOW_BRAND_OPENNESS: Marka yeni ortaklara kapalı/ilgisiz görünüyor mu (başvuru formu yok, "we don't accept new dealers" gibi bir ifade var mı)?`;

  const result = await ai.askClaude(prompt, { maxTokens: 1200 });
  if (!result || result.error) {
    trace.push(`AI çağrısı başarısız: ${result ? result.error : "yapılandırılmamış"}`);
    db.prepare(
      "UPDATE brand_intelligence SET research_error = ?, updated_at = CURRENT_TIMESTAMP WHERE brand_id = ?"
    ).run(trace.join(" | "), brand.id);
    return { ok: false, reason: "ai_error", trace };
  }
  const parsed = ai.extractJson(result.text);
  if (!parsed) {
    trace.push("AI yanıtı JSON olarak ayrıştırılamadı.");
    db.prepare(
      "UPDATE brand_intelligence SET research_error = ?, updated_at = CURRENT_TIMESTAMP WHERE brand_id = ?"
    ).run(trace.join(" | "), brand.id);
    return { ok: false, reason: "parse_error", trace };
  }

  const companyData = {
    ...intel.companyData,
    official_website: { value: brand.website, source: brand.website },
    general_email: parsed.general_email || { value: "UNKNOWN", source: null },
    wholesale_contact: parsed.wholesale_contact || { value: "UNKNOWN", source: null },
    // v69: madde 16 — wholesale dışındaki şirket kanalı kontakları da (varsa)
    // aynı sayfa taramasından yakalanıyor. buildContactList() bunları okur.
    sales_contact: parsed.sales_contact || { value: "UNKNOWN", source: null },
    ecommerce_contact: parsed.ecommerce_contact || { value: "UNKNOWN", source: null },
    marketplace_contact: parsed.marketplace_contact || { value: "UNKNOWN", source: null },
    phone: parsed.phone || { value: "UNKNOWN", source: null },
  };
  // v69: madde 9/10 — Wholesale Research'ün eksik detay alanları (MOQ, açılış/
  // yeniden sipariş minimumu, ödeme koşulları, başvuru portalı, dealer/reseller/
  // retailer program bayrakları). Hepsi UNKNOWN fallback'li — no hallucination.
  const wholesaleData = {
    ...intel.wholesaleData,
    wholesale_program: parsed.wholesale_program || { value: "UNKNOWN", source: null },
    moq: parsed.moq || { value: "UNKNOWN", source: null },
    opening_order_minimum: parsed.opening_order_minimum || { value: "UNKNOWN", source: null },
    reorder_minimum: parsed.reorder_minimum || { value: "UNKNOWN", source: null },
    payment_terms: parsed.payment_terms || { value: "UNKNOWN", source: null },
    wholesale_application_url: parsed.wholesale_application_url || { value: "UNKNOWN", source: null },
    dealer_program: parsed.dealer_program || { value: "UNKNOWN", source: null },
    reseller_program: parsed.reseller_program || { value: "UNKNOWN", source: null },
    retailer_program: parsed.retailer_program || { value: "UNKNOWN", source: null },
  };
  // v69: madde 11 — Marketplace Policy'nin eksik detay alanları (online/3.parti
  // marketplace izinleri, MAP/reseller/dealer/marketplace anlaşmaları, kısıtlar).
  const marketplacePolicy = {
    ...intel.marketplacePolicy,
    amazon_allowed: parsed.amazon_allowed || { status: "UNCLEAR", source: null },
    online_retailers_allowed: parsed.online_retailers_allowed || { value: "UNKNOWN", source: null },
    third_party_marketplace_allowed: parsed.third_party_marketplace_allowed || { value: "UNKNOWN", source: null },
    marketplace_restrictions: parsed.marketplace_restrictions || { value: "UNKNOWN", source: null },
    amazon_seller_restrictions: parsed.amazon_seller_restrictions || { value: "UNKNOWN", source: null },
    authorized_reseller_requirements: parsed.authorized_reseller_requirements || { value: "UNKNOWN", source: null },
    map_policy: parsed.map_policy || { value: "UNKNOWN", source: null },
    reseller_policy: parsed.reseller_policy || { value: "UNKNOWN", source: null },
    dealer_agreement: parsed.dealer_agreement || { value: "UNKNOWN", source: null },
    marketplace_agreement: parsed.marketplace_agreement || { value: "UNKNOWN", source: null },
  };
  // v69: madde 13 — AI'ın page-content'ten bulduğu flag'lere, SmartScout'un
  // KENDİ sayısal alanlarından kural bazlı (AI'sız) türetilen flag'ler ekleniyor.
  const aiRedFlags = Array.isArray(parsed.red_flags) ? parsed.red_flags : [];
  const ruleBasedRedFlags = deriveRuleBasedRedFlags(brand, wholesaleData);
  const redFlags = mergeRedFlags(intel.redFlags, aiRedFlags, ruleBasedRedFlags);

  db.prepare(
    `UPDATE brand_intelligence SET
       company_data = ?, wholesale_data = ?, marketplace_policy = ?, red_flags = ?,
       research_status = 'level2', researched_at = CURRENT_TIMESTAMP, last_level2_at = CURRENT_TIMESTAMP,
       research_version = COALESCE(research_version, 0) + 1, research_error = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE brand_id = ?`
  ).run(
    JSON.stringify(companyData),
    JSON.stringify(wholesaleData),
    JSON.stringify(marketplacePolicy),
    JSON.stringify(redFlags),
    brand.id
  );
  logEvent(brand.id, "intel_level2", `Wholesale: ${wholesaleData.wholesale_program.value}, Amazon: ${marketplacePolicy.amazon_allowed.status}`);
  return { ok: true, trace };
}

// ---------------------------------------------------------------------------
// LEVEL 3 — DEEP BRAND RESEARCH
// Company/distributor/contact/red flag detayları + Brand Accessibility Score +
// Neofa Priority + Outreach Strategy + Next Best Action. Sadece yüksek
// potansiyelli markalarda çağrılmalı (maliyet yüksek: 2-3 arama + 1 büyük AI çağrısı).
// ---------------------------------------------------------------------------
const PITCH_ANGLES = [
  "WHOLESALE_PARTNERSHIP", "AMAZON_GROWTH_PARTNER", "CONTROLLED_AUTHORIZED_RESELLER",
  "LONG_TERM_RETAIL_PARTNER", "DISTRIBUTOR_ROUTE", "PHONE_FIRST", "DO_NOT_CONTACT",
];

async function runLevel3DeepResearch(brand) {
  const trace = [];
  let intel = getParsedIntel(brand.id);

  // Level 2 hiç yapılmadıysa önce onu çalıştır (Level 3, Level 2'nin bulgularının
  // üzerine inşa edilir).
  if (intel.research_status === "not_researched" || !intel.research_status) {
    const l2 = await runLevel2Screen(brand);
    trace.push(...l2.trace);
    if (!l2.ok && l2.reason === "no_website") return { ok: false, reason: "no_website", trace };
    intel = getParsedIntel(brand.id);
  }

  if (!ai.isConfigured()) {
    trace.push("ANTHROPIC_API_KEY tanımlı değil — Level 3 araştırma yapılamıyor.");
    return { ok: false, reason: "ai_not_configured", trace };
  }

  const distributorResults = await quickSearch(`"${brand.name}" authorized distributor USA`, trace);
  const founderResults = await quickSearch(`"${brand.name}" founder OR owner OR CEO company`, trace);
  const linkedinResults = await quickSearch(`"${brand.name}" company linkedin`, trace);

  const contextBlock = `
MARKA: ${brand.name}
Kategori: ${brand.main_category || "bilinmiyor"}
Website: ${brand.website || "UNKNOWN"}
Level 2'den bilinen: wholesale_program=${intel.wholesaleData.wholesale_program ? intel.wholesaleData.wholesale_program.value : "UNKNOWN"}, amazon_allowed=${intel.marketplacePolicy.amazon_allowed ? intel.marketplacePolicy.amazon_allowed.status : "UNCLEAR"}
Tahmini aylık ciro: ${brand.est_monthly_revenue ?? "bilinmiyor"} | Ortalama satıcı sayısı: ${brand.avg_sellers ?? "bilinmiyor"} | Toplam yorum: ${brand.total_reviews ?? "bilinmiyor"}

DISTRIBÜTÖR ARAMA SONUÇLARI ("${brand.name} authorized distributor USA"):
${formatSearchResults(distributorResults)}

KURUCU/ŞİRKET ARAMA SONUÇLARI:
${formatSearchResults(founderResults)}

LINKEDIN ARAMA SONUÇLARI:
${formatSearchResults(linkedinResults)}
`;

  const prompt = `Sen Neofa LLC (Florida merkezli bir Amazon toptan satış/distribütörlük şirketi) için marka
araştırması yapan bir analistsin. Neofa'nın gerçekten sunabileceği şeyler: güvenilir toptan alım/replenishment,
Amazon marketplace varlığı, FBA fulfillment, envanter yönetimi, kontrollü/yetkili reseller ilişkisi, MAP uyumu.
Neofa'nın SAHİP OLMADIĞI ya da doğrulanmamış hiçbir yeteneği (ör. üretim, uluslararası dağıtım) varmış gibi yazma.

KURAL: Sadece verilen arama sonuçlarına/bağlama dayan. Kanıt yoksa UNKNOWN/UNVERIFIED yaz, tahmin etme.
Markayı ASLA aşağılayıcı/agresif bir dille eleştirme — "problem → opportunity" yaklaşımı kullan
(örn. "Your photos are bad" DEĞİL, "There appears to be an opportunity to strengthen product presentation").
${contextBlock}
Sadece şu JSON formatında cevap ver, başka açıklama ekleme:
{
  "company_name": "resmi şirket adı or UNKNOWN",
  "founder_owner": "isim or UNKNOWN",
  "company_size": "varsa halka açık bilgi or UNKNOWN",
  "linkedin": {"value": "url or UNKNOWN", "source": "url or null"},
  "brand_fit_score": <0-100 arası, Neofa'nın toptan satış modeliyle ne kadar uyumlu>,
  "brand_fit_reason": "kısa Türkçe açıklama",
  "brand_openness_score": <0-100 arası, markanın yeni ortaklara ne kadar açık göründüğü>,
  "brand_openness_reason": "kısa Türkçe açıklama",
  "distributors": [{"name": "...", "website": "...", "contact": "... or UNKNOWN", "evidence": "kısa kanıt", "verified": true|false}],
  "direct_wholesale": "YES"|"NO"|"UNKNOWN",
  "distributor_requirement": "YES"|"NO"|"UNKNOWN",
  "additional_red_flags": [{"flag": "kısa etiket", "note": "kısa açıklama", "source": "url or null"}],
  "value_proposition": ["Neofa'nın bu markaya sağlayabileceği somut değer", "..."],
  "pitch_angle": "${PITCH_ANGLES.join('"|"')}",
  "pitch_angle_reason": "kısa Türkçe açıklama",
  "outreach_strategy": "kısa strateji adı (ör. Wholesale First -> Amazon Later)",
  "outreach_strategy_reason": "kısa Türkçe açıklama",
  "next_best_action": "kısa, somut bir sonraki adım (ör. Contact wholesale manager, Submit wholesale application)"
}
Distributor listesi için: markanın kendi sitesinde/basın açıklamasında GEÇEN bir isim yoksa "verified": false ver
ve bunu "UNVERIFIED DISTRIBUTOR" olarak değerlendir — rastgele bir wholesale sitesini ya da Amazon
satıcısını asla "authorized distributor" sayma.
"additional_red_flags" için ayrıca şunu kontrol et: arama sonuçları markanın SADECE tek bir yetkili/münhasır
distribütör üzerinden satıldığını gösteriyor mu? Öyleyse flag: "EXCLUSIVE_DISTRIBUTOR_ONLY" ekle (kanıt yoksa ekleme).`;

  const result = await ai.askClaude(prompt, { maxTokens: 900, model: "claude-sonnet-5" });
  if (!result || result.error) {
    trace.push(`AI çağrısı başarısız: ${result ? result.error : "yapılandırılmamış"}`);
    return { ok: false, reason: "ai_error", trace };
  }
  const parsed = ai.extractJson(result.text);
  if (!parsed) {
    trace.push("AI yanıtı JSON olarak ayrıştırılamadı.");
    return { ok: false, reason: "parse_error", trace };
  }

  const companyData = {
    ...intel.companyData,
    company_name: { value: parsed.company_name || "UNKNOWN" },
    founder_owner: { value: parsed.founder_owner || "UNKNOWN" },
    company_size: { value: parsed.company_size || "UNKNOWN" },
    linkedin: parsed.linkedin || { value: "UNKNOWN", source: null },
    brand_fit_score: typeof parsed.brand_fit_score === "number" ? parsed.brand_fit_score : null,
    brand_fit_reason: parsed.brand_fit_reason || null,
    brand_openness_score: typeof parsed.brand_openness_score === "number" ? parsed.brand_openness_score : null,
    brand_openness_reason: parsed.brand_openness_reason || null,
  };
  const wholesaleData = {
    ...intel.wholesaleData,
    direct_wholesale: { value: parsed.direct_wholesale || "UNKNOWN" },
    distributor_requirement: { value: parsed.distributor_requirement || "UNKNOWN" },
  };
  const distributorData = {
    distributors: Array.isArray(parsed.distributors) ? parsed.distributors : [],
  };
  const newRedFlags = Array.isArray(parsed.additional_red_flags) ? parsed.additional_red_flags : [];
  // v69: madde 13 — bir distribütör iddiası markanın kendi sitesinde/basın
  // açıklamasında doğrulanamadıysa (AI verified:false döndürdüyse) bunu ayrıca
  // bir red flag olarak da işaretle — panelde tek bakışta görünsün.
  const unverifiedDistributorFlags = distributorData.distributors.some((d) => d && d.verified === false)
    ? [
        {
          flag: "UNVERIFIED_DISTRIBUTOR",
          note: "Bulunan distribütör iddiası markanın kendi kaynaklarında doğrulanamadı.",
          source: "AI research (distributor search)",
        },
      ]
    : [];
  // Kural bazlı (AI'sız) flag'ler de Level 3'te tekrar hesaplanıp birleştiriliyor
  // — Level 2'den sonra wholesale_data güncellenmiş olabilir (moq vb.).
  const ruleBasedRedFlags = deriveRuleBasedRedFlags(brand, wholesaleData);
  const mergedRedFlags = mergeRedFlags(intel.redFlags, newRedFlags, unverifiedDistributorFlags, ruleBasedRedFlags);

  // Contact Intelligence (madde 16): mevcut doğrulanmış e-mail'i + level3'te
  // bulunan wholesale_contact'ı unvan önceliğine göre birleştirip sırala.
  const contacts = buildContactList(brand, intel, parsed);

  // Brand Accessibility Score + Neofa Priority hesapla.
  const scoreInput = {
    companyData,
    wholesaleData,
    marketplacePolicy: intel.marketplacePolicy,
    distributorData,
    contacts,
    redFlags: mergedRedFlags,
  };
  const accessibility = computeAccessibilityScore(scoreInput);
  const neofaPriority = computeNeofaPriority(brand.opportunity_score, accessibility.score);
  const actionBadge = computeActionBadge({
    marketplacePolicy: intel.marketplacePolicy,
    wholesaleData,
    redFlags: mergedRedFlags,
    accessibility,
    contacts,
  });

  const pitchAngle = PITCH_ANGLES.includes(parsed.pitch_angle) ? parsed.pitch_angle : "AMAZON_GROWTH_PARTNER";
  const valueProposition = Array.isArray(parsed.value_proposition) ? parsed.value_proposition.slice(0, 5) : [];

  db.prepare(
    `UPDATE brand_intelligence SET
       company_data = ?, wholesale_data = ?, distributor_data = ?, contacts = ?, red_flags = ?,
       value_proposition = ?, pitch_angle = ?, pitch_angle_reason = ?, outreach_strategy = ?,
       outreach_strategy_reason = ?, next_best_action = ?, accessibility_score = ?, accessibility_grade = ?,
       accessibility_breakdown = ?, neofa_priority = ?, action_badge = ?,
       research_status = 'level3', researched_at = CURRENT_TIMESTAMP, last_level3_at = CURRENT_TIMESTAMP,
       research_version = COALESCE(research_version, 0) + 1, research_error = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE brand_id = ?`
  ).run(
    JSON.stringify(companyData),
    JSON.stringify(wholesaleData),
    JSON.stringify(distributorData),
    JSON.stringify(contacts),
    JSON.stringify(mergedRedFlags),
    JSON.stringify(valueProposition),
    pitchAngle,
    parsed.pitch_angle_reason || null,
    parsed.outreach_strategy || null,
    parsed.outreach_strategy_reason || null,
    parsed.next_best_action || null,
    accessibility.score,
    accessibility.grade,
    JSON.stringify(accessibility.breakdown),
    neofaPriority,
    actionBadge,
    brand.id
  );
  logEvent(
    brand.id,
    "intel_level3",
    `Accessibility: ${accessibility.score} (${accessibility.grade}), Neofa Priority: ${neofaPriority}, Strateji: ${pitchAngle}`
  );
  return { ok: true, trace, accessibility, neofaPriority, actionBadge };
}

// Unvan/kanal önceliğine göre kontak sıralama — madde 16'nın TAM 11 kademeli
// sırası: Wholesale Manager > Sales Manager > National Accounts > E-commerce
// Manager > Marketplace Manager > Business Development > Founder/Owner > Sales
// (kişi) > wholesale@ > sales@ > info@. İlk 8 kademe gerçek bir İSİM+UNVANa
// sahip kişiler için (ör. Hunter.io'nun döndürdüğü "position" alanı ya da AI
// research'ün bulduğu founder/owner ismi); son 3 kademe unvanı bilinmeyen ama
// e-mail adresinden anlaşılan genel kutular için.
const CONTACT_TITLE_TIERS = [
  ["wholesale manager"],
  ["sales manager"],
  ["national accounts", "national account manager"],
  ["e-commerce manager", "ecommerce manager"],
  ["marketplace manager"],
  ["business development"],
  ["founder", "owner", "co-founder", "ceo", "president"],
  ["sales"],
];
const CONTACT_EMAIL_TIERS = ["wholesale", "sales", "info"];

function titleTierRank(title) {
  const t = (title || "").toLowerCase();
  if (!t) return null;
  const idx = CONTACT_TITLE_TIERS.findIndex((keywords) => keywords.some((kw) => t.includes(kw)));
  return idx === -1 ? null : idx;
}
function emailTierRank(email) {
  const local = (email || "").split("@")[0].toLowerCase();
  const idx = CONTACT_EMAIL_TIERS.findIndex((kw) => local.includes(kw));
  return idx === -1 ? null : idx;
}
// Geriye dönük uyumluluk için (mevcut çağıranlar varsa) eski isim korunuyor —
// artık hem unvan hem e-mail bazlı 11 kademeyi tek bir skalada birleştiriyor.
function titlePriorityRank(contactOrTitle) {
  const c = typeof contactOrTitle === "string" ? { title: contactOrTitle } : contactOrTitle || {};
  const tRank = titleTierRank(c.title);
  if (tRank !== null) return tRank;
  const eRank = emailTierRank(c.email);
  if (eRank !== null) return CONTACT_TITLE_TIERS.length + eRank;
  return CONTACT_TITLE_TIERS.length + CONTACT_EMAIL_TIERS.length;
}

function confidenceFromHunterScore(score) {
  if (typeof score !== "number") return "unknown";
  if (score >= 80) return "high";
  if (score >= 50) return "medium";
  return "low";
}

// v69: Hunter.io'nun ham kontak listesini (brands.hunter_raw_contacts, bkz.
// emailFinder.js findEmailsViaHunter + routes/brands.js) güvenli şekilde çözer.
// Sütun yoksa/boşsa/bozuksa sessizce boş dizi döner — mevcut e-mail bulma akışını
// hiçbir şekilde etkilemez, sadece EK bir okuma kaynağıdır.
function parseHunterRawContacts(brand) {
  if (!brand || !brand.hunter_raw_contacts) return [];
  try {
    const arr = JSON.parse(brand.hunter_raw_contacts);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

// v69: Şirket içi kanal bazlı kontaklar — madde 16'nın "her kontak Name/Title/
// Email/Phone/Confidence/Source ile" gereğini karşılamak için wholesale_contact'a
// ek olarak sales_contact/ecommerce_contact/marketplace_contact company_data
// alanları da (task #168/#169 ile Level 3 prompt'una eklendiğinde) otomatik
// olarak buradan okunur. Alanlar henüz mevcut değilse (eski/kısmi veri) bu
// fonksiyon o kanalı sessizce atlar — hata vermez.
const COMPANY_CHANNEL_CONTACTS = [
  { field: "wholesale_contact", title: "wholesale" },
  { field: "sales_contact", title: "sales" },
  { field: "ecommerce_contact", title: "e-commerce manager" },
  { field: "marketplace_contact", title: "marketplace manager" },
];

function buildContactList(brand, intel, level3Parsed) {
  const contacts = [];

  // 1) Sistemin zaten doğrulamış olduğu ana e-mail (mevcut email bulma akışı —
  // BURADA HİÇBİR ŞEY DEĞİŞMİYOR, sadece listeye ekleniyor). Eğer bu e-mail
  // Hunter'ın ham kontak listesinde ismi/unvanıyla eşleşiyorsa o bilgi kullanılır.
  const hunterContacts = parseHunterRawContacts(brand);
  if (brand.email) {
    const match = hunterContacts.find((c) => c.value && c.value.toLowerCase() === brand.email.toLowerCase());
    const name = match ? [match.firstName, match.lastName].filter(Boolean).join(" ") || null : null;
    contacts.push({
      name,
      title:
        (match && match.position) ||
        (brand.email.split("@")[0].includes("wholesale")
          ? "wholesale"
          : brand.email.split("@")[0].includes("sales")
          ? "sales"
          : "info"),
      email: brand.email,
      phone: brand.phone || null,
      confidence: brand.confidence || "unknown",
      source: brand.email_source || "existing verified email",
    });
  }

  // 2) Hunter.io'nun döndürdüğü diğer TÜM kişiler (yukarıda seçilen ana e-mail
  // hariç) — unvanlı olanlar (Wholesale Manager, Sales Manager, vb.) önce
  // sıralanabilsin diye buraya ekleniyor. Contact Intelligence (madde 16) gerçek
  // bir isim/unvan bulmayı istiyor; Hunter bunun en zengin kaynağı.
  for (const c of hunterContacts) {
    if (!c.value) continue;
    if (brand.email && c.value.toLowerCase() === brand.email.toLowerCase()) continue; // zaten eklendi
    const name = [c.firstName, c.lastName].filter(Boolean).join(" ") || null;
    contacts.push({
      name,
      title: c.position || c.department || (c.value.split("@")[0].includes("wholesale") ? "wholesale" : c.value.split("@")[0].includes("sales") ? "sales" : "info"),
      email: c.value,
      phone: c.phone || null,
      confidence: confidenceFromHunterScore(c.confidence),
      source: "Hunter.io",
    });
  }

  // 3) Şirket kanalı kontakları (Brand Intelligence research'ünden — wholesale
  // sayfası, iletişim sayfası vb.). Sadece gerçekten bir değer varsa eklenir,
  // "UNKNOWN" ise atlanır (no-hallucination kuralı, madde 32).
  for (const { field, title } of COMPANY_CHANNEL_CONTACTS) {
    const entry = intel.companyData && intel.companyData[field];
    if (!entry || !entry.value || String(entry.value).toUpperCase() === "UNKNOWN") continue;
    const isEmail = /@/.test(entry.value);
    contacts.push({
      name: null,
      title,
      email: isEmail ? entry.value : null,
      phone: isEmail ? null : entry.value,
      confidence: "medium",
      source: entry.source || "website",
    });
  }

  // 4) Kurucu/sahip — AI research'ün bulduğu (varsa) tek isim, e-mail/telefon
  // olmadan sadece bir "kiminle iletişime geçilebilir" ipucu olarak.
  if (level3Parsed && level3Parsed.founder_owner && level3Parsed.founder_owner !== "UNKNOWN") {
    contacts.push({
      name: level3Parsed.founder_owner,
      title: "founder",
      email: null,
      phone: null,
      confidence: "low",
      source: "AI research (founder/owner search)",
    });
  }

  const seen = new Set();
  const deduped = contacts.filter((c) => {
    const key = (c.email || c.name || c.phone || "") + "|" + (c.title || "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  deduped.sort((a, b) => titlePriorityRank(a) - titlePriorityRank(b));
  return deduped;
}

// Panelin en üstünde gösterilen tek-cümlelik aksiyon rozeti (madde 30).
// v69 QA fix #1: Red Flag Engine (madde 13) artık flag isimlerini SERBEST METİN
// yerine SABİT UPPERCASE_SNAKE_CASE (ör. "AMAZON_PROHIBITED",
// "EXCLUSIVE_DISTRIBUTOR_ONLY") olarak üretiyor. Eski regex boşluk bekliyordu
// ("exclusive distributor") — alt çizgili yeni isimlerle HİÇBİR ZAMAN eşleşmiyordu,
// yani DO_NOT_CONTACT'ı tetiklemesi gereken kritik red flag'ler artık badge'e hiç
// yansımıyordu. Regex hem boşluk hem alt çizgiyle eşleşecek şekilde düzeltildi.
// v69 QA fix #2: 5 rozetten biri olan PHONE_FIRST hiç üretilmiyordu — artık
// erişilebilirlik makul ama doğrulanmış bir e-mail yoksa (sadece telefon varsa)
// bu rozet döndürülüyor.
function computeActionBadge({ marketplacePolicy, wholesaleData, redFlags, accessibility, contacts }) {
  const amazonStatus = marketplacePolicy && marketplacePolicy.amazon_allowed ? marketplacePolicy.amazon_allowed.status : "UNCLEAR";
  const wholesaleProgram = wholesaleData && wholesaleData.wholesale_program ? wholesaleData.wholesale_program.value : "UNKNOWN";
  const directWholesale = wholesaleData && wholesaleData.direct_wholesale ? wholesaleData.direct_wholesale.value : "UNKNOWN";
  const hardBlockFlags = (redFlags || []).some((f) =>
    /amazon[_ ]prohibited|exclusive[_ ]distributor|marketplace[_ ]prohibited/i.test(f.flag || "")
  );

  if (amazonStatus === "PROHIBITED" || hardBlockFlags) return "DO_NOT_CONTACT";
  if (directWholesale === "NO" && wholesaleProgram !== "YES") return "DISTRIBUTOR_ROUTE";

  const hasEmail = Array.isArray(contacts) && contacts.some((c) => c && c.email);
  const hasPhone = Array.isArray(contacts) && contacts.some((c) => c && c.phone);
  if (!hasEmail && hasPhone && accessibility && accessibility.score >= 40) return "PHONE_FIRST";

  if (accessibility && accessibility.score >= 65 && amazonStatus !== "PROHIBITED") return "CONTACT_NOW";
  return "RESEARCH_MORE";
}

// ---------------------------------------------------------------------------
// LEVEL 4 — GROWTH AUDIT (Amazon listing + görsel denetimi)
// SADECE en yüksek potansiyelli markalarda çağrılmalı — en pahalı seviye.
// ---------------------------------------------------------------------------
async function runLevel4GrowthAudit(brand) {
  const trace = [];
  let intel = getParsedIntel(brand.id);

  // v69 QA fix (kritik bug): Level 4, Brand Accessibility Score/Neofa Priority/
  // Action Badge/Contacts/Red Flags gibi TÜM karar verilerini Level 3'ün
  // hesapladığı alanlar üzerine kurar (bkz. computeActionBadge, buildContactList
  // çağrıları — Level 4 bunları YENİDEN hesaplamaz). Eskiden Level 4 doğrudan
  // çağrıldığında (ör. "level3'ü önceden yapılmış olmasını VARSAYAR ama ZORUNLU
  // KILMAZ" — kodun kendi eski yorumu) bu alanlar hiç dolmadan research_status
  // sessizce 'level4'e atlıyordu; kullanıcı QA testi tam olarak bunu yakaladı.
  // Artık Level 3 (ve dolayısıyla Level 2) hiç çalıştırılmamışsa önce onlar
  // otomatik çalıştırılıyor — sıralama artık gerçekten ZORUNLU.
  if (intel.research_status === "not_researched" || !intel.research_status || intel.research_status === "level2") {
    const l3 = await runLevel3DeepResearch(brand);
    trace.push(...l3.trace);
    if (!l3.ok && l3.reason === "no_website") return { ok: false, reason: "no_website", trace };
    intel = getParsedIntel(brand.id);
  }

  if (!brand.storefront_url) {
    trace.push("Marka için Amazon storefront/ASIN linki yok — listing audit yapılamıyor.");
    const listingAudit = { available: false, reason: "no_storefront_url" };
    const imageAudit = { available: false, reason: "IMAGE_AUDIT_UNAVAILABLE" };
    db.prepare(
      `UPDATE brand_intelligence SET listing_audit = ?, image_audit = ?, research_status = 'level4',
       last_level4_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE brand_id = ?`
    ).run(JSON.stringify(listingAudit), JSON.stringify(imageAudit), brand.id);
    return { ok: false, reason: "no_storefront_url", trace };
  }

  const page = await fetchPageText(brand.storefront_url);
  if (!page || !page.text || /captcha|robot check|are you a human/i.test(page.html || "")) {
    trace.push("Amazon sayfası erişilemedi/bot korumasına takıldı — listing audit UNKNOWN, uydurulmuyor.");
    const listingAudit = { available: false, reason: "blocked_or_unreachable" };
    const imageAudit = { available: false, reason: "IMAGE_AUDIT_UNAVAILABLE" };
    db.prepare(
      `UPDATE brand_intelligence SET listing_audit = ?, image_audit = ?, research_status = 'level4',
       last_level4_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE brand_id = ?`
    ).run(JSON.stringify(listingAudit), JSON.stringify(imageAudit), brand.id);
    return { ok: false, reason: "blocked", trace };
  }

  // Sayfa gerçekten okunabildiyse (nadir ama mümkün) — en azından metin bazlı
  // içerik tamlığını (A+ / video / brand store varlığı gibi metinsel işaretleri)
  // değerlendirebiliriz. Görsel kalite değerlendirmesi AYRI bir adım (vision).
  let listingAudit = { available: false, reason: "ai_not_configured" };
  if (ai.isConfigured()) {
    // v69: madde 20 — tam granüler Amazon Listing Audit checklist'i (title/
    // bullets/description/keywords/variations, A+/video/Brand Store VARLIĞI +
    // KALİTESİ, review count/rating/temaları). Her alan için kanıt yoksa
    // "UNKNOWN" — asla "bu resim kötü" gibi doğrulanmamış bir iddia uydurulmaz.
    // v69 QA fix (madde 20 hassasiyeti): sayfa "ham metni" cheerio ile $("body").text()
    // olarak çıkarılıyor — bu, GÖRSEL/VİDEO/A+ İÇERİK/Brand Store gibi medya
    // öğelerini YAKALAYAMAZ (bunlar metin değil, ayrı DOM/medya bileşenleridir).
    // Yani "metinde bir işaret yok" durumu ÇOĞU ZAMAN "gerçekten yok" anlamına
    // gelmez, sadece "düz metin çıkarımı bunu göremedi" anlamına gelir. Bu ayrımı
    // AI'a açıkça belirtiyoruz ki "NO" ile "doğrulanamadı" birbirine karışmasın —
    // kullanıcı testi bunu özellikle istiyor: "No A+ Content found" (gerçekten
    // yok) ile "A+ Content could not be verified" (erişim/görme sorunu) FARKLI
    // şeyler, ikisi de aynı "NO" etiketi altına gizlenmemeli.
    const prompt = `Aşağıda bir Amazon ürün/mağaza sayfasının ham metni var. Bu metin sayfanın sadece GÖRÜNÜR
DÜZ METNİDİR (cheerio ile $("body").text() olarak çıkarıldı) — görsel, video, A+ Content modülü, Brand Store
tasarımı gibi medya/DOM öğelerini YAKALAYAMAZ. Bu yüzden ÖNEMLİ bir kural:
- "YES" SADECE metinde bunun varlığına dair AÇIK bir textual işaret varsa (ör. "Watch the video", "From the
  brand", bir Brand Store linkinin görünür metni, "A+ Content" başlığı vb.).
- "NO" SADECE sayfanın standart/minimal bir yapıda olduğuna ve bu öğenin GERÇEKTEN bulunmadığına dair pozitif
  bir kanıt varsa (ör. sayfa çok kısa, başka hiçbir zenginleştirilmiş içerik işareti yok).
- Emin değilsen, ya da düz metin çıkarımının bu öğeyi yakalayıp yakalamadığından şüphen varsa (ÇOĞU ZAMAN
  durum budur), "UNKNOWN" yaz — ASLA "metinde geçmiyor" ile "gerçekten yok"u karıştırıp "NO" yazma.
SADECE bu metinde GERÇEKTEN görebildiğin şeyleri raporla — göremediğin/emin olamadığın her alan için "UNKNOWN"
yaz, tahmin etme. Markayı asla aşağılama, "problem → opportunity" dili kullan (ör. "Ürün açıklaması eksik"
DEĞİL, "Açıklamayı genişletmek için bir fırsat var" gibi).

SAYFA METNİ:
"""${page.text}"""

Sadece şu JSON formatında cevap ver:
{
  "title_quality": "UNKNOWN veya kısa gözlem",
  "title_length_adequate": "YES"|"NO"|"UNKNOWN",
  "bullet_points_quality": "UNKNOWN veya kısa gözlem (tam/eksik/dolu görünüyor mu)",
  "bullet_points_count_mentioned": "sayı or UNKNOWN",
  "description_quality": "UNKNOWN veya kısa gözlem",
  "keywords_optimization": "UNKNOWN veya kısa gözlem (metinde anahtar kelime çeşitliliği görünüyor mu)",
  "variations_present": "YES"|"NO"|"UNKNOWN",
  "a_plus_content_present": "YES"|"NO"|"UNKNOWN",
  "video_present": "YES"|"NO"|"UNKNOWN",
  "brand_store_present": "YES"|"NO"|"UNKNOWN",
  "brand_store_quality": "UNKNOWN veya kısa gözlem (SADECE brand_store_present=YES ise doldur)",
  "review_count_mentioned": "sayı or UNKNOWN",
  "rating_mentioned": "sayı or UNKNOWN",
  "review_themes": ["metinde GEÇEN, gerçek yorum temaları — en fazla 3, kanıt yoksa boş dizi"],
  "mobile_readability": "UNKNOWN veya kısa gözlem",
  "top_opportunities": ["problem->opportunity dilinde en fazla 3 madde, İngilizce"]
}`;
    const result = await ai.askClaude(prompt, { maxTokens: 700 });
    if (result && !result.error) {
      const parsed = ai.extractJson(result.text);
      if (parsed) {
        listingAudit = { available: true, ...parsed, source: brand.storefront_url };
      }
    }
  }

  // Görsel analiz: ana sayfa/storefront metninden bir görsel URL'si (og:image)
  // çıkarmayı dene. Amazon bulut IP'lerini sıklıkla engellediği için bu ÇOĞU
  // ZAMAN başarısız olacaktır — bu beklenen bir durumdur, IMAGE_AUDIT_UNAVAILABLE
  // ile açıkça işaretlenir (asla "kötü görsel" gibi bir iddia UYDURULMAZ).
  let imageAudit = { available: false, reason: "IMAGE_AUDIT_UNAVAILABLE" };
  try {
    const $ = cheerio.load(page.html);
    const ogImage = $('meta[property="og:image"]').attr("content");
    if (ogImage && ai.isConfigured()) {
      const imgResp = await httpClient.get(ogImage, { responseType: "arraybuffer", timeout: 8000 });
      if (imgResp.status === 200 && imgResp.data) {
        const base64 = Buffer.from(imgResp.data).toString("base64");
        const contentType = imgResp.headers["content-type"] || "image/jpeg";
        // v69: madde 21 — Visual AI Analysis tam checklist (görsel hiyerarşisi,
        // rakiplere göre görsel kalite, ambalaj sunumu, görsel üzerindeki metin
        // okunabilirliği vb.). Not: sadece TEK bir ana görsele (og:image) erişim
        // var — "kaç görsel var/lifestyle var mı" gibi çoklu-görsel gerektiren
        // sorular bu yüzden "UNKNOWN (sadece ana görsel erişilebilir)" ile
        // sınırlanıyor, asla görmediğimiz görseller hakkında tahmin YOK.
        const visionResult = await ai.askClaudeVision(
          `Bu bir Amazon ürün ana görseli. SADECE gerçekten gördüğün şeyleri değerlendir. Markayı aşağılama,
"problem->opportunity" dili kullan (ör. "Görsel kalitesiz" DEĞİL, "Görsel kalitesini güçlendirmek için fırsat var").
Not: SADECE bu tek ana görseli görüyorsun — kaç görsel olduğunu, lifestyle/infographic görseli olup olmadığını
BİLEMEZSİN, bu tür sorular için "UNKNOWN (sadece ana görsel erişilebilir)" yaz.

Sadece JSON döndür:
{
  "professional_quality": "kısa gözlem",
  "resolution_clarity": "kısa gözlem",
  "background_cleanliness": "kısa gözlem (arka plan temiz/dağınık mı)",
  "product_visibility": "kısa gözlem (ürün net görünüyor mu, kadraj doğru mu)",
  "packaging_presentation": "kısa gözlem veya UNKNOWN (ambalaj görünüyorsa)",
  "text_readability_on_image": "kısa gözlem veya UNKNOWN (görsel üzerinde metin varsa okunabilir mi)",
  "competitive_visual_quality": "kısa, GENEL bir gözlem (tipik Amazon listing görsel standartlarıyla karşılaştır, spesifik bir rakip ismi UYDURMA)",
  "multi_image_note": "UNKNOWN (sadece ana görsel erişilebilir)",
  "opportunities": ["en fazla 3 madde, İngilizce, opportunity dilinde"]
}`,
          base64,
          contentType
        );
        if (visionResult && !visionResult.error) {
          const parsedVision = ai.extractJson(visionResult.text);
          if (parsedVision) {
            imageAudit = { available: true, source: ogImage, ...parsedVision };
          }
        }
      }
    }
  } catch (e) {
    trace.push(`Görsel analizi başarısız (beklenir, Amazon görsellerine erişim sık engellenir): ${e.message}`);
  }

  // Top 3 Opportunity: listing audit + varsa mevcut değerlerle birleştir, en fazla 3.
  const existingTop = intel.topOpportunities || [];
  const newTop = (listingAudit.top_opportunities || []).concat(imageAudit.opportunities || []);
  const mergedTop = [...new Set([...existingTop, ...newTop])].slice(0, 3);

  db.prepare(
    `UPDATE brand_intelligence SET listing_audit = ?, image_audit = ?, top_opportunities = ?,
     research_status = 'level4', last_level4_at = CURRENT_TIMESTAMP, researched_at = CURRENT_TIMESTAMP,
     research_version = COALESCE(research_version, 0) + 1, updated_at = CURRENT_TIMESTAMP WHERE brand_id = ?`
  ).run(JSON.stringify(listingAudit), JSON.stringify(imageAudit), JSON.stringify(mergedTop), brand.id);
  logEvent(brand.id, "intel_level4", `Listing audit: ${listingAudit.available ? "tamamlandı" : listingAudit.reason}`);
  return { ok: true, trace, listingAudit, imageAudit };
}

module.exports = {
  getParsedIntel,
  isStale,
  runLevel2Screen,
  runLevel3DeepResearch,
  runLevel4GrowthAudit,
  computeActionBadge,
  PITCH_ANGLES,
};
