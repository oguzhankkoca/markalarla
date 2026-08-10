// AI özellikleri (v55 kişiselleştirme, v56 öncelik+etiket, v57 yanıt sınıflandırma
// + taslak yanıt, v71 Outreach Intelligence entegrasyonu). HEPSİ İSTEĞE BAĞLIDIR:
// hiçbiri otomatik/arka planda çalışmaz, sadece kullanıcı bu uç noktalardan birini
// ("AI Analiz Et" butonu ile) manuel tetiklediğinde devreye girer. Bu yüzden
// ANTHROPIC_API_KEY tanımlı değilse sistemin geri kalanı etkilenmez — sadece bu
// route'lar net bir hata mesajı döner.
const express = require("express");
const db = require("../db");
const { isConfigured, askClaude, extractJson } = require("../services/ai");
const { logEvent } = require("../services/events");
const { getParsedIntel } = require("../services/brandIntelligence");
const { buildOutreachIntelligence, NEOFA_CAPABILITIES } = require("../services/outreachIntelligence");

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

// --- v71: AI OUTREACH INTELLIGENCE — email üretiminden BAĞIMSIZ, ücretsiz ---
// (AI çağrısı yok) bir "neden bu markaya yazıyoruz" özeti. UI'da mevcut AI
// Kişiselleştirme bölümünün ÜSTÜNDE gösterilir (bkz. app.js). GET olduğu için
// sayfa açılışında otomatik çağrılabilir — hiçbir AI kredisi harcamaz.
router.get("/api/brands/:id/outreach-intelligence", (req, res) => {
  const brand = db.prepare("SELECT * FROM brands WHERE id = ?").get(req.params.id);
  if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });
  const intel = getParsedIntel(brand.id);
  const chain = buildOutreachIntelligence(brand, intel);
  res.json({ ok: true, chain });
});

// En üstteki (buildContactList/titlePriorityRank'e göre zaten sıralanmış) ilk
// gerçek isimli kontağı bulur — YOKSA null döner (asla isim uydurulmaz, "Hi
// {Brand} team," şeklinde jenerik bir selamlamaya düşülür).
function pickGreetingName(intel) {
  const contacts = Array.isArray(intel.contacts) ? intel.contacts : [];
  const named = contacts.find((c) => c && c.name);
  return named ? named.name : null;
}

