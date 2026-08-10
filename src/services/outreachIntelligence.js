// AI OUTREACH INTELLIGENCE (v71)
// ============================================================================
// Bu servis mevcut Brand Intelligence araştırmasının (wholesale/marketplace/
// red flag/listing/visual/contact, brandIntelligence.js tarafından zaten
// toplanmış ve brand_intelligence tablosunda saklanmış) sonuçlarını okuyup,
// DETERMİNİSTİK bir karar ağacından geçirerek şu zinciri kurar:
//
//   MARKA PROBLEMİ -> BUSINESS OPPORTUNITY -> NEOFA'NIN GERÇEK DEĞERİ -> ANGLE
//
// ÖNEMLİ TASARIM KARARLARI:
// 1) Bu modül HİÇBİR AI ÇAĞRISI YAPMAZ. Sadece zaten var olan, ya kural-bazlı
//    (SmartScout/red flag engine) ya da daha önceki bir AI araştırma adımında
//    ÜRETİLİP KAYDEDİLMİŞ verileri okur ve bir karar ağacından geçirir. Bu
//    yüzden maliyeti sıfırdır ve YENİ bir halüsinasyon kaynağı DEĞİLDİR — sadece
//    zaten doğrulanmış/kaydedilmiş alanları yeniden düzenler.
// 2) Hiçbir alan UNKNOWN/UNCLEAR ise bir "finding" ya da "problem" ÜRETMEZ —
//    sadece kesin YES/NO/ALLOWED/PROHIBITED gibi doğrulanmış sinyaller bir
//    bulguya dönüşür. Bu, "hiçbir şeyi uydurma" kuralının bu katmandaki karşılığı.
// 3) brand_intelligence/brands tablolarına HİÇBİR ŞEY YAZMAZ — computeAccessibilityScore.js
//    ile aynı "salt okunur türetme" felsefesini paylaşır.
// 4) NEOFA_CAPABILITIES listesi brandIntelligence.js'in Level 3 prompt'unda
//    ZATEN tanımlanmış, önceden onaylanmış gerçek yetenek listesiyle BİREBİR
//    AYNIDIR (tek kaynak, iki yerde farklı yetenek iddiası olmasın diye). Bu
//    listede OLMAYAN hiçbir şey ("üretim", "uluslararası dağıtım", "listing/
//    görsel tasarım hizmeti" vb.) email'lerde vaat edilmemelidir.

const ANGLES = {
  WHOLESALE_PARTNERSHIP: "Wholesale Partnership",
  AMAZON_GROWTH_OPPORTUNITY: "Amazon Growth Opportunity",
  LISTING_CONTENT_OPPORTUNITY: "Listing / Content Opportunity",
  CONTROLLED_RESELLER: "Controlled Reseller",
  LONG_TERM_RETAIL_PARTNERSHIP: "Long-Term Retail Partnership",
};

// brandIntelligence.js'in Level 3 prompt'undaki (satır ~478) metinle BİREBİR
// aynı, tek kaynak — bkz. yukarıdaki not #4.
const NEOFA_CAPABILITIES = [
  "reliable wholesale purchasing and replenishment",
  "an established Amazon marketplace presence",
  "FBA fulfillment",
  "inventory management",
  "a controlled, authorized reseller relationship",
  "MAP compliance",
];

function fieldValue(obj, key) {
  const f = obj && obj[key];
  if (!f) return "UNKNOWN";
  if (typeof f === "object" && "value" in f) return f.value;
  if (typeof f === "object" && "status" in f) return f.status;
  return f;
}

