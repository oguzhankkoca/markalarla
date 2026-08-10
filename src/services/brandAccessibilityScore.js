// Brand Accessibility Score (v68): "Bu marka Amazon'da iyi bir fırsat mı?" sorusunu
// cevaplayan SmartScout Opportunity Score'dan TAMAMEN AYRI bir skor — bu skor
// "Bu marka Neofa ile çalışır mı, ona ne kadar ERİŞİLEBİLİR/ULAŞILABİLİR" sorusunu
// cevaplar. Girdileri opportunityScore.js gibi Excel'den değil, brand_intelligence
// tablosundaki AI/web araştırması sonuçlarından gelir.
//
// 9 bileşen, toplam 100 puan:
//   Wholesale Accessibility        — 20
//   Amazon/Marketplace Permission  — 20
//   Contactability                 — 15
//   Direct Brand Accessibility     — 10
//   Distributor Accessibility      — 10
//   Brand Fit                      — 10
//   MOQ / Financial Accessibility  —  5
//   Brand Openness                 —  5
//   Red Flag Risk                  —  5
//
// Bilgi UNKNOWN ise (araştırma o alanı doğrulayamadıysa) markayı haksız yere
// cezalandırmamak için NÖTR bir puan (50 civarı) verilir — tıpkı opportunityScore.js'in
// eksik veri için yaptığı gibi. Sonuç 85-100 A+, 75-84 A, 65-74 B, 50-64 C, 0-49 D.
const WEIGHTS = {
  wholesale: 20,
  marketplace: 20,
  contactability: 15,
  directBrand: 10,
  distributor: 10,
  brandFit: 10,
  moqFinancial: 5,
  brandOpenness: 5,
  redFlagRisk: 5,
};
const TOTAL_WEIGHT = Object.values(WEIGHTS).reduce((a, b) => a + b, 0); // 100

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, Number(n) || 0));
}

function fieldValue(obj, key) {
  const f = obj && obj[key];
  if (!f) return "UNKNOWN";
  if (typeof f === "object" && "value" in f) return f.value;
  if (typeof f === "object" && "status" in f) return f.status;
  return f;
}

// v69 QA fix (madde 30/"SCORE TESTİ"): kullanıcı her puanın NEDENİNİ görebilmeli
// ("Wholesale Accessibility: 17/20 — Reason: Official wholesale application
// found." gibi). Eskiden bu fonksiyonlar sadece çıplak bir 0-100 sayısı
// döndürüyordu, panelde "72/100 (ağırlık: 20)" gibi anlamsız bir satır
// oluşuyordu. Artık her biri {score, reason} döndürüyor — reason her zaman
// insan tarafından okunabilir, kanıta dayalı (ya da "veri yok, nötr puan
// verildi" gibi dürüst) bir Türkçe cümle.

// --- Wholesale Accessibility (0-100) ---------------------------------------
function scoreWholesale(wholesaleData) {
  if (!wholesaleData) return { score: 40, reason: "Henüz wholesale araştırması yapılmadı — nötr puan verildi." };
  const program = String(fieldValue(wholesaleData, "wholesale_program")).toUpperCase();
  if (program === "YES") {
    return { score: 100, reason: "Markanın herkese açık bir wholesale programı bulundu." };
  }
  if (program === "NO") {
    // Direkt wholesale yoksa ama dealer/reseller/retailer programlarından biri
    // varsa yine de bir erişim yolu var demektir — tamamen sıfırlamıyoruz.
    const altKey = ["dealer_program", "reseller_program", "retailer_program"].find(
      (k) => String(fieldValue(wholesaleData, k)).toUpperCase() === "YES"
    );
    if (altKey) {
      return { score: 55, reason: `Doğrudan wholesale programı yok, ancak bir ${altKey.replace("_program", "")} programı bulundu.` };
    }
    return { score: 15, reason: "Markanın herkese açık bir wholesale/dealer/reseller programı bulunamadı." };
  }
  return { score: 40, reason: "Wholesale programı olup olmadığı sayfa içeriğinden anlaşılamadı (UNKNOWN) — nötr puan verildi." };
}

