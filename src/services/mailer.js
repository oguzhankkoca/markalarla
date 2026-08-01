const nodemailer = require("nodemailer");
const db = require("../db");
const { sortAccountsByLeastSent, resolvePublicBaseUrl } = require("./mailerHelpers");

function isConfigured() {
  return Boolean(process.env.EMAIL_USER && process.env.EMAIL_APP_PASSWORD);
}

// Mail gövdesi artık panelde zengin metin (rich text) editöründen geliyor, yani
// kalın/italik/liste gibi biçimlendirme içeren HTML olabilir. Ama eski kaydedilmiş
// düz metin şablonlarla (ya da API'yi doğrudan çağıran biriyle) geriye dönük uyumlu
// kalmak için: gelen metin HTML gibi görünmüyorsa (hiç etiket yoksa) düz metin kabul
// edip kendimiz basit HTML'e çeviriyoruz; HTML ise hem o haliyle gönderiyor hem de
// HTML desteklemeyen mail istemcileri için düz metin bir alternatif çıkarıyoruz.
function looksLikeHtml(str) {
  return /<[a-z][\s\S]*>/i.test(str || "");
}

function escapeHtml(str) {
  return (str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function plainTextToHtml(text) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;white-space:pre-wrap;">${escapeHtml(
    text
  )}</div>`;
}

function htmlToPlainText(html) {
  return (html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// 465 (direkt SSL) bazı hosting sağlayıcılarında engellenebiliyor/zaman aşımına
// uğrayabiliyor. 587 (STARTTLS) daha yaygın desteklenir, o yüzden onu birincil
// yöntem olarak kullanıp gerekirse 465'e otomatik geri düşüyoruz.
function buildTransportOptions(port, secure, account) {
  return {
    host: "smtp.gmail.com",
    port,
    secure, // 465 için true, 587 için false (STARTTLS)
    auth: {
      user: account ? account.email : process.env.EMAIL_USER,
      pass: account ? account.appPassword : process.env.EMAIL_APP_PASSWORD,
    },
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 30000,
  };
}

function assertConfigured() {
  if (!isConfigured()) {
    throw new Error(
      "E-mail hesabı .env dosyasında ayarlanmamış (EMAIL_USER / EMAIL_APP_PASSWORD)."
    );
  }
}

async function trySend(port, secure, mailOptions, account) {
  const transporter = nodemailer.createTransport(buildTransportOptions(port, secure, account));
  return transporter.sendMail(mailOptions);
}

// --- v59: Çoklu gönderici hesabı (round robin) altyapısı ---------------------
// Birincil hesap HER ZAMAN .env'den gelir (EMAIL_USER/EMAIL_APP_PASSWORD) ve bu
// davranış asla değişmez. Ayarlar'da ek hesap TANIMLANMADIYSA, aşağıdaki
// fonksiyonlar sadece birincil hesabı döndürür — yani sistem hiç dokunulmamış
// gibi eskisi gibi çalışmaya devam eder. Ek hesap(lar) tanımlanırsa, gönderimler
// arasında "o gün en az gönderen hesap" seçilerek kabaca eşit dağıtılır.
function getAdditionalSenderAccounts() {
  try {
    const settings = db.prepare("SELECT sender_accounts FROM settings WHERE id = 1").get();
    const raw = settings && settings.sender_accounts;
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((a) => a && a.email && a.appPassword) : [];
  } catch (e) {
    return [];
  }
}

function getAllSenderAccounts() {
  const primary = process.env.EMAIL_USER
    ? {
        email: process.env.EMAIL_USER,
        appPassword: process.env.EMAIL_APP_PASSWORD,
        fromName: process.env.EMAIL_FROM_NAME || process.env.EMAIL_USER,
        isPrimary: true,
      }
    : null;
  const extra = getAdditionalSenderAccounts();
  return primary ? [primary, ...extra] : extra;
}

// Bugün hangi hesaptan kaç mail gitmiş sayısına bakıp en az gönderileni seçer.
// Sadece TEK hesap varsa (ek hesap tanımlanmamışsa) seçim yapmaya gerek yok,
// doğrudan onu döndürür — ekstra DB sorgusu bile atlanır.
function pickSenderAccount() {
  const all = getAllSenderAccounts();
  if (all.length <= 1) return all[0] || null;
  const today = new Date().toISOString().slice(0, 10);
  let counts = [];
  try {
    counts = db
      .prepare("SELECT account_email, sent_count FROM account_daily_stats WHERE date = ?")
      .all(today);
  } catch (e) {
    // tablo yoksa (çok eski bir DB) round robin'siz ilk hesaba düş
  }
  const countMap = new Map(counts.map((c) => [c.account_email, c.sent_count]));
  return sortAccountsByLeastSent(all, countMap)[0];
}

function recordAccountSend(email) {
  if (!email) return;
  const today = new Date().toISOString().slice(0, 10);
  try {
    db.prepare(
      `INSERT INTO account_daily_stats (account_email, date, sent_count) VALUES (?, ?, 1)
       ON CONFLICT(account_email, date) DO UPDATE SET sent_count = sent_count + 1`
    ).run(email, today);
  } catch (e) {
    // istatistik kaydı başarısız olsa bile gönderim zaten yapıldı, akışı bozma
  }
}

// v58: A/B test için açılma (open) takibi — otomatik/toplu gönderimlere görünmez
// bir izleme pikseli ekler. PUBLIC_URL (ya da Render'ın kendi verdiği
// RENDER_EXTERNAL_URL) tanımlı değilse (ör. yerelde çalışırken) piksel adresi
// alıcının erişemeyeceği bir adrese işaret eder haldeyken hiç eklenmez.
function getPublicBaseUrl() {
  return resolvePublicBaseUrl(process.env);
}

// CAN-SPAM Act (ABD'ye ticari mail gönderirken geçerli olan yasa) gönderenin gerçek
// bir fiziksel posta adresini içermesini ZORUNLU kılıyor. Ayarlar'da bir adres
// girildiyse her mailin altına otomatik ekleniyor — hem yasal gereklilik hem de
// spam filtrelerinin "gerçek bir şirket" sinyali olarak baktığı bir unsur. Kullanıcı
// şablonuna elle eklemesine gerek kalmasın diye burada, gönderim anında ekleniyor.
function getCompanyAddress() {
  try {
    const settings = db.prepare("SELECT company_address FROM settings WHERE id = 1").get();
    return settings && settings.company_address ? settings.company_address.trim() : "";
  } catch (e) {
    return "";
  }
}

function appendAddressFooter(htmlBody, textBody, address) {
  if (!address) return { htmlBody, textBody };
  const htmlFooter = `<div style="margin-top:24px;padding-top:12px;border-top:1px solid #ddd;font-size:11px;color:#888;">${escapeHtml(
    address
  )}</div>`;
  const textFooter = `\n\n---\n${address}`;
  return { htmlBody: htmlBody + htmlFooter, textBody: textBody + textFooter };
}

// account: v59 round-robin ile seçilmiş {email, appPassword, fromName} ya da
// undefined/null — undefined ise (varsayılan, eski davranış) .env'deki birincil
// hesap kullanılır, hiçbir şey değişmez.
// trackOpenBrandId: v58 açılma takibi için marka id'si — verilirse ve PUBLIC_URL/
// RENDER_EXTERNAL_URL tanımlıysa mail gövdesine görünmez bir izleme pikseli eklenir.
async function sendMail({ to, subject, body, attachments, account, trackOpenBrandId }) {
  if (!account) assertConfigured();
  const fromEmail = account ? account.email : process.env.EMAIL_USER;
  const fromName = account ? account.fromName || fromEmail : process.env.EMAIL_FROM_NAME || process.env.EMAIL_USER;
  const isHtml = looksLikeHtml(body);
  let htmlBody = isHtml ? body : plainTextToHtml(body);
  let textBody = isHtml ? htmlToPlainText(body) : body;

  const companyAddress = getCompanyAddress();
  ({ htmlBody, textBody } = appendAddressFooter(htmlBody, textBody, companyAddress));

  if (trackOpenBrandId) {
    const baseUrl = getPublicBaseUrl();
    if (baseUrl) {
      htmlBody += `<img src="${baseUrl}/api/track/o/${trackOpenBrandId}" width="1" height="1" alt="" style="display:none;border:0;" />`;
    }
  }

  const mailOptions = {
    from: `"${fromName}" <${fromEmail}>`,
    to,
    subject,
    text: textBody,
    html: htmlBody,
    // Deliverability iyileştirmeleri:
    // - List-Unsubscribe: alıcının mail istemcisinde "abonelikten çık" seçeneği
    //   gösterir; kişi "spam" diye işaretlemek yerine bunu kullanırsa gönderici
    //   itibarın (sender reputation) korunur.
    // - Reply-To: yanıtların gerçek adresine gitmesini garantiler.
    headers: {
      "List-Unsubscribe": `<mailto:${fromEmail}?subject=unsubscribe>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    replyTo: fromEmail,
  };

  // Haftalık veritabanı yedeği gibi dosya ekleri gönderilmek istendiğinde
  // (bkz. services/backup.js) — nodemailer'ın doğal attachments formatını
  // olduğu gibi geçiriyoruz: [{ filename, content: Buffer }] ya da [{ filename, path }].
  if (attachments && attachments.length > 0) {
    mailOptions.attachments = attachments;
  }

  try {
    return await trySend(587, false, mailOptions, account);
  } catch (err587) {
    // 587 başarısız olursa 465'i dene, iki hatayı da birleştirip fırlat
    try {
      return await trySend(465, true, mailOptions, account);
    } catch (err465) {
      throw new Error(
        `587 portu: ${err587.message} | 465 portu: ${err465.message}`
      );
    }
  }
}

module.exports = {
  sendMail,
  isConfigured,
  pickSenderAccount,
  recordAccountSend,
  getAdditionalSenderAccounts,
  sortAccountsByLeastSent,
  getPublicBaseUrl,
};
