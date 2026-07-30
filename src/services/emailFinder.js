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

// Arama sonuçlarında markanın kendi sitesi yerine sıkça çıkan sosyal medya /
// pazar yeri / dizin / haber / ansiklopedi siteleri — bunlar "resmi site" olarak
// kabul edilmez, çünkü üzerlerinde markaya ait bir e-mail bulunmaz ve yanlışlıkla
// seçilirse markanın kendi sitesi yerine alakasız bir sayfa taranmış olur.
const NON_OFFICIAL_DOMAINS = [
  "instagram.com",
  "facebook.com",
  "twitter.com",
  "x.com",
  "linkedin.com",
  "youtube.com",
  "tiktok.com",
  "pinterest.com",
  "amazon.com",
  "amazon.com.tr",
  "ebay.com",
  "wikipedia.org",
  "trendyol.com",
  "hepsiburada.com",
  "yelp.com",
  "crunchbase.com",
  "bloomberg.com",
  "glassdoor.com",
  "indeed.com",
  "n11.com",
  "reddit.com",
  "quora.com",
  "medium.com",
  "trustpilot.com",
  "sitejabber.com",
  "consumeraffairs.com",
  "g2.com",
  "capterra.com",
  "zoominfo.com",
  "owler.com",
  "manta.com",
  "bbb.org",
  "dnb.com",
  "opencorporates.com",
  "yellowpages.com",
  "forbes.com",
  "businesswire.com",
  "prnewswire.com",
  "globenewswire.com",
  "etsy.com",
  "aliexpress.com",
  "alibaba.com",
  "walmart.com",
  "target.com",
  "bestbuy.com",
  "google.com",
  "bing.com",
];

// Yukarıdaki tam domain listesine ek olarak, marka/ülke fark etmeksizin her yerde
// karşımıza çıkabilen büyük pazar yerlerini TLD'den bağımsız yakalamak için desen bazlı kontrol.
const NON_OFFICIAL_PATTERNS = [
  /(^|\.)amazon\./i,
  /(^|\.)ebay\./i,
  /(^|\.)walmart\./i,
  /(^|\.)aliexpress\./i,
  /(^|\.)alibaba\./i,
  /(^|\.)trendyol\./i,
  /(^|\.)hepsiburada\./i,
  /(^|\.)wikipedia\./i,
  /(^|\.)yelp\./i,
  /(^|\.)trustpilot\./i,
];

function isOfficialLookingDomain(domain) {
  if (NON_OFFICIAL_DOMAINS.some((bad) => domain === bad || domain.endsWith(`.${bad}`))) {
    return false;
  }
  if (NON_OFFICIAL_PATTERNS.some((re) => re.test(domain))) return false;
  return true;
}

const COMPANY_SUFFIXES = [
  "inc", "incorporated", "llc", "ltd", "limited", "co", "corp", "corporation",
  "company", "gmbh", "srl", "sa", "plc", "group", "brands", "brand",
  "usa", "international", "global", "holdings",
];

