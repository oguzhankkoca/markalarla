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

// Basit bir prompt gönderip metin yanıtı alır. Model JSON döndürmesi istenen
// promptlarda bile bazen açıklama ekleyebilir; çağıran taraf yanıt içinden
// { ... } bloğunu ayıklayarak parse eder.
async function askClaude(prompt, { maxTokens = 250 } = {}) {
  if (!isConfigured()) return null;
  try {
    const res = await httpClient.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      },
      {
        headers: {
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
      }
    );
    if (res.status !== 200) {
      return { error: `Claude API HTTP ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}` };
    }
    const text = res.data?.content?.[0]?.text || "";
    return { text };
  } catch (e) {
    return { error: e.message };
  }
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

module.exports = { isConfigured, askClaude, extractJson };
