const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");
const ai = require("./ai");

// Basit anahtar kelime tabanlı olumlu/olumsuz tahmini.
// Yapay zeka anahtarı tanımlıysa (ANTHROPIC_API_KEY) bu sadece bir ilk/yedek
// tahmindir — asıl karar aşağıdaki classifyReplyWithAI() ile netleştirilir.
// Tanımlı değilse sistem tamamen bu anahtar kelime listesiyle çalışmaya devam eder.
const POSITIVE_KEYWORDS = [
  "interested",
  "sounds good",
  "let's schedule",
  "lets schedule",
  "let's set up",
  "happy to",
  "looking forward",
  "sure, let",
  "yes, let",
  "we would like",
  "we'd like",
  "please send",
  "moving forward",
  "set up a call",
  "schedule a call",
  "ilgileniyoruz",
  "olumlu",
  "görüşelim",
  "gorusel",
  "devam edelim",
  "teklifinizi",
  "memnuniyetle",
];

const NEGATIVE_KEYWORDS = [
  "not interested",
  "no thank",
  "not looking",
  "unsubscribe",
  "remove me",
  "please remove",
  "decline",
  "pass on this",
  "not a fit",
  "no longer",
  "stop contacting",
  "ilgilenmiyoruz",
  "istemiyoruz",
  "olumsuz",
  "teşekkürler ama",
  "uygun değil",
];

// Gönderici, ilerlemeden önce bir onay belgesi/evrak istiyorsa bu ifadeler geçer.
// Amaç: "İş lisansı/bayilik başvurusu/vergi belgesi gönderir misiniz?" gibi
// yanıtları otomatik olarak "belge isteniyor" diye işaretleyip ayrı bir listede
// toplamak, böylece bu markalara doğru evrakla dönmen kolaylaşsın.
const DOCUMENT_KEYWORDS = [
  "business license",
  "reseller certificate",
  "resale certificate",
  "reseller license",
  "reseller application",
  "wholesale license",
  "wholesale application",
  "distributor agreement",
  "distributor application",
  "dealer agreement",
  "dealer application",
  "authorized dealer",
  "authorized reseller",
  "tax id",
  "ein number",
  "employer identification",
  "w9",
  "w-9",
  "certificate of incorporation",
  "business registration",
  "proof of business",
  "trade license",
  "sales tax permit",
  "seller's permit",
  "sellers permit",
  "please provide your",
  "please send us your",
  "please attach",
  "kindly provide",
  "supporting documents",
  "verification documents",
  "credit application",
  "new account application",
  "vergi levha", // "levhası/levhanızı/levhanızi" gibi çekimlerin hepsini yakalar (kök eşleşme)
  "ticaret sicil",
  "imza sirküleri",
  "imza sirkuleri",
  "yetki belge", // "belgesi/belgenizi" vb.
  "bayilik başvuru", // "başvurusu/başvurunuzu" vb.
  "bayilik basvuru",
  "vergi kimlik",
  "işletme belge",
  "isletme belge",
  "faaliyet belge",
];

// Teslim edilemeyen (bounce/NDR) bildirimlerinde sıkça geçen ifadeler. Yapay
// zeka tanımlıysa AI bu mesajları zaten "bounce" olarak sınıflandırabilir; bu
// liste hem AI olmadan çalışan yedek katman hem de checkBounces() için ek bir
// güven sinyali olarak kullanılır.
const BOUNCE_TEXT_KEYWORDS = [
  "delivery has failed",
  "delivery failed",
  "delivery status notification",
  "undelivered mail returned to sender",
  "returned mail",
  "mail delivery failed",
  "message not delivered",
  "delivery incomplete",
  "could not be delivered",
  "was not delivered",
  "unable to deliver",
  "delivery time expired",
  "recipient address rejected",
  "user unknown",
  "mailbox unavailable",
  "mailbox not found",
  "no such user",
  "recipient not found",
  "does not exist",
  "address not found",
  "permanent failure",
  "temporary failure",
  "failure notice",
  "this is an automatically generated delivery status notification",
  "the following message could not be delivered",
  "the following addresses had permanent delivery errors",
  "host or domain name not found",
  "smtp error",
  "hard bounce",
  "soft bounce",
  "delivery has failed to these recipients",
  "message blocked",
  "mailbox full",
  "quota exceeded",
  "550 ",
  "553 ",
  "5.1.1",
  "5.4.4",
  "5.2.2",
  "5.1.0",
];

