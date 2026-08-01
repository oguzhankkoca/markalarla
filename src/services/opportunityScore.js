// Opportunity Score (0-100): bir markayla çalışmanın ne kadar "fırsat" olduğunu
// TEK bir sayıda özetleyen, saf matematiksel bir skor. Yapay zeka KULLANMAZ —
// bu yüzden ücretsizdir ve her marka için otomatik/anında hesaplanabilir
// (kullanıcının "AI Analiz Et" ile isteğe bağlı tetiklediği özelliklerden farklı
// olarak, API maliyeti oluşturmadığı için varsayılan olarak her zaman açıktır).
//
// 6 bileşenden oluşur, her biri 0-100 arası normalize edilir, sonra ağırlıklı
// ortalaması alınır:
//   - Brand Score (%30)         — Excel'den gelen genel marka gücü puanı
//   - Tahmini aylık ciro (%20)  — logaritmik ölçek, 500.000$ tavan
//   - Yorum sayısı (%15)        — logaritmik ölçek, 10.000 tavan (talep kanıtı)
//   - Kategori verisi (%10)     — kategorize edilmiş mi (daha iyi değerlendirme imkanı)
//   - Web sitesi güveni (%10)   — arama sonucunun confidence seviyesi
//   - Amazon rekabeti (%15)     — az satıcı = az rekabet = yüksek fırsat
//
// Herhangi bir veri eksikse o bileşen için nötr bir değer kullanılır (markayı
// haksız yere cezalandırmamak için) — Excel'de o sütun hiç yoksa skor yine de
// anlamlı kalır, sadece o bileşenin etkisi azalır.
const WEIGHTS = {
  brandScore: 0.3,
  revenue: 0.2,
  reviews: 0.15,
  category: 0.1,
  website: 0.1,
  competition: 0.15,
};

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function logScale(value, cap) {
  if (!value || value <= 0) return 0;
  const capped = Math.min(value, cap);
  return Math.round((Math.log10(capped + 1) / Math.log10(cap + 1)) * 100);
}

function scoreBrandScore(brand) {
  if (brand.brand_score === null || brand.brand_score === undefined || brand.brand_score === "") return 50;
  return Math.round(clamp(Number(brand.brand_score) || 0, 0, 100));
}

function scoreRevenue(brand) {
  return logScale(Number(brand.est_monthly_revenue) || 0, 500000);
}

function scoreReviews(brand) {
  return logScale(Number(brand.total_reviews) || 0, 10000);
}

function scoreCategory(brand) {
  return brand.main_category && String(brand.main_category).trim() ? 100 : 40;
}

function scoreWebsite(brand) {
  if (!brand.website) return 20; // henüz aranmamış/bulunamamış — çok düşük değil, nötre yakın
  if (brand.confidence === "high") return 100;
  if (brand.confidence === "medium") return 65;
  if (brand.confidence === "low") return 30;
  return 55; // website var ama confidence bilgisi yok
}

function scoreCompetition(brand) {
  const sellers = brand.avg_sellers ?? brand.avg_fba_sellers;
  if (sellers === null || sellers === undefined || sellers === "") return 60;
  const n = Number(sellers);
  if (n <= 1) return 100;
  if (n >= 20) return 10;
  return Math.round(100 - ((n - 1) / 19) * 90);
}

// { score, breakdown } döner — breakdown, her bileşenin ham puanını ve
// ağırlığını içerir (panelde "neden bu puan?" diye gösterebilmek için).
function computeOpportunityScore(brand) {
  const parts = {
    brandScore: scoreBrandScore(brand),
    revenue: scoreRevenue(brand),
    reviews: scoreReviews(brand),
    category: scoreCategory(brand),
    website: scoreWebsite(brand),
    competition: scoreCompetition(brand),
  };
  let total = 0;
  for (const key of Object.keys(WEIGHTS)) {
    total += parts[key] * WEIGHTS[key];
  }
  const score = Math.round(clamp(total, 0, 100));
  return { score, breakdown: { parts, weights: WEIGHTS } };
}

module.exports = { computeOpportunityScore, WEIGHTS };