// --- 1) LISTING / VISUAL bulgularından "opportunity" dilinde bulgular -------
// SADECE kesin "NO" (gerçekten yok, UNKNOWN/görülemedi DEĞİL) olan alanlar bir
// bulguya dönüşür — presenceLabel()'ın UI'daki "bulunamadı" vs "doğrulanamadı"
// ayrımıyla BİREBİR aynı mantık, burada da korunuyor.
function listingFindings(listingAudit, imageAudit) {
  const out = [];
  if (listingAudit && listingAudit.available) {
    if (listingAudit.a_plus_content_present === "NO") {
      out.push({
        text: "adding enhanced (A+) content",
        detail: "an opportunity to add enhanced (A+) content to strengthen how the brand's story comes across on the product page",
        source: "Amazon Listing Audit — A+ Content (verified absent)",
        weight: 3,
      });
    }
    if (listingAudit.video_present === "NO") {
      out.push({
        text: "adding product video",
        detail: "an opportunity to add product video content to the listing",
        source: "Amazon Listing Audit — Video (verified absent)",
        weight: 3,
      });
    }
    if (listingAudit.brand_store_present === "NO") {
      out.push({
        text: "building out a Brand Store",
        detail: "an opportunity to build out a dedicated Amazon Brand Store",
        source: "Amazon Listing Audit — Brand Store (verified absent)",
        weight: 2,
      });
    }
    if (listingAudit.variations_present === "NO") {
      out.push({
        text: "surfacing product variations",
        detail: "an opportunity to make product variations (size/color) more visible on the listing",
        source: "Amazon Listing Audit — Variations (verified absent)",
        weight: 1,
      });
    }
  }
  if (imageAudit && imageAudit.available && Array.isArray(imageAudit.opportunities)) {
    for (const o of imageAudit.opportunities.slice(0, 2)) {
      if (o && typeof o === "string") {
        out.push({ text: "product imagery", detail: o, source: "Visual AI Analysis (ana görsel)", weight: 2 });
      }
    }
  }
  return out.sort((a, b) => b.weight - a.weight);
}

// --- 2) Wholesale sinyalinden "hook" ya da "opportunity" -------------------
function wholesaleSignal(wholesaleData) {
  const program = String(fieldValue(wholesaleData, "wholesale_program")).toUpperCase();
  if (program === "YES") {
    return {
      type: "positive_hook",
      detail: "the brand already has an established wholesale program",
      source: "Wholesale Research (wholesale_program=YES)",
    };
  }
  if (program === "NO") {
    const altKey = ["dealer_program", "reseller_program", "retailer_program"].find(
      (k) => String(fieldValue(wholesaleData, k)).toUpperCase() === "YES"
    );
    if (altKey) {
      return {
        type: "positive_hook",
        detail: `the brand has a ${altKey.replace("_program", "")} program in place`,
        source: `Wholesale Research (${altKey}=YES)`,
      };
    }
    return {
      type: "opportunity",
      detail: "an opportunity to build a reliable, structured wholesale/retail purchasing relationship",
      source: "Wholesale Research (wholesale_program=NO)",
    };
  }
  return null; // UNKNOWN -> hiçbir iddia üretilmez
}

// --- 3) Marketplace politikasından Amazon-mention politikası ---------------
// madde 11: ALLOWED -> açık konuşulabilir, UNCLEAR -> wholesale/online-retail
// üzerinden yaklaş, PROHIBITED -> hiç Amazon reseller pitch'i gönderme.
function amazonMentionPolicy(marketplacePolicy) {
  const status = String(fieldValue(marketplacePolicy, "amazon_allowed")).toUpperCase();
  if (status === "ALLOWED") return { policy: "OPEN", reason: "Markanın kendi kaynağında Amazon'da satışa açık izin bulundu." };
  if (status === "PROHIBITED") return { policy: "AVOID", reason: "Markanın kendi kaynağında Amazon'da satış açıkça yasaklanmış." };
  return { policy: "SOFT", reason: "Amazon izni doğrulanamadı (UNCLEAR) — ilk emailde Amazon'u öne çıkarmak yerine wholesale/online retail çerçevesi kullanılmalı." };
}

// --- 4) Red flag'lerden marka sahibi psikolojisi / endişeleri --------------
const CONCERN_MAP = {
  TOO_MANY_SELLERS: "marketplace control / too many resellers",
  DOMINANT_SELLER_AMAZON_RETAIL: "marketplace control",
  MAP_VIOLATION_RISK: "MAP / price control",
  EXCLUSIVE_DISTRIBUTOR_ONLY: "existing distributor relationship",
  AUTHORIZED_RESELLER_ONLY: "brand image / authorized reseller requirement",
  UNVERIFIED_DISTRIBUTOR: "distribution channel clarity",
  MARKETPLACE_RESTRICTIONS: "channel control",
  AMAZON_PROHIBITED: "unauthorized seller concerns",
  MARKETPLACE_PROHIBITED: "unauthorized seller concerns",
};
function ownerConcerns(redFlags) {
  const flags = Array.isArray(redFlags) ? redFlags : [];
  const concerns = new Set();
  for (const f of flags) {
    const label = CONCERN_MAP[f && f.flag];
    if (label) concerns.add(label);
  }
  return Array.from(concerns);
}
function hasControlConcern(redFlags) {
  const flags = (Array.isArray(redFlags) ? redFlags : []).map((f) => f && f.flag);
  return flags.some((f) => ["TOO_MANY_SELLERS", "DOMINANT_SELLER_AMAZON_RETAIL", "MAP_VIOLATION_RISK"].includes(f));
}

