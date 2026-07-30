const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");

// Basit anahtar kelime tabanlı olumlu/olumsuz tahmini.
// Kesin bir yapay zeka analizi değildir, sadece hızlı bir ilk fikir verir.
// Kullanıcı arayüzde sonucu her zaman elle değiştirebilir.
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

function guessSentiment(text) {
  const lower = (text || "").toLowerCase();
  const hasPositive = POSITIVE_KEYWORDS.some((k) => lower.includes(k));
  const hasNegative = NEGATIVE_KEYWORDS.some((k) => lower.includes(k));
  if (hasNegative && !hasPositive) return "negative";
  if (hasPositive && !hasNegative) return "positive";
  return "neutral"; // emin değiliz, elle kontrol gerekir
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
// Döner: Map<brandId, { found, snippet, sentiment, from }>
async function checkRepliesForMany(brandList) {
  const results = new Map();
  if (!brandList || brandList.length === 0) return results;

  const client = new ImapFlow(getImapConfig());
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      for (const brand of brandList) {
        try {
          const searchCriteria = { from: brand.email };
          if (brand.sentAtDate) searchCriteria.since = brand.sentAtDate;

          const uids = await client.search(searchCriteria);
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
          const text = (parsed.text || "").trim();
          const snippet = text.slice(0, 400);
          const sentiment = guessSentiment(text || parsed.subject || "");

          results.set(brand.id, {
            found: true,
            snippet,
            sentiment,
            from: parsed.from ? parsed.from.text : brand.email,
          });
        } catch (e) {
          results.set(brand.id, { found: false, error: e.message });
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return results;
}

// Bounce (geri dönen / teslim edilemeyen mail) bildirimlerini gelen kutusunda arar.
// Gmail/Google, teslim edilemeyen mailler için "Mail Delivery Subsystem" gibi bir
// gönderenden bildirim gönderir; bu bildirimin metninde genelde orijinal alıcı
// adresi geçer. Basit bir metin araması ile hangi markanın adresine ait olduğunu
// bulmaya çalışıyoruz — kesin değildir ama pratikte çoğu durumda işe yarar.
const BOUNCE_SEARCHES = [
  { from: "mailer-daemon" },
  { from: "postmaster" },
  { from: "mail-delivery-subsystem" },
  { subject: "Delivery Status Notification" },
  { subject: "Undelivered Mail" },
  { subject: "Mail delivery failed" },
  { subject: "Address not found" },
];

// brandList: [{ id, email, sentAtDate }]
// Döner: Set<brandId> (bounce tespit edilen markaların id'leri)
async function checkBounces(brandList) {
  const bouncedIds = new Set();
  if (!brandList || brandList.length === 0) return bouncedIds;

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
          // bir arama türü başarısız olursa diğerlerine devam et
        }
      }

      for (const uid of allUids) {
        try {
          const message = await client.fetchOne(uid, { source: true });
          if (!message || !message.source) continue;
          const parsed = await simpleParser(message.source);
          const fullText = `${parsed.subject || ""} ${parsed.text || ""}`.toLowerCase();

          for (const brand of brandList) {
            if (brand.email && fullText.includes(brand.email.toLowerCase())) {
              bouncedIds.add(brand.id);
            }
          }
        } catch (e) {
          // tek bir mesaj okunamazsa atla
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return bouncedIds;
}

module.exports = { checkRepliesForMany, checkBounces, guessSentiment };
