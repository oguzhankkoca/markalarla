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

async function findOfficialDomainViaSearch(brandName, trace) {
  // 1) SerpAPI varsa (en güvenilir)
  if (process.env.SERPAPI_KEY) {
    try {
      const { data, status } = await httpClient.get("https://serpapi.com/search.json", {
        params: {
          q: `${brandName} official website`,
          api_key: process.env.SERPAPI_KEY,
          num: 5,
        },
      });
      if (status !== 200) {
        trace.push(`SerpAPI HTTP ${status}: ${JSON.stringify(data).slice(0, 200)}`);
      } else if (data.error) {
        trace.push(`SerpAPI hata döndürdü: ${data.error}`);
      } else {
        const results = data.organic_results || [];
        if (results.length === 0) {
          trace.push("SerpAPI 200 döndü ama organic_results boş.");
        }
        for (const r of results) {
          if (r.link) {
            const domain = new URL(r.link).hostname.replace(/^www\./, "");
            trace.push(`SerpAPI ile bulundu: ${domain}`);
            return domain;
          }
        }
      }
    } catch (e) {
      trace.push(`SerpAPI istek hatası: ${e.message}`);
    }
  } else {
    trace.push("SERPAPI_KEY tanımlı değil, atlandı.");
  }

  // 2) Ücretsiz fallback: DuckDuckGo HTML arama (bulut IP'lerinden çoğu zaman engellenir)
  try {
    const { data, status } = await httpClient.get("https://html.duckduckgo.com/html/", {
      params: { q: `${brandName} official website` },
    });
    const $ = cheerio.load(data);
    const link = $(".result__a").first().attr("href");
    if (link) {
      const urlMatch = link.match(/uddg=([^&]+)/);
      const target = urlMatch ? decodeURIComponent(urlMatch[1]) : link;
      const domain = new URL(target).hostname.replace(/^www\./, "");
      trace.push(`DuckDuckGo ile bulundu: ${domain}`);
      return domain;
    }
    trace.push(`DuckDuckGo yanıt ${status} ama sonuç linki yok (muhtemelen bot engeli).`);
  } catch (e) {
    trace.push(`DuckDuckGo istek hatası: ${e.message}`);
  }

  // 3) Son çare: marka adından direkt domain tahmini
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
        trace.push(`Tahmin edilen domain çalışıyor: ${guessedDomain}`);
        return guessedDomain;
      }
      trace.push(`Tahmin edilen domain (${guessedDomain}) yanıt kodu: ${status}`);
    } catch (e) {
      trace.push(`Tahmin edilen domain (${guessedDomain}) ulaşılamadı: ${e.message}`);
    }
  }

  return null;
}

async function findEmailsViaHunter(domain, trace) {
  if (!process.env.HUNTER_API_KEY) {
    trace.push("HUNTER_API_KEY tanımlı değil, atlandı.");
    return [];
  }
  if (!domain) return [];
  try {
    const { data, status } = await httpClient.get("https://api.hunter.io/v2/domain-search", {
      params: { domain, api_key: process.env.HUNTER_API_KEY, limit: 10 },
    });
    if (status !== 200) {
      trace.push(`Hunter.io HTTP ${status}: ${JSON.stringify(data).slice(0, 200)}`);
      return [];
    }
    const emails = (data.data?.emails || []).map((e) => e.value);
    trace.push(`Hunter.io ${emails.length} email döndürdü.`);
    return emails;
  } catch (e) {
    trace.push(`Hunter.io istek hatası: ${e.message}`);
    return [];
  }
}

async function scrapePageForEmails(url, trace) {
  try {
    const { data, status } = await httpClient.get(url);
    if (status >= 400 || typeof data !== "string") {
      trace.push(`${url} -> HTTP ${status}, atlandı.`);
      return [];
    }
    const found = data.match(EMAIL_REGEX) || [];
    const $ = cheerio.load(data);
    $("a[href^='mailto:']").each((_, el) => {
      const href = $(el).attr("href") || "";
      const email = href.replace("mailto:", "").split("?")[0];
      if (email) found.push(email);
    });
    trace.push(`${url} -> ${found.length} email adayı bulundu.`);
    return found;
  } catch (e) {
    trace.push(`${url} -> istek hatası: ${e.message}`);
    return [];
  }
}

async function findBrandEmail(brandName, providedWebsite) {
  const trace = [];
  let domain = providedWebsite
    ? providedWebsite.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]
    : null;

  if (domain) {
    trace.push(`Excel'den verilen website kullanıldı: ${domain}`);
  } else {
    domain = await findOfficialDomainViaSearch(brandName, trace);
  }

  if (!domain) {
    trace.push("Hiçbir yöntemle resmi site/domain bulunamadı.");
    return { email: null, website: null, source: null, confidence: "not_found", trace };
  }

  const website = `https://${domain}`;

  const hunterEmails = await findEmailsViaHunter(domain, trace);
  if (hunterEmails.length > 0) {
    const cleaned = cleanEmails(hunterEmails, domain);
    if (cleaned.length > 0) {
      return {
        email: cleaned[0].email,
        website,
        source: "hunter.io",
        confidence: cleaned[0].sameDomain ? "high" : "medium",
        trace,
      };
    }
  }

  const pathsToTry = ["", "/contact", "/contact-us", "/iletisim", "/about", "/hakkimizda"];
  let allEmails = [];
  for (const p of pathsToTry) {
    const emails = await scrapePageForEmails(website + p, trace);
    allEmails = allEmails.concat(emails);
    await sleep(300);
    if (allEmails.length > 0 && p !== "") break;
  }

  const cleaned = cleanEmails(allEmails, domain);
  if (cleaned.length === 0) {
    trace.push("Sitede/iletişim sayfalarında hiç email bulunamadı.");
    return { email: null, website, source: "site_taramasi", confidence: "not_found", trace };
  }
  return {
    email: cleaned[0].email,
    website,
    source: "site_taramasi",
    confidence: cleaned[0].sameDomain ? "high" : "low",
    trace,
  };
}

module.exports = { findBrandEmail };
