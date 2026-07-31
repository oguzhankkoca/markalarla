const axios = require("axios");

// Panelin sağ üstünde her API için kalan kredi/kota gösterebilmek için bu servis
// var. Ama dürüst olmak gerekirse: bunu HER sağlayıcı için API üzerinden okumak
// mümkün değil.
// - SerpAPI: https://serpapi.com/account.json ücretsiz ve resmi bir "hesap" uç
//   noktası sağlıyor, kalan arama sayısını doğru şekilde okuyabiliyoruz.
// - Hunter.io: https://api.hunter.io/v2/account ile aynı şekilde gerçek rakamı
//   okuyabiliyoruz.
// - Serper.dev: resmi API'sinde kalan krediyi döndüren bir uç nokta YOK (sadece
//   kendi dashboard'larında gösteriliyor). Burada olmayan bir sayıyı uydurmak
//   yerine bunu kullanıcıya açıkça belirtiyoruz.
// - Anthropic (Claude) API: normal bir API anahtarıyla bakiye/kredi sorgulayan
//   herkese açık bir uç nokta yok (sadece console.anthropic.com üzerinden manuel
//   kontrol edilebiliyor). Aynı şekilde açıkça belirtiyoruz.
const httpClient = axios.create({ timeout: 8000, validateStatus: () => true });

// Bu uç noktalar ücretsiz/hızlı olsa da, panel her açıldığında/yenilendiğinde
// arka arkaya çağırmamak için kısa bir süre önbellekte tutuyoruz.
let cache = { data: null, expiresAt: 0 };
const CACHE_MS = 60 * 1000;

async function fetchSerpApiInfo() {
  if (!process.env.SERPAPI_KEY) return { configured: false };
  try {
    const { data, status } = await httpClient.get("https://serpapi.com/account.json", {
      params: { api_key: process.env.SERPAPI_KEY },
    });
    if (status !== 200) {
      return { configured: true, ok: false, error: `HTTP ${status}` };
    }
    if (data.error) {
      return { configured: true, ok: false, error: String(data.error) };
    }
    // Hesap tipine göre plana bağlı ("plan_searches_left") ya da kredi bazlı
    // ("total_searches_left") alanlardan hangisi varsa onu kullan.
    const remaining =
      data.plan_searches_left !== undefined ? data.plan_searches_left : data.total_searches_left;
    return {
      configured: true,
      ok: true,
      remaining: remaining !== undefined ? remaining : null,
      planLimit: data.searches_per_month ?? null,
      usedThisMonth: data.this_month_usage ?? null,
    };
  } catch (e) {
    return { configured: true, ok: false, error: e.message };
  }
}

async function fetchHunterInfo() {
  if (!process.env.HUNTER_API_KEY) return { configured: false };
  try {
    const { data, status } = await httpClient.get("https://api.hunter.io/v2/account", {
      params: { api_key: process.env.HUNTER_API_KEY },
    });
    if (status !== 200) {
      return { configured: true, ok: false, error: `HTTP ${status}` };
    }
    const d = data.data || {};
    // Hunter API'sinin farklı sürümlerinde bu alan "requests.searches" ya da
    // "calls" olarak dönebiliyor — ikisini de destekliyoruz.
    const searches = d.requests && d.requests.searches;
    const calls = d.calls;
    let available = null;
    let used = null;
    if (searches) {
      available = searches.available;
      used = searches.used;
    } else if (calls) {
      available = calls.available;
      used = calls.used;
    }
    return {
      configured: true,
      ok: true,
      available,
      used,
      resetDate: d.reset_date || null,
    };
  } catch (e) {
    return { configured: true, ok: false, error: e.message };
  }
}

async function getCreditsStatus() {
  if (cache.data && Date.now() < cache.expiresAt) return cache.data;

  const [serpapi, hunter] = await Promise.all([fetchSerpApiInfo(), fetchHunterInfo()]);

  const result = {
    serpapi,
    hunter,
    // Serper.dev ve Anthropic'in kalan kredi/bakiye döndüren resmi bir API'si yok —
    // frontend bunu ayrı bir "not desteklenmiyor" mesajıyla gösterir.
    serper: {
      configured: Boolean(process.env.SERPER_API_KEY),
      apiSupportsBalance: false,
    },
    anthropic: {
      configured: Boolean(process.env.ANTHROPIC_API_KEY),
      apiSupportsBalance: false,
    },
    checkedAt: new Date().toISOString(),
  };

  cache = { data: result, expiresAt: Date.now() + CACHE_MS };
  return result;
}

module.exports = { getCreditsStatus };
