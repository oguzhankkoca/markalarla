const nodemailer = require("nodemailer");

function isConfigured() {
  return Boolean(process.env.EMAIL_USER && process.env.EMAIL_APP_PASSWORD);
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
  const mailOptions = {
    from: `"${fromName}" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    text: body,
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
