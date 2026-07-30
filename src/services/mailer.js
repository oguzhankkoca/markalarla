const nodemailer = require("nodemailer");

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
function buildTransportOptions(port, secure) {
  return {
    host: "smtp.gmail.com",
    port,
    secure, // 465 için true, 587 için false (STARTTLS)
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_APP_PASSWORD,
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

async function trySend(port, secure, mailOptions) {
  const transporter = nodemailer.createTransport(buildTransportOptions(port, secure));
  return transporter.sendMail(mailOptions);
}

async function sendMail({ to, subject, body }) {
  assertConfigured();
  const fromName = process.env.EMAIL_FROM_NAME || process.env.EMAIL_USER;
  const isHtml = looksLikeHtml(body);
  const htmlBody = isHtml ? body : plainTextToHtml(body);
  const textBody = isHtml ? htmlToPlainText(body) : body;

  const mailOptions = {
    from: `"${fromName}" <${process.env.EMAIL_USER}>`,
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
      "List-Unsubscribe": `<mailto:${process.env.EMAIL_USER}?subject=unsubscribe>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    replyTo: process.env.EMAIL_USER,
  };

  try {
    return await trySend(587, false, mailOptions);
  } catch (err587) {
    // 587 başarısız olursa 465'i dene, iki hatayı da birleştirip fırlat
    try {
      return await trySend(465, true, mailOptions);
    } catch (err465) {
      throw new Error(
        `587 portu: ${err587.message} | 465 portu: ${err465.message}`
      );
    }
  }
}

module.exports = { sendMail, isConfigured };