// --- 5) MAP reassurance (madde 12) ------------------------------------------
// SADECE map_policy=YES doğrulandıysa VE Neofa'nın zaten sahip olduğu gerçek
// bir yetenek (MAP compliance, NEOFA_CAPABILITIES'te var) bu sözü tutmayı
// içerdiği için üretilir — asla uydurma bir taahhüt değil.
function buildReassuranceLine(marketplacePolicy) {
  const mapPolicy = String(fieldValue(marketplacePolicy, "map_policy")).toUpperCase();
  if (mapPolicy === "YES") {
    return "we're committed to following the brand's pricing and reseller policies (MAP compliance is one of the things we take seriously as a partner)";
  }
  return null;
}

// --- 6) Angle seçimi ---------------------------------------------------------
// Her angle adayına, o angle'ı destekleyen GERÇEK kanıtlar varsa bir puan
// veriyoruz; en yüksek puanlı adayı PRIMARY, ikinciyi (varsa, farklıysa)
// SECONDARY olarak seçiyoruz. Bu, "AI otomatik en uygun angle'ı seçsin"
// isteğini karşılarken (email üretme adımında AI bu önerilenler arasından
// nihai seçimi/ifadeyi yapar) angle'ın HER ZAMAN gerçek kanıta dayanmasını
// garanti eder — AI kendiliğinden yeni bir angle uyduramaz.
function scoreAngles({ wholesale, findings, actionBadge, accessibilityGrade, brandFitScore, controlConcern }) {
  const scores = {
    [ANGLES.WHOLESALE_PARTNERSHIP]: 0,
    [ANGLES.AMAZON_GROWTH_OPPORTUNITY]: 0,
    [ANGLES.LISTING_CONTENT_OPPORTUNITY]: 0,
    [ANGLES.CONTROLLED_RESELLER]: 0,
    [ANGLES.LONG_TERM_RETAIL_PARTNERSHIP]: 0,
  };
  const reasons = {};

  if (wholesale) {
    scores[ANGLES.WHOLESALE_PARTNERSHIP] += wholesale.type === "positive_hook" ? 3 : 2;
    reasons[ANGLES.WHOLESALE_PARTNERSHIP] = wholesale.detail;
  }
  if (actionBadge === "DISTRIBUTOR_ROUTE") {
    scores[ANGLES.WHOLESALE_PARTNERSHIP] += 2;
    reasons[ANGLES.WHOLESALE_PARTNERSHIP] =
      (reasons[ANGLES.WHOLESALE_PARTNERSHIP] ? reasons[ANGLES.WHOLESALE_PARTNERSHIP] + "; " : "") +
      "no verified direct wholesale program — distributor route";
  }
  if (findings.length > 0) {
    scores[ANGLES.LISTING_CONTENT_OPPORTUNITY] += 2 + Math.min(findings.length, 2);
    reasons[ANGLES.LISTING_CONTENT_OPPORTUNITY] = `${findings.length} doğrulanmış listing/görsel bulgusu var`;
  }
  if (accessibilityGrade === "A+" || accessibilityGrade === "A") {
    scores[ANGLES.AMAZON_GROWTH_OPPORTUNITY] += 2;
    reasons[ANGLES.AMAZON_GROWTH_OPPORTUNITY] = `Brand Accessibility Score notu: ${accessibilityGrade}`;
  }
  if (controlConcern) {
    scores[ANGLES.CONTROLLED_RESELLER] += 3;
    reasons[ANGLES.CONTROLLED_RESELLER] = "red flag engine kontrol/MAP endişesi tespit etti";
  }
  if ((accessibilityGrade === "A+" || accessibilityGrade === "A") && typeof brandFitScore === "number" && brandFitScore >= 70 && !controlConcern) {
    scores[ANGLES.LONG_TERM_RETAIL_PARTNERSHIP] += 2;
    reasons[ANGLES.LONG_TERM_RETAIL_PARTNERSHIP] = `Yüksek accessibility (${accessibilityGrade}) + yüksek brand fit (${brandFitScore}) + red flag yok`;
  }
  // Hiçbir sinyal yoksa (tamamen UNKNOWN bir marka) varsayılan, en nötr angle:
  // genel bir Amazon büyüme ortaklığı çerçevesi (spesifik bir iddia içermez).
  const allZero = Object.values(scores).every((s) => s === 0);
  if (allZero) {
    scores[ANGLES.AMAZON_GROWTH_OPPORTUNITY] = 1;
    reasons[ANGLES.AMAZON_GROWTH_OPPORTUNITY] = "Doğrulanmış spesifik bir sinyal yok — genel/nötr bir ortaklık çerçevesi kullanılıyor.";
  }

  const ranked = Object.entries(scores)
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1]);
  const primary = ranked[0] || [ANGLES.AMAZON_GROWTH_OPPORTUNITY, 0];
  const secondary = ranked.find(([name]) => name !== primary[0]);
  return {
    primaryAngle: primary[0],
    primaryAngleReason: reasons[primary[0]] || "",
    secondaryAngle: secondary ? secondary[0] : null,
    secondaryAngleReason: secondary ? reasons[secondary[0]] || "" : null,
  };
}