function stripDiacritics(str) {
  return (str || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function normalizeForMatch(str) {
  return stripDiacritics(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function coreBrandTokens(brandName) {
  return stripDiacritics(brandName || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w && !COMPANY_SUFFIXES.includes(w));
}

// Bulunan domain'in gerçekten aranan markaya ait olup olmadığını kabaca kontrol eder.
// Kesin bir doğrulama değildir ama "alakasız bir siteyi markanın sitesi sanma" hatasının
// önüne büyük ölçüde geçer.
function domainMatchesBrand(domain, brandName) {
  const coreDomain = normalizeForMatch((domain || "").split(".")[0]);
  if (!coreDomain) return false;
  const normBrandFull = normalizeForMatch(brandName);
  if (normBrandFull && (coreDomain.includes(normBrandFull) || normBrandFull.includes(coreDomain))) {
    return true;
  }
  const tokens = coreBrandTokens(brandName).sort((a, b) => b.length - a.length);
  const mainToken = tokens[0];
  if (mainToken && mainToken.length >= 3 && coreDomain.includes(mainToken)) return true;
  return false;
}

// Bir aday listesinden marka adıyla en iyi örtüşeni seçer; hiçbiri örtüşmüyorsa
// (bazı markaların domaini gerçekten farklı olabilir) yine de ilk sonucu döner
// ama bunu trace'e "dikkatli kontrol et" notuyla işaretleriz.
function pickBestCandidate(candidates, brandName) {
  if (candidates.length === 0) return null;
  const matched = candidates.find((c) => domainMatchesBrand(c.domain, brandName));
  return matched || candidates[0];
}

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
  // 1) SerpAPI varsa (en güvenilir) — tüm sonuçları toplayıp marka adıyla en iyi
  // örtüşeni seçiyoruz (sadece ilk sonucu almak yerine).
  if (process.env.SERPAPI_KEY) {
    try {
      const { data, status } = await httpClient.get("https://serpapi.com/search.json", {
        params: {
          q: `${brandName} official website`,
          api_key: process.env.SERPAPI_KEY,
          num: 10,
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
        const candidates = [];
        const skipped = [];
        for (const r of results) {
          if (!r.link) continue;
          try {
            const domain = new URL(r.link).hostname.replace(/^www\./, "");
            if (!isOfficialLookingDomain(domain)) {
              skipped.push(domain);
              continue;
            }
            candidates.push({ domain, source: "SerpAPI" });
          } catch (e) {
            continue;
          }
        }
        if (skipped.length > 0) {
          trace.push(`SerpAPI sonuçları sosyal medya/pazar yeri/dizin siteleriydi, atlandı: ${skipped.join(", ")}`);
        }
        if (candidates.length > 0) {
          trace.push(`SerpAPI adayları: ${candidates.map((c) => c.domain).join(", ")}`);
          const best = pickBestCandidate(candidates, brandName);
          if (domainMatchesBrand(best.domain, brandName)) {
            trace.push(`SerpAPI ile bulundu (marka adıyla örtüşüyor): ${best.domain}`);
          } else {
            trace.push(`SerpAPI'den bulundu ama domain adı marka ile tam örtüşmüyor, dikkatli kontrol et: ${best.domain}`);
          }
          return best.domain;
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
    const links = $(".result__a")
      .map((_, el) => $(el).attr("href"))
      .get();
    const candidatesDdg = [];
    const skippedDdg = [];
    for (const link of links) {
      if (!link) continue;
      const urlMatch = link.match(/uddg=([^&]+)/);
      const target = urlMatch ? decodeURIComponent(urlMatch[1]) : link;
      try {
        const domain = new URL(target).hostname.replace(/^www\./, "");
        if (!isOfficialLookingDomain(domain)) {
          skippedDdg.push(domain);
          continue;
        }
        candidatesDdg.push({ domain, source: "DuckDuckGo" });
      } catch (e) {
        continue;
      }
    }
    if (skippedDdg.length > 0) {
      trace.push(`DuckDuckGo sonuçları sosyal medya/pazar yeri/dizin siteleriydi, atlandı: ${skippedDdg.join(", ")}`);
    }
    if (candidatesDdg.length > 0) {
      trace.push(`DuckDuckGo adayları: ${candidatesDdg.map((c) => c.domain).join(", ")}`);
      const best = pickBestCandidate(candidatesDdg, brandName);
      if (domainMatchesBrand(best.domain, brandName)) {
        trace.push(`DuckDuckGo ile bulundu (marka adıyla örtüşüyor): ${best.domain}`);
      } else {
        trace.push(`DuckDuckGo'dan bulundu ama domain adı marka ile tam örtüşmüyor, dikkatli kontrol et: ${best.domain}`);
      }
      return best.domain;
    }
    if (skippedDdg.length === 0) {
      trace.push(`DuckDuckGo yanıt ${status} ama sonuç linki yok (muhtemelen bot engeli).`);
    }
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

// Bir sayfayı hem email hem de "burası bir iletişim sayfası mı" açısından tarar.
// found: sayfada bulunan email adayları
// looksLikeContactPage: sayfa gerçekten erişilebilir VE bir form/iletişim işareti içeriyor mu
async function scrapePage(url, trace) {
  try {
    const { data, status } = await httpClient.get(url);
    if (status >= 400 || typeof data !== "string") {
      trace.push(`${url} -> HTTP ${status}, atlandı.`);
      return { found: [], looksLikeContactPage: false, text: "" };
    }
    const found = data.match(EMAIL_REGEX) || [];
    const $ = cheerio.load(data);
    $("a[href^='mailto:']").each((_, el) => {
      const href = $(el).attr("href") || "";
      const email = href.replace("mailto:", "").split("?")[0];
      if (email) found.push(email);
    });
    const hasForm = $("form").length > 0;
    trace.push(`${url} -> ${found.length} email adayı bulundu${hasForm ? ", bir form içeriyor" : ""}.`);
    return { found, looksLikeContactPage: hasForm, text: $("body").text().slice(0, 5000) };
  } catch (e) {
    trace.push(`${url} -> istek hatası: ${e.message}`);
    return { found: [], looksLikeContactPage: false, text: "" };
  }
}

// Excel'deki "website" sütunu bazen gerçek bir link değil, bir buton/link etiketi
// (örn. "Web Sitesi Ara") ya da başka bir metin içerebilir. Bunu gerçek bir
// domain'den ayırt etmek için basit bir doğrulama yapıyoruz: boşluk içermemeli,
// en az bir nokta içermeli ve sadece domain'de geçerli karakterlerden oluşmalı.
function looksLikeDomain(value) {
  if (!value) return false;
  const cleaned = value.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(cleaned);
}

// E-mail bulunamazsa denenecek, markanın "bize ulaşın" tarzı sayfalarının olası yolları.
const CONTACT_PAGE_PATHS = [
  "/contact",
  "/contact-us",
  "/contactus",
  "/pages/contact",
  "/pages/contact-us",
  "/about/contact",
  "/support",
  "/support/contact",
  "/get-in-touch",
  "/customer-service",
  "/iletisim",
  "/bize-ulasin",
  "/musteri-hizmetleri",
];

async function findBrandEmail(brandName, providedWebsite) {
  const trace = [];
  let domain = null;

  if (providedWebsite && looksLikeDomain(providedWebsite)) {
    domain = providedWebsite.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
    trace.push(`Excel'den verilen website kullanıldı: ${domain}`);
  } else {
    if (providedWebsite) {
      trace.push(`Excel'deki website değeri geçerli bir domain gibi görünmüyor ("${providedWebsite}"), aramaya geçiliyor.`);
    }
    domain = await findOfficialDomainViaSearch(brandName, trace);
  }

  if (!domain) {
    trace.push("Hiçbir yöntemle resmi site/domain bulunamadı.");
    return { email: null, website: null, source: null, confidence: "not_found", contactUrl: null, trace };
  }

  const website = `https://${domain}`;

  // Seçilen domain gerçekten markaya mı ait, yoksa alakasız bir site mi taranıyor —
  // ana sayfayı çekip marka adının sayfada geçip geçmediğine bakarak basit bir
  // sağlama yapıyoruz. Kesin değildir ama yanlış siteye yazılan mailleri azaltır.
  let homepageLooksRelated = true;
  try {
    const home = await scrapePage(website, trace);
    const normPageText = normalizeForMatch(home.text);
    const mainToken = coreBrandTokens(brandName).sort((a, b) => b.length - a.length)[0];
    if (mainToken && mainToken.length >= 3 && !normPageText.includes(mainToken)) {
      homepageLooksRelated = false;
      trace.push(`Uyarı: "${brandName}" adı ${website} ana sayfasında geçmiyor, yanlış site seçilmiş olabilir — göndermeden önce kontrol et.`);
    }
  } catch (e) {
    // ana sayfa sağlaması başarısız olursa sessizce devam et, kritik değil
  }

  const hunterEmails = await findEmailsViaHunter(domain, trace);
  if (hunterEmails.length > 0) {
    const cleaned = cleanEmails(hunterEmails, domain);
    if (cleaned.length > 0) {
      return {
        email: cleaned[0].email,
        website,
        source: "hunter.io",
        confidence: cleaned[0].sameDomain && homepageLooksRelated ? "high" : "medium",
        contactUrl: null,
        trace,
      };
    }
  }

  const pathsToTry = ["", ...CONTACT_PAGE_PATHS];
  let allEmails = [];
  let contactUrl = null;
  for (const p of pathsToTry) {
    const result = await scrapePage(website + p, trace);
    allEmails = allEmails.concat(result.found);
    if (!contactUrl && p !== "" && result.looksLikeContactPage) {
      contactUrl = website + p;
    }
    await sleep(300);
    if (allEmails.length > 0 && p !== "") break;
  }

  const cleaned = cleanEmails(allEmails, domain);
  if (cleaned.length === 0) {
    trace.push(
      contactUrl
        ? `Sitede email bulunamadı ama bir iletişim formu tespit edildi: ${contactUrl}`
        : "Sitede/iletişim sayfalarında hiç email ya da form bulunamadı."
    );
    return {
      email: null,
      website,
      source: "site_taramasi",
      confidence: "not_found",
      contactUrl,
      trace,
    };
  }
  return {
    email: cleaned[0].email,
    website,
    source: "site_taramasi",
    confidence: cleaned[0].sameDomain && homepageLooksRelated ? "high" : "low",
    contactUrl: null,
    trace,
  };
}

module.exports = { findBrandEmail };
