// mailer.js'nin DB'ye (better-sqlite3) bağımlı OLMAYAN saf mantık parçaları —
// ayrı bir dosyada tutulmasının tek sebebi test edilebilirlik: bu dosya hiçbir
// şey require etmediği için testler gerçek bir veritabanı olmadan da çalışır.

// v59: hesapları bugünkü gönderim sayısı ARTAN sırada dizer (en az gönderen en başta).
function sortAccountsByLeastSent(accounts, countMap) {
  return [...accounts].sort(
    (a, b) => (countMap.get(a.email) || 0) - (countMap.get(b.email) || 0)
  );
}

// v58: A/B test — verilen varyant listesinden rastgele birini seçer; liste boşsa/
// geçersizse fallback'i (mevcut tek şablon) döndürür — davranış hiç değişmez.
function pickVariant(variants, fallback) {
  if (Array.isArray(variants) && variants.length > 0) {
    return variants[Math.floor(Math.random() * variants.length)];
  }
  return fallback;
}

function safeParseArray(json) {
  try {
    const parsed = JSON.parse(json || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

// PUBLIC_URL / RENDER_EXTERNAL_URL tanımlı değilse boş string döner (piksel eklenmez).
function resolvePublicBaseUrl(env) {
  return (env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || "").replace(/\/$/, "");
}

module.exports = { sortAccountsByLeastSent, pickVariant, safeParseArray, resolvePublicBaseUrl };