// --- v71: Deterministik email guardrail (madde 13: "Email Quality Check") --
// AI'nın kendi öz-değerlendirmesine GÜVENMİYORUZ (o da yanılabilir) — kod
// seviyesinde, regex/sayım bazlı, her zaman aynı sonucu veren bir son kontrol
// katmanı. FAIL olursa personalizeBrand() 1 kez düzeltici prompt ile yeniden
// dener; yine FAIL olursa email SESSİZCE gönderilmez, açık bir hata döner.
const BANNED_PHRASES = [
  { re: /\bguarantee[sd]?\b/i, label: "garanti veriyor ('guarantee')" },
  { re: /\bwe will fix\b/i, label: "doğrulanmamış bir 'düzeltme' vaadi ('we will fix')" },
  { re: /dramatically increase/i, label: "abartılı büyüme vaadi ('dramatically increase')" },
  { re: /\b(double|triple|quadruple)\s+your\s+(sales|revenue)/i, label: "abartılı büyüme vaadi (ör. 'double your sales')" },
  { re: /100%\s*(certain|guaranteed)/i, label: "kesinlik iddiası ('100% guaranteed')" },
  { re: /we\s+promise/i, label: "doğrulanamayan vaat ('we promise')" },
  { re: /\b(your|the)\s+(amazon\s+)?(listings?|photos?|images?|presence)\s+(is|are|look[s]?)\s+(bad|poor|weak|terrible|awful)\b/i, label: "doğrudan aşağılayıcı eleştiri" },
  { re: /we can fix your amazon account/i, label: "doğrulanamayan hizmet vaadi" },
  // v71-QA fix: halüsinasyon stres testinde (8 kategori) bu 4 desen sıfır
  // guardrail sinyaliyle geçiyordu — deterministik zincir bu bilgilerin HİÇBİRİNİ
  // üretmediği için (satış rakamı, Amazon performans metriği, mevcut bir
  // yetkilendirme/temas ilişkisi asla chain çıktısında YOK), bunları email
  // metninde görmek %100 uydurma demektir. "always"/"we always" bir güvence
  // sözü, chain'in kendi reassuranceLine'ı zaten koşullu/doğrulanmış ifade
  // kullanıyor, bu yüzden mutlak "always comply/honor" da abartı sayılır.
  { re: /\bwe\s+are\s+(already|currently)?\s*(an\s+)?authorized\b/i, label: "uydurma yetkilendirme iddiası ('we are already authorized')" },
  { re: /\balready\s+an\s+authorized\s+(amazon\s+)?reseller\b/i, label: "uydurma yetkili satıcı iddiası" },
  { re: /\b(following up on|as we discussed|as per our|during our (call|meeting)|per our (conversation|call))\b/i, label: "uydurma önceki temas/görüşme referansı (bu ilk email)" },
  { re: /\bwe\s+always\s+(fully\s+)?(comply|honor|follow)\b/i, label: "mutlak/doğrulanamayan uyum güvencesi ('we always comply')" },
  { re: /\b(manufactur(e|ing)|private[- ]label production|international distribution|logistics services|marketing services|design services|photography services|listing optimization service)\b/i, label: "Neofa'nın gerçekte sunmadığı bir hizmet vaadi (NEOFA_CAPABILITIES dışı)" },
  // v71-QA fix: "uydurma marka olayı" — chain markanın büyüme/finansman/lansman
  // gibi spesifik, doğrulanmamış bir olayını ASLA üretmez. Bu regex tüm
  // varyasyonları yakalayamaz (açık uçlu doğal dil, tam semantik tespit AI
  // gerektirir) ama en yaygın "tebrik/övgü" kalıplarını kapsar — bkz. rapor
  // "KNOWN LIMITATION" notu.
  { re: /\b(congrats|congratulations)\s+on\s+your\s+(recent|new)\b/i, label: "doğrulanmamış marka olayına tebrik (uydurma olabilir)" },
  { re: /\byour\s+recent\s+(expansion|launch|funding|acquisition|rebrand|relaunch)\b/i, label: "doğrulanmamış, spesifik bir marka olayı iddiası" },
];

// v71-QA fix: chain HİÇBİR ZAMAN markanın kendi satış/gelir/performans rakamını
// üretmiyor (böyle bir alan yok) — bu yüzden email metninde $ tutarı veya
// performansla ilişkili bir yüzde geçiyorsa, bu KESİN uydurmadır.
const FABRICATED_METRIC_RE = /\$\s?\d|\b\d{1,3}\s?%/;