// --- 7) CTA seçimi (en düşük sürtünmeli adım) -------------------------------
function selectCta({ miniAuditEligible, primaryAngle, actionBadge }) {
  if (miniAuditEligible) {
    return "I'd be happy to share a brief, complimentary audit of a few opportunities we noticed, if useful.";
  }
  if (actionBadge === "PHONE_FIRST") {
    return "Would a brief call be easier than email? Happy to work around your schedule.";
  }
  if (primaryAngle === ANGLES.WHOLESALE_PARTNERSHIP) {
    return "Would you be the right person to speak with about wholesale opportunities?";
  }
  if (primaryAngle === ANGLES.CONTROLLED_RESELLER) {
    return "Would you be open to a brief conversation about becoming an authorized partner?";
  }
  return "Would you be open to a brief conversation?";
}

// ---------------------------------------------------------------------------
// ANA FONKSİYON — dışa açık tek giriş noktası.
// brand: `brands` tablosundan satır (id, name, main_category, ...).
// intel: getParsedIntel(brand.id) çıktısı (zaten parse edilmiş JSON alanlarıyla).
// ---------------------------------------------------------------------------
function buildOutreachIntelligence(brand, intel) {
  const wholesaleData = intel.wholesaleData || {};
  const marketplacePolicy = intel.marketplacePolicy || {};
  const redFlags = intel.redFlags || [];
  const listingAudit = intel.listingAudit || {};
  const imageAudit = intel.imageAudit || {};
  const companyData = intel.companyData || {};
  const actionBadge = intel.action_badge || null;

  // DO NOT CONTACT: computeActionBadge tarafından ZATEN doğru şekilde
  // hesaplanmış (bkz. brandIntelligence.js) — burada TEKRAR hesaplamıyoruz,
  // sadece saygı gösteriyoruz. Bu durumda hiçbir email/angle üretilmez.
  if (actionBadge === "DO_NOT_CONTACT") {
    return {
      doNotContact: true,
      doNotContactReason:
        "Marketplace politikası ya da kritik bir red flag Amazon/marketplace satışını yasaklıyor — bu marka için outreach email'i üretilmedi.",
    };
  }

  const findings = listingFindings(listingAudit, imageAudit);
  const wholesale = wholesaleSignal(wholesaleData);
  const amazonPolicy = amazonMentionPolicy(marketplacePolicy);
  const concerns = ownerConcerns(redFlags);
  const controlConcern = hasControlConcern(redFlags);
  const reassuranceLine = buildReassuranceLine(marketplacePolicy);
  const accessibilityGrade = intel.accessibility_grade || null;
  const brandFitScore = typeof companyData.brand_fit_score === "number" ? companyData.brand_fit_score : null;

  const { primaryAngle, primaryAngleReason, secondaryAngle, secondaryAngleReason } = scoreAngles({
    wholesale,
    findings,
    actionBadge,
    accessibilityGrade,
    brandFitScore,
    controlConcern,
  });

  // Mini Audit Offer gating (madde 5): SADECE (1) doğrulanmış listing/görsel
  // bulgusu VAR, (2) accessibility notu yüksek (A/A+, "strong brand fit"in
  // buradaki ölçülebilir karşılığı) VE (3) DO_NOT_CONTACT değilse.
  const miniAuditEligible =
    findings.length > 0 && (accessibilityGrade === "A+" || accessibilityGrade === "A");
  const miniAuditOffer = miniAuditEligible
    ? "We noticed a few opportunities that could potentially strengthen your Amazon presence — happy to share a brief, complimentary audit if useful."
    : null;

  // Key Findings (madde 6): en fazla 2, önce listing/visual (en az hassas /
  // en "opportunity" dostu), yoksa wholesale/marketplace sinyaline düş.
  const keyFindings = findings.slice(0, 2).map((f) => ({ text: f.detail, source: f.source }));
  if (keyFindings.length === 0 && wholesale) {
    keyFindings.push({ text: wholesale.detail, source: wholesale.source });
  }

  // Primary Problem / Business Opportunity / Neofa Value (madde 1/7) — SADECE
  // gerçekten bir bulgu varsa doldurulur, yoksa null (email daha genel/ilişki
  // odaklı yazılır, uydurma bir problem YOK).
  let primaryProblem = null;
  let businessOpportunity = null;
  let neofaValue = null;

  if (keyFindings.length > 0) {
    primaryProblem = { text: keyFindings[0].text, source: keyFindings[0].source };
    businessOpportunity = { text: `strengthening ${keyFindings[0].text}`, source: keyFindings[0].source };
  }

  // Neofa value -> angle'a göre NEOFA_CAPABILITIES listesinden SADECE gerçek
  // bir yetenek seçilir, asla listede olmayan bir şey vaat edilmez.
  const ANGLE_TO_CAPABILITY = {
    [ANGLES.WHOLESALE_PARTNERSHIP]: NEOFA_CAPABILITIES[0], // reliable wholesale purchasing/replenishment
    [ANGLES.AMAZON_GROWTH_OPPORTUNITY]: NEOFA_CAPABILITIES[1], // Amazon marketplace presence
    [ANGLES.LISTING_CONTENT_OPPORTUNITY]: NEOFA_CAPABILITIES[1],
    [ANGLES.CONTROLLED_RESELLER]: NEOFA_CAPABILITIES[4], // controlled/authorized reseller relationship
    [ANGLES.LONG_TERM_RETAIL_PARTNERSHIP]: NEOFA_CAPABILITIES[0],
  };
  neofaValue = { text: ANGLE_TO_CAPABILITY[primaryAngle] || NEOFA_CAPABILITIES[1], capabilities: NEOFA_CAPABILITIES };

  const cta = selectCta({ miniAuditEligible, primaryAngle, actionBadge });

  return {
    doNotContact: false,
    primaryProblem,
    businessOpportunity,
    neofaValue,
    primaryAngle,
    primaryAngleReason,
    secondaryAngle,
    secondaryAngleReason,
    keyFindings,
    miniAuditEligible,
    miniAuditEligibleReason: miniAuditEligible
      ? `${findings.length} doğrulanmış listing/görsel bulgusu + accessibility notu ${accessibilityGrade}`
      : "Mini audit teklifi için yeterli doğrulanmış bulgu/erişilebilirlik notu yok.",
    miniAuditOffer,
    amazonMentionPolicy: amazonPolicy.policy,
    amazonMentionReason: amazonPolicy.reason,
    reassuranceLine,
    ownerConcerns: concerns,
    cta,
    actionBadge,
    neofaCapabilities: NEOFA_CAPABILITIES,
  };
}

module.exports = { buildOutreachIntelligence, ANGLES, NEOFA_CAPABILITIES };