// --- Amazon/Marketplace Permission (0-100) ----------------------------------
function scoreMarketplace(marketplacePolicy) {
  if (!marketplacePolicy) return { score: 50, reason: "Marketplace policy henüz araştırılmadı — nötr puan verildi." };
  const status = String(fieldValue(marketplacePolicy, "amazon_allowed")).toUpperCase();
  if (status === "ALLOWED") {
    return { score: 100, reason: "Markanın sitesinde Amazon'da satışa izin verildiğine dair açık bir ifade bulundu." };
  }
  if (status === "PROHIBITED") {
    return { score: 0, reason: "Markanın sitesinde Amazon'da satışın yasaklandığına dair açık bir ifade bulundu." };
  }
  return {
    score: 50,
    reason: "Amazon izni sayfa içeriğinde açıkça ele alınmamış (UNCLEAR) — kanıt olmadan ALLOWED varsayılmadı, nötr puan verildi.",
  };
}

// --- Contactability (0-100) -------------------------------------------------
function scoreContactability(companyData, contacts) {
  const keys = ["wholesale_contact", "sales_contact", "ecommerce_contact", "marketplace_contact", "general_email", "phone", "linkedin"];
  const foundChannels = keys.filter((k) => companyData && String(fieldValue(companyData, k)).toUpperCase() !== "UNKNOWN");
  const contactCount = Array.isArray(contacts) ? contacts.length : 0;
  const score = Math.min(100, foundChannels.length * 15 + contactCount * 10);
  let reason;
  if (contactCount > 0 && foundChannels.length > 0) {
    reason = `${contactCount} kontak kişi/kanalı ve ${foundChannels.length} doğrulanmış iletişim kanalı (${foundChannels.join(", ")}) bulundu.`;
  } else if (contactCount > 0) {
    reason = `${contactCount} kontak bulundu, ancak ek doğrulanmış iletişim kanalı (genel e-mail/telefon/LinkedIn) bulunamadı.`;
  } else if (foundChannels.length > 0) {
    reason = `${foundChannels.length} doğrulanmış iletişim kanalı (${foundChannels.join(", ")}) bulundu, ancak belirli bir kişi/unvan tespit edilemedi.`;
  } else {
    reason = "Hiçbir doğrulanmış iletişim kanalı ya da kontak kişisi bulunamadı.";
  }
  return { score, reason };
}

// --- Direct Brand Accessibility (0-100) -------------------------------------
function scoreDirectBrand(wholesaleData) {
  if (!wholesaleData) return { score: 50, reason: "Henüz araştırılmadı — nötr puan verildi." };
  const direct = String(fieldValue(wholesaleData, "direct_wholesale")).toUpperCase();
  if (direct === "YES") return { score: 100, reason: "Marka ile doğrudan (aracısız) toptan çalışılabildiğine dair kanıt bulundu." };
  if (direct === "NO") return { score: 30, reason: "Marka ile doğrudan toptan çalışılamadığına dair kanıt bulundu (distribütör gerekebilir)." };
  return { score: 50, reason: "Doğrudan wholesale imkanı sayfa/arama sonuçlarından anlaşılamadı (UNKNOWN) — nötr puan verildi." };
}

// --- Distributor Accessibility (0-100) --------------------------------------
function scoreDistributor(distributorData) {
  if (!distributorData || !Array.isArray(distributorData.distributors) || distributorData.distributors.length === 0) {
    return { score: 40, reason: "Herhangi bir distribütör bulunamadı/araştırılmadı — nötr puan verildi." };
  }
  const verifiedCount = distributorData.distributors.filter((d) => d && d.verified).length;
  if (verifiedCount > 0) {
    return {
      score: 90,
      reason: `${verifiedCount} distribütör markanın kendi kaynaklarında (site/basın açıklaması) doğrulandı.`,
    };
  }
  return {
    score: 30,
    reason: `${distributorData.distributors.length} distribütör iddiası bulundu ama hiçbiri markanın kendi kaynaklarında doğrulanamadı (UNVERIFIED DISTRIBUTOR).`,
  };
}

