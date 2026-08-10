const axios = require("axios");

// Opsiyonel yapay zeka doğrulama katmanı (Anthropic Claude API). Tanımlı değilse
// (ANTHROPIC_API_KEY yoksa) sistemin geri kalanı eskisi gibi, sadece heuristik
// (kelime eşleştirme) kurallarla çalışmaya devam eder — hiçbir şey bozulmaz.
//
// Not: Bu, claude.ai/Claude uygulaması aboneliğinden FARKLI bir şeydir. Buraya
// https://console.anthropic.com adresinden alınan bir API anahtarı gerekir (ayrı
// faturalandırılır, kullandıkça öder mantığıyla çalışır). Haiku modeli hızlı ve
// ucuzdur; bu sistemde sadece heuristiğin emin olamadığı belirsiz durumlarda
// çağrıldığı için toplam kullanım düşük kalır.
function isConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const httpClient = axios.create({
  timeout: 20000,
  validateStatus: () => true,
});

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// v69 QA fix: eskiden bir API timeout/geçici ağ hatası/429/5xx olduğunda tek
// seferde pes edilip hata döndürülüyordu (crash etmiyordu ama gereksiz yere
// "araştırılamadı" işaretleniyordu). Şimdi GEÇİCİ olduğu bilinen hata sınıfları
// (ağ hatası/timeout, 429 rate limit, 500/502/503/504) için kısa bir bekleme
// sonrası TEK bir yeniden deneme yapılıyor — kalıcı hatalarda (401/400 gibi,
// tekrar denemenin bir anlamı olmayan durumlar) hemen pes ediliyor. Yine de
// başarısız olursa öncekiyle AYNI şekilde net bir hata döndürülüyor — asla
// sessizce bir sonuç UYDURULMUYOR.
function isRetryableStatus(status) {
  return status === 429 || (status >= 500 && status < 600);
}

async function postWithRetry(url, body, headers) {
  let lastResult;
  for (let attempt = 0; attempt <= 1; attempt++) {
    try {
      const res = await httpClient.post(url, body, { headers });
      if (res.status === 200) return { ok: true, res };
      lastResult = { ok: false, error: `HTTP ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}` };
      if (!isRetryableStatus(res.status)) return lastResult;
    } catch (e) {
      lastResult = { ok: false, error: e.message };
      // axios ağ/timeout hatalarında response yok — bunlar her zaman geçici kabul
      // edilip yeniden denenir.
    }
    if (attempt === 0) await sleep(800);
  }
  return lastResult;
}

// Basit bir prompt gönderip metin yanıtı alır. Model JSON döndürmesi istenen
// promptlarda bile bazen açıklama ekleyebilir; çağıran taraf yanıt içinden
// { ... } bloğunu ayıklayarak parse eder.
//
// model parametresi: varsayılan olarak ucuz/hızlı Haiku kullanılır (yanıt sınıflandırma
// gibi düşük riskli çağrılar için yeterli). Yanlış kararın maliyetli olduğu kritik
// doğrulama çağrıları (örn. hangi domain'in markaya ait olduğuna karar vermek) çağıran
// taraftan model: "claude-sonnet-5" geçerek daha güçlü modeli kullanabilir — hacim düşük
// olduğu için ek maliyet ihmal edilebilir düzeydedir.
async function askClaude(prompt, { maxTokens = 250, model } = {}) {
  if (!isConfigured()) return null;
  const result = await postWithRetry(
    "https://api.anthropic.com/v1/messages",
    {
      model: model || process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    },
    {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    }
  );
  if (!result.ok) return { error: `Claude API ${result.error}` };
  const text = result.res.data?.content?.[0]?.text || "";
  return { text };
}

// Model yanıtının içinden ilk { ... } JSON bloğunu güvenli şekilde çıkarır.
function extractJson(text) {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (e) {
    return null;
  }
}

// v68 Brand Intelligence — vision (görsel) analizi için askClaude'un kardeşi.
// Claude'un multimodal mesaj formatını kullanır (content dizisinde hem image hem
// text bloğu). Sadece VISUAL AI ANALYSIS (madde 11) için kullanılır; görsele
// erişilemediğinde bu fonksiyon hiç çağrılmaz, çağıran taraf "IMAGE AUDIT
// UNAVAILABLE" ile devam eder — burada bir hata olursa da aynı şekilde ele alınır.
async function askClaudeVision(prompt, base64Image, mediaType = "image/jpeg", { maxTokens = 400, model } = {}) {
  if (!isConfigured()) return null;
  const result = await postWithRetry(
    "https://api.anthropic.com/v1/messages",
    {
      model: model || process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
      max_tokens: maxTokens,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64Image } },
            { type: "text", text: prompt },
          ],
        },
      ],
    },
    {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    }
  );
  if (!result.ok) return { error: `Claude Vision API ${result.error}` };
  const text = result.res.data?.content?.[0]?.text || "";
  return { text };
}

module.exports = { isConfigured, askClaude, askClaudeVision, extractJson };