function runEmailGuardrails({ subject, body, findingsUsed, chain, brand, greetingName }) {
  const text = `${subject || ""}\n${body || ""}`;
  const checklist = {};
  const failures = [];

  // 1) Brand-specific?
  checklist.brandSpecific = text.toLowerCase().includes(String(brand.name || "").toLowerCase());
  if (!checklist.brandSpecific) failures.push("Marka adı email metninde geçmiyor (jenerik görünüyor).");

  // 2) Correct brand name (aynı kontrol, ayrı checklist maddesi olarak isteniyor)
  checklist.correctBrandName = checklist.brandSpecific;

  // 3) No unsupported claim / no overselling (madde 10)
  const bannedHit = BANNED_PHRASES.find((b) => b.re.test(text));
  checklist.noUnsupportedClaim = !bannedHit;
  checklist.noInsultingCriticism = !bannedHit || !/aşağılayıcı/.test(bannedHit.label);
  if (bannedHit) failures.push(`Yasaklı ifade tespit edildi: ${bannedHit.label}.`);

  // 4) No hallucination / max 1-2 findings (madde 6 + "no unsupported claim")
  const count = Array.isArray(findingsUsed) ? findingsUsed.length : 0;
  checklist.noMoreThanTwoFindings = count <= 2;
  if (!checklist.noMoreThanTwoFindings) failures.push(`Email'de ${count} bulgu kullanılmış (maksimum 2 olmalı).`);

  // 4b) v71-QA fix: uydurma rakam/istatistik (chain ASLA satış/gelir/performans
  // rakamı üretmez — metinde $ tutarı ya da performansla ilişkili bir % varsa
  // bu kesinlikle uydurmadır).
  checklist.noFabricatedMetrics = !FABRICATED_METRIC_RE.test(text);
  if (!checklist.noFabricatedMetrics) failures.push("Email'de doğrulanmamış bir rakam/yüzde/tutar geçiyor (chain böyle bir veri üretmez — uydurma).");

  // 4c) v71-QA fix: "findings_used" SAYISI kontrol ediliyordu ama İÇERİĞİ
  // kontrol edilmiyordu — AI, chain'in ÖNERMEDİĞİ bir "bulgu" metni yazıp bunu
  // findings_used'a koyabilir (halüsinasyon testi bunu kanıtladı). Artık her
  // findings_used girdisi GERÇEKTEN chain.keyFindings içindeki bir metinle
  // örtüşmeli (tam ya da büyük ölçüde alt-dize eşleşmesi) — chain hiç bulgu
  // önermiyorsa (ilişki-odaklı genel email), findings_used da BOŞ olmalı.
  const verifiedFindingTexts = chain && Array.isArray(chain.keyFindings) ? chain.keyFindings.map((f) => String((f && f.text) || "").toLowerCase()).filter(Boolean) : [];
  checklist.findingsAreVerified =
    !Array.isArray(findingsUsed) || findingsUsed.length === 0
      ? true
      : findingsUsed.every((fu) => {
          const t = String(fu || "").toLowerCase().trim();
          if (!t) return true;
          return verifiedFindingTexts.some((vf) => t.includes(vf) || vf.includes(t));
        });
  if (!checklist.findingsAreVerified) failures.push("findings_used içinde, chain'in önerdiği doğrulanmış bulgulardan HİÇBİRİYLE eşleşmeyen bir metin var (uydurma bulgu).");

  // 5) Not overly salesy (kaba bir sezgisel ölçüt: aşırı ünlem/CAPS yok)
  const exclaimCount = (text.match(/!/g) || []).length;
  checklist.notOverlySalesy = exclaimCount <= 1;
  if (!checklist.notOverlySalesy) failures.push("Çok fazla ünlem işareti — aşırı 'satış diliyle' yazılmış olabilir.");

  // 6) Clear value (Neofa'nın gerçek yeteneklerinden biri geçiyor mu?) — bulgu/
  // angle yoksa (ilişki-odaklı jenerik email) bu kontrol zaten uygulanamaz, geç.
  checklist.clearValue =
    !chain || !chain.neofaValue
      ? true
      : NEOFA_CAPABILITIES.some((cap) => text.toLowerCase().includes(cap.toLowerCase().split(" ").slice(-2).join(" ")));

  // 7) Low-friction CTA (soru işareti ya da bilinen bir CTA kalıbı var mı?)
  checklist.lowFrictionCta = /\?/.test(body || "") || /happy to|would you|open to/i.test(body || "");
  if (!checklist.lowFrictionCta) failures.push("Düşük sürtünmeli bir CTA (soru/istek) bulunamadı.");

  // 8) Correct contact person (isim varsa selamlamada geçmeli)
  checklist.correctContactPerson = greetingName ? (body || "").includes(greetingName) : true;
  if (greetingName && !checklist.correctContactPerson) failures.push(`Bilinen kontak ismi (${greetingName}) selamlamada kullanılmamış.`);

  // 9) Amazon mention appropriate (madde 11) — SADECE amazonMentionPolicy=AVOID
  // iken sert kural: "Amazon" kelimesi hiç geçmemeli.
  const mentionsAmazon = /\bamazon\b/i.test(text);
  checklist.amazonMentionAppropriate = chain && chain.amazonMentionPolicy === "AVOID" ? !mentionsAmazon : true;
  if (chain && chain.amazonMentionPolicy === "AVOID" && mentionsAmazon) {
    failures.push("Marketplace politikası PROHIBITED/AVOID olmasına rağmen email'de 'Amazon' kelimesi geçiyor.");
  }

  // 10) Sounds human (bilgilendirici, engelleyici değil) — çok uzun değilse geç.
  checklist.reasonableLength = (body || "").split(/\s+/).filter(Boolean).length <= 180;
  if (!checklist.reasonableLength) failures.push("Email çok uzun (kısa/öz olmalı).");

  const hardFailKeys = [
    "brandSpecific",
    "noUnsupportedClaim",
    "noMoreThanTwoFindings",
    "noFabricatedMetrics",
    "findingsAreVerified",
    "amazonMentionAppropriate",
    "correctContactPerson",
  ];
  const pass = hardFailKeys.every((k) => checklist[k] !== false);
  return { pass, checklist, failures };
}