// --- Brand Fit (0-100) -------------------------------------------------------
// AI'ın "bu marka Neofa'nın toptan satış/distribütörlük profiline ne kadar
// uyuyor" değerlendirmesi (bkz. brandIntelligence.js) — bir GERÇEK değil, AI'ın
// holistik bir yargısı olduğu için panelde "AI değerlendirmesi" olarak etiketlenir.
function scoreBrandFit(companyData) {
  const fit = companyData && companyData.brand_fit_score;
  const fitReason = companyData && companyData.brand_fit_reason;
  if (typeof fit === "number") {
    return { score: clamp(fit, 0, 100), reason: fitReason || "AI değerlendirmesi (gerekçe sağlanmadı)." };
  }
  return { score: 50, reason: "Brand fit henüz AI tarafından değerlendirilmedi (Level 3 çalıştır) — nötr puan verildi." };
}

// --- MOQ / Financial Accessibility (0-100) ----------------------------------
function parseMoneyish(str) {
  if (!str || typeof str !== "string") return null;
  const match = str.replace(/,/g, "").match(/(\d+(\.\d+)?)/);
  return match ? Number(match[1]) : null;
}
function scoreMoqFinancial(wholesaleData) {
  if (!wholesaleData) return { score: 50, reason: "MOQ/açılış siparişi bilgisi yok — nötr puan verildi." };
  const moqRaw = fieldValue(wholesaleData, "moq");
  const openingRaw = fieldValue(wholesaleData, "opening_order_minimum");
  const moq = parseMoneyish(moqRaw) ?? parseMoneyish(openingRaw);
  const usedField = parseMoneyish(moqRaw) !== null ? "MOQ" : "açılış siparişi minimumu";
  if (moq === null) {
    return { score: 50, reason: "MOQ ve açılış siparişi minimumu sayfa içeriğinde bulunamadı (UNKNOWN) — nötr puan verildi." };
  }
  if (moq <= 250) return { score: 100, reason: `${usedField} çok düşük (~${moq}) — finansal erişilebilirlik yüksek.` };
  if (moq <= 1000) return { score: 80, reason: `${usedField} makul seviyede (~${moq}).` };
  if (moq <= 3000) return { score: 55, reason: `${usedField} orta-yüksek seviyede (~${moq}).` };
  if (moq <= 10000) return { score: 25, reason: `${usedField} yüksek (~${moq}) — başlangıç için erişilebilirliği düşürüyor.` };
  return { score: 5, reason: `${usedField} çok yüksek (~${moq}) — ciddi bir finansal engel.` };
}

// --- Brand Openness (0-100) --------------------------------------------------
// AI'ın "bu marka yeni toptan satış ortaklarına ne kadar açık görünüyor" (halka
// açık başvuru formu var mı, iletişime geçmeyi teşvik ediyor mu vb.) yargısı.
function scoreBrandOpenness(companyData) {
  const openness = companyData && companyData.brand_openness_score;
  const opennessReason = companyData && companyData.brand_openness_reason;
  if (typeof openness === "number") {
    return { score: clamp(openness, 0, 100), reason: opennessReason || "AI değerlendirmesi (gerekçe sağlanmadı)." };
  }
  return { score: 50, reason: "Brand openness henüz AI tarafından değerlendirilmedi (Level 3 çalıştır) — nötr puan verildi." };
}

