const axios = require("axios");
const cheerio = require("cheerio");

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const GENERIC_LOCAL_PARTS = [
  "info",
  "contact",
  "iletisim",
  "sales",
  "hello",
  "support",
  "business",
  "partnership",
  "partnerships",
  "wholesale",
  "press",
];
const BAD_DOMAINS = [
  "sentry.io",
  "example.com",
  "wixpress.com",
  "godaddy.com",
  "cloudflare.com",
  "schema.org",
];

const httpClient = axios.create({
  timeout: 10000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  },
  validateStatus: () => true,
});

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function cleanEmails(rawEmails, domain) {
  const seen = new Set();
  const list = [];
  for (const raw of rawEmails) {
    const email = raw.trim().toLowerCase().replace(/[.,;]+$/, "");
    if (seen.has(email)) continue;
    seen.add(email);
    const emailDomain = email.split("@")[1] || "";
    if (BAD_DOMAINS.some((bad) => emailDomain.includes(bad))) continue;
    if (/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(email)) continue;
    list.push({
      email,
      sameDomain: domain ? emailDomain.includes(domain) : false,
      generic: GENERIC_LOCAL_PARTS.includes(email.split("@")[0]),
    });
  }