// --- v71: AI Kişiselleştirme -> AI Outreach Intelligence ile zenginleştirilmiş
// TAM email üretimi -------------------------------------------------------
// ESKİDEN (v55): sadece 2-3 cümlelik bir giriş paragrafı üretiyordu.
// ARTIK: services/outreachIntelligence.js'in ürettiği (AI ÇAĞRISI OLMAYAN,
// deterministik, zaten doğrulanmış verilerden türetilen) PROBLEM->OPPORTUNITY->
// NEOFA VALUE->ANGLE zincirini TEK bir AI çağrısına bağlam olarak veriyor ve
// tam bir taslak email (subject+body) üretiyor. AI'nın seçtiği angle SADECE bu
// zincirin önerdiği (kanıta dayalı) adaylar arasından olabilir — yeni bir angle
// UYDURAMAZ. Üretilen email, gönderilmeden önce deterministik guardrail'den
// (yukarıda) geçirilir; FAIL olursa 1 kez düzeltici prompt ile yeniden denenir.
// Aynı /api/brands/ai-personalize uç noktası ve aynı ai_personalized_intro
// kolonu kullanılıyor (geriye dönük UYUMLU) — mevcut gönderim/CRM/follow-up
// akışları bu koda HİÇ dokunmuyor (ai_personalized_intro zaten sadece manuel
// kopyala-yapıştır amaçlı bir yardımcı alandı, otomatik gönderime karışmıyordu).
function buildEmailPrompt(brand, chain, intel, { correction } = {}) {
  const greetingName = pickGreetingName(intel);
  const findingsBlock =
    chain.keyFindings.length > 0
      ? chain.keyFindings.map((f, i) => `${i + 1}. ${f.text} (kaynak: ${f.source})`).join("\n")
      : "(Doğrulanmış spesifik bir bulgu yok — email daha genel/ilişki odaklı olmalı, uydurma bir sorun/fırsat YAZMA.)";

  const angleBlock = `ÖNERİLEN ANGLE (SADECE bunlardan birini seç, yeni bir angle uydurma):
- PRIMARY: ${chain.primaryAngle} — kanıt: ${chain.primaryAngleReason || "(genel)"}
${chain.secondaryAngle ? `- SECONDARY (istersen ikinci bir çerçeve olarak değinebilirsin): ${chain.secondaryAngle} — kanıt: ${chain.secondaryAngleReason || ""}` : ""}`;

  const amazonBlock =
    chain.amazonMentionPolicy === "OPEN"
      ? "Amazon'u AÇIKÇA konuşabilirsin (markanın kendi sitesinde Amazon'da satışa izin verildiğine dair kanıt var)."
      : chain.amazonMentionPolicy === "AVOID"
      ? "'Amazon' KELİMESİNİ HİÇ KULLANMA — marka Amazon'da/3. parti pazaryerlerinde satışı açıkça yasaklıyor. Sadece wholesale/toptan satış partnerliği çerçevesinde yaz."
      : "Amazon'u İLK EMAİLDE ÖNE ÇIKARMA — Amazon izni doğrulanamadı (UNCLEAR). Bunun yerine wholesale/online retail partnerliği çerçevesi kullan; istersen 'online retail presence' gibi genel bir ifadeyle değinebilirsin ama 'Amazon' kelimesini vurgulama.";

  const miniAuditBlock = chain.miniAuditEligible
    ? `Bu marka mini-audit teklifi için UYGUN (doğrulanmış güçlü bulgular + yüksek accessibility notu var). İstersen şu CTA'yı doğal bir şekilde kullan: "${chain.miniAuditOffer}"`
    : "Bu marka mini-audit teklifi için UYGUN DEĞİL — mini audit/ücretsiz denetim teklifi YAPMA.";

  const reassuranceBlock = chain.reassuranceLine
    ? `İstersen (doğal duruyorsa) şu güvence cümlesini kullanabilirsin (Neofa GERÇEKTEN buna uyuyor, bu yüzden güvenli): "${chain.reassuranceLine}"`
    : "";

  const correctionBlock = correction
    ? `\nÖNEMLİ — ÖNCEKİ DENEMEN ŞU KURAL(LAR)I İHLAL ETTİ, YENİDEN YAZ VE KESİNLİKLE DÜZELT:\n${correction
        .map((c) => `- ${c}`)
        .join("\n")}\n`
    : "";

  return `Sen Neofa LLC (Florida merkezli bir Amazon toptan satış/distribütörlük şirketi) adına ilk tanışma
email'i yazan bir iş geliştirme uzmanısın. Bu email'in AMACI satış yapmak DEĞİL — yanıt almak, doğru kişiye
ulaşmak, değer göstermek ve bir wholesale konuşması başlatmaktır ("Immediately buy from us" DEĞİL).

KESİN KURALLAR:
- ASLA markayı eleştirme/aşağılama ("Your photos are bad", "Your Amazon presence is weak" gibi ifadeler YASAK).
  Bunun yerine "opportunity" dili kullan: "We noticed an opportunity to...", "There appears to be an opportunity
  to...", "We noticed a few areas that may be worth exploring...".
- Email'de EN FAZLA 1-2 bulgu kullan (aşağıdaki KEY FINDINGS listesinden, başka bulgu UYDURMA). Amaç merak
  uyandırmak, markaya 10 maddelik bir problem listesi göndermek DEĞİL.
- Neofa'nın SADECE şu GERÇEKTEN sunduğu yeteneklerden bahset, listede OLMAYAN hiçbir şeyi (üretim, uluslararası
  dağıtım, "listing tasarım hizmeti" vb.) VAAT ETME: ${NEOFA_CAPABILITIES.join(", ")}.
- ASLA garanti verme, "we guarantee", "we will double your sales/revenue", "dramatically increase", "we can fix
  your Amazon account" gibi doğrulanamayan/abartılı vaatlerde BULUNMA.
- ${amazonBlock}
- ${miniAuditBlock}
- ${reassuranceBlock}
- Email KISA olsun (5 parça): (1) gerçek bir iletişime geçme sebebi, (2) TEK doğrulanmış gözlem, (3) fırsat,
  (4) Neofa'nın sağlayabileceği şey, (5) düşük sürtünmeli bir CTA. Önerilen CTA: "${chain.cta}"
- Selamlama: ${greetingName ? `"Hi ${greetingName}," gibi gerçek isimle başla (ismi TAM OLARAK böyle kullan: "${greetingName}")` : `gerçek bir isim bilinmiyor, "Hi ${brand.name} team," gibi jenerik ama profesyonel bir selamlama kullan`}.
- Dil: İngilizce. Ton: samimi ama profesyonel, kısa cümleler, abartısız.
${correctionBlock}
${angleBlock}

KEY FINDINGS (kullanabileceğin TEK kaynak, en fazla 2 tanesini kullan):
${findingsBlock}

MARKA: ${brand.name}
Kategori: ${brand.main_category || "bilinmiyor"} ${brand.subcategory ? "/ " + brand.subcategory : ""}
Website: ${brand.website || "yok"}

Sadece şu JSON formatında cevap ver, başka açıklama ekleme:
{
  "subject": "kısa, spam-görünümlü olmayan bir konu satırı",
  "body": "email gövdesi (selamlama + 5 parça + kapanış, imza HARİÇ)",
  "angle_used": "${chain.primaryAngle}" veya "${chain.secondaryAngle || chain.primaryAngle}",
  "findings_used": ["email'de GERÇEKTEN kullandığın bulgu metinleri, en fazla 2"],
  "self_check": {
    "brand_specific": true|false,
    "no_unsupported_claim": true|false,
    "no_insulting_criticism": true|false,
    "not_overly_salesy": true|false,
    "clear_value": true|false,
    "low_friction_cta": true|false,
    "max_two_findings": true|false,
    "amazon_mention_appropriate": true|false
  }
}`;
}

