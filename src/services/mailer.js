const nodemailer = require("nodemailer");

function isConfigured() {
  return Boolean(process.env.EMAIL_USER && process.env.EMAIL_APP_PASSWORD);
}

function getTransporter() {
  if (!isConfigured()) {
    throw new Error(
      "E-mail hesabı .env dosyasında ayarlanmamış (EMAIL_USER / EMAIL_APP_PASSWORD)."
    );
  }
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_APP_PASSWORD,
    },
  });
}

async function sendMail({ to, subject, body }) {
  const transporter = getTransporter();
  const fromName = process.env.EMAIL_FROM_NAME || process.env.EMAIL_USER;
  return transporter.sendMail({
    from: `"${fromName}" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    text: body,
  });
}

module.exports = { sendMail, isConfigured };