// Bazı bildirimler (özellikle bazı bounce/NDR mesajları) sadece HTML gövde
// içerir, düz metin (text/plain) parçası olmayabilir — bu durumda mailparser'ın
// parsed.text alanı boş kalır ve anahtar kelime/adres araması hiçbir şey
// bulamaz. Bu fonksiyon önce düz metni dener, yoksa HTML'i etiketlerinden
// arındırıp düz metne çevirir.
function extractPlainText(parsed) {
  if (parsed.text && parsed.text.trim()) return parsed.text;
  if (parsed.html) {
    return parsed.html
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return "";
}

function guessSentiment(text) {
  const lower = (text || "").toLowerCase();
  const hasPositive = POSITIVE_KEYWORDS.some((k) => lower.includes(k));
  const hasNegative = NEGATIVE_KEYWORDS.some((k) => lower.includes(k));
  if (hasNegative && !hasPositive) return "negative";
  if (hasPositive && !hasNegative) return "positive";
  return "neutral"; // emin değiliz, elle kontrol gerekir
}

function guessDocumentRequested(text) {
  const lower = (text || "").toLowerCase();
  return DOCUMENT_KEYWORDS.some((k) => lower.includes(k));
}

function guessBounceLike(text) {
  const lower = (text || "").toLowerCase();
  return BOUNCE_TEXT_KEYWORDS.some((k) => lower.includes(k));
}

// Yapay zeka (Claude Haiku) ile gelen yanıtı sınıflandırır. ANTHROPIC_API_KEY
// tanımlı değilse null döner (çağıran taraf anahtar kelime tahminine devam eder) —
// yani bu katman tamamen opsiyoneldir, olmadan da sistem çalışır.
async function classifyReplyWithAI(subject, text) {
  if (!ai.isConfigured()) return null;
  const prompt = `Aşağıda bir marka outreach (iş birliği teklifi) mailine gelen bir yanıtın konu başlığı ve içeriği var. Bu yanıtı analiz et ve SADECE aşağıdaki JSON formatında cevap ver, başka hiçbir açıklama ya da metin ekleme:

{"type": "positive" | "negative" | "neutral" | "bounce" | "auto_reply", "documentRequested": true, "reason": "kısa açıklama (Türkçe, tek cümle)"}

Alan açıklamaları:
- "type": Yanıt olumlu mu ("interested", görüşme/numune istiyorlar), olumsuz mu (ilgilenmiyorlar, reddediyorlar), belirsiz mi ("neutral" - net değil, daha fazla bilgi istiyorlar ama ret/kabul değil), bir teslim edilememe/bounce bildirimi mi ("bounce" - otomatik sistem mesajı, "delivery failed", "mailbox not found" gibi, GERÇEK bir insan yanıtı DEĞİL), yoksa bir ofis-dışı/otomatik yanıt mı ("auto_reply" - "out of office", "on vacation", otomatik okundu bilgisi gibi, insan tarafından henüz okunmamış)?
- "documentRequested": Yanıt, göndericiden ilerlemeden önce bir belge/evrak istiyor mu? (örn. iş lisansı, yeniden satış sertifikası (resale/reseller certificate), vergi kimlik no (EIN/Tax ID), W9 formu, distribütörlük/bayilik başvuru formu, ticaret sicil belgesi, kuruluş belgesi, kredi başvurusu vb. resmi bir belge/form talebi varsa true, yoksa false.

Konu: ${subject || "(yok)"}

İçerik:
${(text || "").slice(0, 3000)}`;

  const result = await ai.askClaude(prompt, { maxTokens: 200 });
  if (!result || result.error || !result.text) return null;
  const parsed = ai.extractJson(result.text);
  if (!parsed || typeof parsed !== "object" || !parsed.type) return null;
  return {
    type: parsed.type,
    documentRequested: Boolean(parsed.documentRequested),
    reason: parsed.reason || "",
  };
}

function getImapConfig() {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_APP_PASSWORD) {
    throw new Error("EMAIL_USER / EMAIL_APP_PASSWORD tanımlı değil.");
  }
  return {
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_APP_PASSWORD,
    },
    logger: false,
  };
}