async function personalizeBrand(brand) {
  const intel = getParsedIntel(brand.id);
  const chain = buildOutreachIntelligence(brand, intel);

  if (chain.doNotContact) {
    return { error: `Email üretilmedi (DO_NOT_CONTACT): ${chain.doNotContactReason}` };
  }

  const greetingName = pickGreetingName(intel);
  let correction = null;
  let lastGuard = null;

  // En fazla 2 deneme: ilk deneme + (guardrail FAIL olursa) 1 düzeltici deneme.
  // Madde 13: "Pass değilse yeniden üret." İkinci denemede de FAIL olursa
  // SESSİZCE göndermek yerine açık bir hata döndürülür.
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = buildEmailPrompt(brand, chain, intel, { correction });
    const result = await askClaude(prompt, { maxTokens: 500, model: "claude-sonnet-5" });
    if (!result) return { error: "AI yapılandırılmamış." };
    if (result.error) return { error: result.error };
    const parsed = extractJson(result.text);
    if (!parsed || !parsed.body) {
      if (attempt === 0) {
        correction = ["Yanıt geçerli JSON değildi ya da 'body' alanı boştu — SADECE istenen JSON formatında cevap ver."];
        continue;
      }
      return { error: "AI yanıtı ayrıştırılamadı." };
    }

    const guard = runEmailGuardrails({
      subject: parsed.subject,
      body: parsed.body,
      findingsUsed: parsed.findings_used,
      chain,
      brand,
      greetingName,
    });
    lastGuard = guard;
    if (guard.pass) {
      const meta = {
        angleUsed: parsed.angle_used || chain.primaryAngle,
        findingsUsed: parsed.findings_used || [],
        selfCheck: parsed.self_check || {},
        guardrailChecklist: guard.checklist,
        guardrailPass: true,
        attempt: attempt + 1,
        chainSummary: {
          primaryProblem: chain.primaryProblem,
          businessOpportunity: chain.businessOpportunity,
          neofaValue: chain.neofaValue,
          primaryAngle: chain.primaryAngle,
          secondaryAngle: chain.secondaryAngle,
          cta: chain.cta,
          amazonMentionPolicy: chain.amazonMentionPolicy,
          miniAuditEligible: chain.miniAuditEligible,
        },
      };
      db.prepare(
        `UPDATE brands SET ai_personalized_intro = ?, ai_generated_subject = ?, ai_outreach_meta = ?,
         ai_personalized_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).run(parsed.body.trim(), (parsed.subject || "").trim(), JSON.stringify(meta), brand.id);
      logEvent(brand.id, "ai_personalized", `Outreach email üretildi (angle: ${meta.angleUsed}, deneme: ${attempt + 1})`);
      return { subject: parsed.subject, body: parsed.body, intro: parsed.body, meta };
    }
    correction = guard.failures;
  }

  logEvent(brand.id, "ai_personalize_failed", `Guardrail FAIL: ${(lastGuard && lastGuard.failures.join("; ")) || "bilinmeyen"}`);
  return {
    error: `Email guardrail kontrolünden geçemedi (2 denemeden sonra): ${(lastGuard && lastGuard.failures.join("; ")) || "bilinmeyen hata"}. Email GÖNDERİLMEDİ.`,
  };
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
