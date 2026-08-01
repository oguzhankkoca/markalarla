// Opportunity Score saf bir matematiksel fonksiyon (AI/DB/ağ kullanmaz), bu
// yüzden gerçek üretim kodunu doğrudan çağırıp deterministik sonuçları
// doğrulayabiliyoruz — mock/sahte veri gerekmiyor.
const { check, summaryAndExit } = require("./_helpers");
const { computeOpportunityScore } = require("../src/services/opportunityScore");

console.log("opportunityScore.test.js — Opportunity Score hesaplama");

async function run() {
  await check("güçlü bir marka (yüksek her şey) 70+ puan almalı", () => {
    const { score } = computeOpportunityScore({
      brand_score: 90,
      est_monthly_revenue: 200000,
      total_reviews: 5000,
      main_category: "Kitchen",
      website: "https://example.com",
      confidence: "high",
      avg_sellers: 2,
    });
    if (score < 70) throw new Error(`Beklenen >=70, gelen: ${score}`);
  });

  await check("zayıf/çok rekabetçi bir marka 40'ın altında puan almalı", () => {
    const { score } = computeOpportunityScore({
      brand_score: 15,
      est_monthly_revenue: 200,
      total_reviews: 3,
      main_category: "",
      website: "https://example.com",
      confidence: "low",
      avg_sellers: 40,
    });
    if (score >= 40) throw new Error(`Beklenen <40, gelen: ${score}`);
  });

  await check("hiç veri yoksa hata fırlatmadan nötr bir puan üretmeli (0-100 arası)", () => {
    const { score } = computeOpportunityScore({
      brand_score: null,
      est_monthly_revenue: null,
      total_reviews: null,
      main_category: null,
      website: null,
      confidence: null,
      avg_sellers: null,
    });
    if (score < 0 || score > 100 || Number.isNaN(score)) {
      throw new Error(`Skor 0-100 aralığında olmalı, gelen: ${score}`);
    }
  });

  await check("skor her zaman 0-100 aralığında kalmalı (aşırı uç değerlerde bile)", () => {
    const { score } = computeOpportunityScore({
      brand_score: 999,
      est_monthly_revenue: 999999999,
      total_reviews: 999999999,
      main_category: "X",
      website: "https://example.com",
      confidence: "high",
      avg_sellers: 0,
    });
    if (score < 0 || score > 100) throw new Error(`Skor sınır dışına çıktı: ${score}`);
  });

  await check("daha fazla satıcı (rekabet) her şey eşitken skoru düşürmeli", () => {
    const base = {
      brand_score: 60,
      est_monthly_revenue: 10000,
      total_reviews: 500,
      main_category: "Home",
      website: "https://example.com",
      confidence: "medium",
    };
    const lowCompetition = computeOpportunityScore({ ...base, avg_sellers: 1 }).score;
    const highCompetition = computeOpportunityScore({ ...base, avg_sellers: 30 }).score;
    if (lowCompetition <= highCompetition) {
      throw new Error(`Az rekabetli (${lowCompetition}) yüksek rekabetliden (${highCompetition}) büyük olmalıydı`);
    }
  });

  await check("breakdown, ağırlıkların toplamının 1 olduğunu doğrular", () => {
    const { breakdown } = computeOpportunityScore({ brand_score: 50 });
    const total = Object.values(breakdown.weights).reduce((a, b) => a + b, 0);
    if (Math.abs(total - 1) > 0.001) throw new Error(`Ağırlık toplamı 1 olmalı, gelen: ${total}`);
  });

  summaryAndExit();
}

run();