// Tek bir IMAP bağlantısı açıp birden fazla marka için sırayla arama yapar
// (her marka için ayrı bağlantı açmaktan çok daha hızlıdır).
// brandList: [{ id, email, sentAtDate }]
// Döner: { results: Map<brandId, {...}>, errors: string[] }
//   results değeri: { found, snippet, sentiment, from, documentRequested, isBounceLike, aiReason, matchType, error }
async function checkRepliesForMany(brandList) {
  const results = new Map();
  const errors = [];
  if (!brandList || brandList.length === 0) return { results, errors };

  const client = new ImapFlow(getImapConfig());
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      for (const brand of brandList) {
        try {
          const searchCriteria = { from: brand.email };
          if (brand.sentAtDate) searchCriteria.since = brand.sentAtDate;

          let uids = await client.search(searchCriteria);
          let matchType = "exact";

          // Marka adresine gönderdik ama şirketteki başka biri (satış temsilcisi,
          // farklı bir departman vb.) FARKLI bir adresten yanıtlamış olabilir —
          // B2B outreach'te çok sık rastlanan bir durum, ve eskiden sistem bunu
          // hiç yakalayamıyordu (sadece tam eşleşen adresi arıyordu). Tam eşleşme
          // bulunamazsa aynı domain'den gelen mailleri de dene.
          if ((!uids || uids.length === 0) && brand.email && brand.email.includes("@")) {
            const domain = brand.email.split("@")[1];
            if (domain) {
              try {
                const domainCriteria = { from: `@${domain}` };
                if (brand.sentAtDate) domainCriteria.since = brand.sentAtDate;
                const domainUids = await client.search(domainCriteria);
                if (domainUids && domainUids.length > 0) {
                  uids = domainUids;
                  matchType = "domain";
                }
              } catch (e2) {
                // domain araması başarısız olursa yoksay, "bulunamadı" sonucuna devam et
              }
            }
          }

          if (!uids || uids.length === 0) {
            results.set(brand.id, { found: false });
            continue;
          }

          const lastUid = uids[uids.length - 1];
          const message = await client.fetchOne(lastUid, { source: true });
          if (!message || !message.source) {
            results.set(brand.id, { found: false });
            continue;
          }

          const parsed = await simpleParser(message.source);
          const text = extractPlainText(parsed).trim();
          const subject = parsed.subject || "";
          const snippet = text.slice(0, 400);

          // 1) Anahtar kelime tabanlı ilk tahmin (her zaman çalışır, yedek katman)
          let sentiment = guessSentiment(text || subject);
          let documentRequested = guessDocumentRequested(text || subject);
          let isBounceLike = guessBounceLike(text || subject);
          let aiReason = "";

          // 2) Yapay zeka tanımlıysa, daha güvenilir bir sınıflandırma ile üzerine yaz.
          //    (Bazı "yanıt" gibi görünen mailler aslında otomatik bir bounce/OOO olabilir —
          //    AI bunu ayırt edip doğru kategoriye koyar.)
          const aiResult = await classifyReplyWithAI(subject, text);
          if (aiResult) {
            aiReason = aiResult.reason;
            documentRequested = aiResult.documentRequested || documentRequested;
            if (aiResult.type === "bounce") {
              isBounceLike = true;
            } else if (aiResult.type === "auto_reply") {
              sentiment = "neutral";
            } else if (["positive", "negative", "neutral"].includes(aiResult.type)) {
              sentiment = aiResult.type;
            }
          }

          results.set(brand.id, {
            found: true,
            snippet,
            sentiment,
            from: parsed.from ? parsed.from.text : brand.email,
            documentRequested,
            isBounceLike,
            aiReason,
            matchType,
          });
        } catch (e) {
          results.set(brand.id, { found: false, error: e.message });
          errors.push(`${brand.email || brand.id}: ${e.message}`);
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return { results, errors };
}

// Bounce (geri dönen / teslim edilemeyen mail) bildirimlerini gelen kutusunda arar.
// Gmail/Google, teslim edilemeyen mailler için "Mail Delivery Subsystem" gibi bir
// gönderenden bildirim gönderir; bu bildirimin metninde genelde orijinal alıcı
// adresi geçer. Basit bir metin araması ile hangi markanın adresine ait olduğunu
// bulmaya çalışıyoruz — kesin değildir ama pratikte çoğu durumda işe yarar.
// Not: farklı mail sunucuları/servisleri bounce bildirimlerini çok farklı gönderen
// adresi ve konu başlığıyla yollayabilir; bu yüzden liste kasıtlı olarak geniş
// tutuldu (gerçek dünyada rastlanan en yaygın varyasyonları kapsar).
const BOUNCE_SEARCHES = [
  { from: "mailer-daemon" },
  { from: "postmaster" },
  { from: "mail-delivery-subsystem" },
  { from: "mail delivery subsystem" },
  { from: "delivery-notification" },
  { from: "bounce" },
  { subject: "Delivery Status Notification" },
  { subject: "Undelivered Mail" },
  { subject: "Undeliverable" },
  { subject: "Mail delivery failed" },
  { subject: "Address not found" },
  { subject: "Delivery has failed" },
  { subject: "Delivery Failure" },
  { subject: "Returned mail" },
  { subject: "Failure Notice" },
  { subject: "Message not delivered" },
  { subject: "Delivery incomplete" },
  { subject: "Message blocked" },
  { subject: "Mail Delivery System" },
  { subject: "delivery problem" },
  { subject: "could not be delivered" },
  { subject: "Delivery Notification" },
  { subject: "Undeliverable:" },
];

// brandList: [{ id, email, sentAtDate }]
// Döner: { bouncedIds: Set<brandId>, errors: string[] }
async function checkBounces(brandList) {
  const bouncedIds = new Set();
  const errors = [];
  if (!brandList || brandList.length === 0) return { bouncedIds, errors };

  const earliest = brandList.reduce((min, b) => {
    if (!b.sentAtDate) return min;
    if (!min || b.sentAtDate < min) return b.sentAtDate;
    return min;
  }, null);

  const client = new ImapFlow(getImapConfig());
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const allUids = new Set();
      for (const criteria of BOUNCE_SEARCHES) {
        try {
          const search = earliest ? { ...criteria, since: earliest } : criteria;
          const uids = await client.search(search);
          (uids || []).forEach((u) => allUids.add(u));
        } catch (e) {
          errors.push(`Bounce arama kalıbı başarısız (${JSON.stringify(criteria)}): ${e.message}`);
        }
      }

      for (const uid of allUids) {
        try {
          const message = await client.fetchOne(uid, { source: true });
          if (!message || !message.source) continue;
          const parsed = await simpleParser(message.source);
          const fullText = `${parsed.subject || ""} ${extractPlainText(parsed)}`.toLowerCase();

          for (const brand of brandList) {
            if (brand.email && fullText.includes(brand.email.toLowerCase())) {
              bouncedIds.add(brand.id);
            }
          }
        } catch (e) {
          errors.push(`Bounce mesajı okunamadı (uid ${uid}): ${e.message}`);
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return { bouncedIds, errors };
}

// Hızlı bir tanı: sadece bağlanıp gelen kutusundaki toplam/okunmamış mesaj
// sayısını döner, hiçbir tarama yapmaz. "Yanıtları Kontrol Et" 0 sonuç
// döndürdüğünde önce bunu çalıştırarak IMAP kimlik bilgilerinin/erişiminin
// gerçekten çalışıp çalışmadığını saniyeler içinde doğrulayabilirsin.
async function testImapConnection() {
  const client = new ImapFlow(getImapConfig());
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const status = await client.status("INBOX", { messages: true, unseen: true });
      return {
        ok: true,
        user: process.env.EMAIL_USER,
        totalMessages: status.messages,
        unseen: status.unseen,
      };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

module.exports = {
  checkRepliesForMany,
  checkBounces,
  testImapConnection,
  guessSentiment,
  guessDocumentRequested,
  guessBounceLike,
  classifyReplyWithAI,
};
