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
  list.sort((a, b) => {
    const score = (x) => (x.sameDomain ? 2 : 0) + (!x.generic ? 1 : 0);
    return score(b) - score(a);
  });
  return list;
}

async function findOfficialDomainViaSearch(brandName) {
  if (process.env.SERPAPI_KEY) {
    try {
      const { data } = await httpClient.get("https://serpapi.com/search.json", {
        params: {
          q: `${brandName} official website`,
          api_key: process.env.SERPAPI_KEY,
          num: 5,
        },
      });
      const results = data.organic_results || [];
      for (const r of results) {
        if (r.link) return new URL(r.link).hostname.replace(/^www\./, "");
      }
      console.log(`[${brandName}] SerpAPI sonuç döndürmedi.`);
    } catch (e) {
      console.error(`[${brandName}] SerpAPI hata:`, e.message);
    }
  }

  try {
    const { data, status } = await httpClient.get("https://html.duckduckgo.com/html/", {
      params: { q: `${brandName} official website` },
    });
    console.log(`[${brandName}] DuckDuckGo yanıt kodu: ${status}`);
    const $ = cheerio.load(data);
    const link = $(".result__a").first().attr("href");
    if (link) {
      const urlMatch = link.match(/uddg=([^&]+)/);
      const target = urlMatch ? decodeURIComponent(urlMatch[1]) : link;
      const domain = new URL(target).hostname.replace(/^www\./, "");
      console.log(`[${brandName}] DuckDuckGo'dan bulunan domain: ${domain}`);
      return domain;
    }
    console.log(`[${brandName}] DuckDuckGo sonuç linki bulunamadı (muhtemelen bot engeli/CAPTCHA).`);
  } catch (e) {
    console.error(`[${brandName}] DuckDuckGo arama hatası:`, e.message);
  }

  const guess = brandName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
  if (guess) {
    const guessedDomain = `${guess}.com`;
    try {
      const { status } = await httpClient.get(`https://${guessedDomain}`, { timeout: 6000 });
      if (status < 400) {
        console.log(`[${brandName}] Tahmin edilen domain çalışıyor: ${guessedDomain}`);
        return guessedDomain;
      }
      console.log(`[${brandName}] Tahmin edilen domain (${guessedDomain}) yanıt kodu: ${status}`);
    } catch (e) {
      console.log(`[${brandName}] Tahmin edilen domain (${guessedDomain}) çalışmadı: ${e.message}`);
    }
  }

  return null;
}

async function findEmailsViaHunter(domain) {
  if (!process.env.HUNTER_API_KEY || !domain) return [];
  try {
    const { data } = await httpClient.get("https://api.hunter.io/v2/domain-search", {
      params: { domain, api_key: process.env.HUNTER_API_KEY, limit: 10 },
    });
    const emails = (data.data?.emails || []).map((e) => e.value);
    if (data.data?.organization && data.data?.emails?.length === 0) return [];
    return emails;
  } catch (e) {
    console.error("Hunter.io hata:", e.message);
    return [];
  }
}

async function scrapePageForEmails(url) {
  try {
    const { data, status } = await httpClient.get(url);
    if (status >= 400 || typeof data !== "string") return [];
    const found = data.match(EMAIL_REGEX) || [];
    const $ = cheerio.load(data);
    $("a[href^='mailto:']").each((_, el) => {
      const href = $(el).attr("href") || "";
      const email = href.replace("mailto:", "").split("?")[0];
      if (email) found.push(email);
    });
    return found;
  } catch (e) {
    return [];
  }
}

async function findBrandEmail(brandName, providedWebsite) {
  let domain = providedWebsite
    ? providedWebsite.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]
    : null;

  if (!domain) {
    domain = await findOfficialDomainViaSearch(brandName);
  }

  if (!domain) {
    return { email: null, website: null, source: null, confidence: "not_found" };
  }

  const website = `https://${domain}`;

  const hunterEmails = await findEmailsViaHunter(domain);
  if (hunterEmails.length > 0) {
    const cleaned = cleanEmails(hunterEmails, domain);
    if (cleaned.length > 0) {
      return {
        email: cleaned[0].email,
        website,
        source: "hunter.io",
        confidence: cleaned[0].sameDomain ? "high" : "medium",
      };
    }
  }

  const pathsToTry = ["", "/contact", "/contact-us", "/iletisim", "/about", "/hakkimizda"];
  let allEmails = [];
  for (const p of pathsToTry) {
    const emails = await scrapePageForEmails(website + p);
    allEmails = allEmails.concat(emails);
    await sleep(300);
    if (allEmails.length > 0 && p !== "") break;
  }

  const cleaned = cleanEmails(allEmails, domain);
  if (cleaned.length === 0) {
    return { email: null, website, source: "site_taramasi", confidence: "not_found" };
  }
  return {
    email: cleaned[0].email,
    website,
    source: "site_taramasi",
    confidence: cleaned[0].sameDomain ? "high" : "low",
  };
}

module.exports = { findBrandEmail };