// --- Red Flag Risk (0-100, yüksek = az risk) --------------------------------
function scoreRedFlagRisk(redFlags) {
  const count = Array.isArray(redFlags) ? redFlags.length : 0;
  const score = clamp(100 - count * 20, 0, 100);
  if (count === 0) return { score, reason: "Tespit edilen bir red flag yok." };
  const names = redFlags.slice(0, 3).map((f) => f.flag).join(", ");
  return { score, reason: `${count} red flag tespit edildi: ${names}${count > 3 ? ", ..." : ""}.` };
}

function gradeFromScore(score) {
  if (score >= 85) return "A+";
  if (score >= 75) return "A";
  if (score >= 65) return "B";
  if (score >= 50) return "C";
  return "D";
}

const COMPONENT_LABELS = {
  wholesale: "Wholesale Accessibility",
  marketplace: "Amazon/Marketplace Permission",
  contactability: "Contactability",
  directBrand: "Direct Brand Accessibility",
  distributor: "Distributor Accessibility",
  brandFit: "Brand Fit",
  moqFinancial: "MOQ / Financial Accessibility",
  brandOpenness: "Brand Openness",
  redFlagRisk: "Red Flag Risk",
};

// intel: satırın brand_intelligence kaydı (JSON alanları ZATEN parse edilmiş
// objeler olarak beklenir — çağıran taraf JSON.parse yapar).
function computeAccessibilityScore(intel) {
  const raw = {
    wholesale: scoreWholesale(intel.wholesaleData),
    marketplace: scoreMarketplace(intel.marketplacePolicy),
    contactability: scoreContactability(intel.companyData, intel.contacts),
    directBrand: scoreDirectBrand(intel.wholesaleData),
    distributor: scoreDistributor(intel.distributorData),
    brandFit: scoreBrandFit(intel.companyData),
    moqFinancial: scoreMoqFinancial(intel.wholesaleData),
    brandOpenness: scoreBrandOpenness(intel.companyData),
    redFlagRisk: scoreRedFlagRisk(intel.redFlags),
  };
  // v69 QA fix: her bileşen artık {score (0-100), reason} döndürüyor. Panelde
  // ve raporlarda "Wholesale Accessibility: 17/20 — Reason: ..." gibi
  // gösterilebilmesi için ağırlıklı puanı (pointsEarned) da burada hesaplıyoruz.
  const parts = {};
  let total = 0;
  for (const key of Object.keys(WEIGHTS)) {
    const { score: componentScore, reason } = raw[key];
    const weight = WEIGHTS[key];
    const pointsEarned = Math.round((componentScore / 100) * weight * 10) / 10;
    parts[key] = {
      label: COMPONENT_LABELS[key],
      score: componentScore,
      weight,
      pointsEarned,
      reason,
    };
    total += (componentScore / 100) * weight;
  }
  const score = Math.round(clamp(total, 0, 100));
  return {
    score,
    grade: gradeFromScore(score),
    breakdown: { parts, weights: WEIGHTS, totalWeight: TOTAL_WEIGHT },
  };
}

// Neofa Priority: SmartScout Opportunity Score (Excel/matematiksel, AI'dan bağımsız)
// ile Brand Accessibility Score'un (AI araştırmasından) basit ortalaması. Kullanıcı
// örneğinde 91 + 84 -> 88 (düz ortalama neredeyse birebir eşleşiyor: 87.5 ≈ 88),
// bu yüzden ağırlıklı değil düz ortalama kullanılıyor — ileride istenirse ağırlık
// eklenebilir ama şimdilik iki skorun eşit önemde görülmesi tercih edildi.
function computeNeofaPriority(opportunityScore, accessibilityScore) {
  const opp = typeof opportunityScore === "number" ? opportunityScore : null;
  const acc = typeof accessibilityScore === "number" ? accessibilityScore : null;
  if (opp === null && acc === null) return null;
  if (opp === null) return Math.round(acc);
  if (acc === null) return Math.round(opp);
  return Math.round((opp + acc) / 2);
}

module.exports = { computeAccessibilityScore, computeNeofaPriority, WEIGHTS, gradeFromScore };
