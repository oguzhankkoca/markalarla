const axios = require("axios");
const cheerio = require("cheerio");
const ai = require("./ai");

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
  // Haber / ansiklopedi / referans siteleri — arama sonuçlarında bir markanın adı
  // bir haberde/makalede geçtiği için sıkça çıkar ama markanın kendi sitesi değildir.
  "history.com",
  "biography.com",
  "britannica.com",
  "nytimes.com",
  "cnn.com",
  "bbc.com",
  "bbc.co.uk",
  "npr.org",
  "reuters.com",
  "apnews.com",
  "usatoday.com",
  "imdb.com",
  "smithsonianmag.com",
  "history.state.gov",
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
  // Amazon'da satılan markalar ticari şirketlerdir — bir markanın "resmi sitesi"
  // neredeyse HİÇBİR ZAMAN bir devlet kurumu (.gov), askeri (.mil) ya da eğitim
  // kurumu (.edu) sitesi olamaz. Bunlar ülke koduyla da gelebilir (gov.uk, gov.tr,
  // mil.tr, edu.tr, europa.eu vb.) — TLD'nin sonu ".gov"/".mil"/".edu" ile bitiyorsa
  // ya da bunlardan hemen önce bir nokta varsa (gov.xx gibi) engelle.
  /\.gov(\.[a-z]{2,3})?$/i,
  /\.mil(\.[a-z]{2,3})?$/i,
  /\.edu(\.[a-z]{2,3})?$/i,
  /(^|\.)europa\.eu$/i,
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

// Arama sağlayıcılarından biri kotasını bitirdiğinde (429 ya da "run out of
// searches" gibi bir hata), aynı toplu arama (find-all) çalışması boyunca her
// marka için tekrar tekrar başarısız istek atıp zaman kaybetmemek için kısa süreli
// bir "dinlenmeye al" bayrağı tutuyoruz. Süre dolunca otomatik tekrar dener.
let serperRestUntil = 0;
let serpApiRestUntil = 0;
const QUOTA_KEYWORDS = ["run out", "quota", "exceeded", "no searches left", "insufficient credit", "insufficient balance", "out of credits"];

// ÖNEMLİ: Bu kontrol SADECE API'nin kendi hata alanına (data.error / data.message /
// data.statusMessage gibi) bakar — TÜM yanıtı (arama sonuçlarındaki başlık/özet
// metinleri dahil) taramaz. Eskiden tüm JSON stringify edilip aranıyordu; bu da
// "White House Historical Association" gibi bir arama sonucunun özetinde geçen
// tamamen alakasız bir "limit" ya da "exceeded" kelimesi yüzünden BAŞARILI (HTTP 200,
// gerçek sonuçlarla dolu) bir yanıtın bile yanlışlıkla "kota bitti" sanılmasına ve
// Serper.dev/SerpAPI'nin bir saat boyunca gereksiz yere devre dışı kalmasına yol
// açıyordu — kullanıcı panelde kotasının hâlâ dolu olduğunu görse bile.
function isQuotaError(status, data) {
  if (status === 429 || status === 402) return true;
  if (!data || typeof data !== "object") return false;
  const errorText = String(data.error || data.message || data.statusMessage || "").toLowerCase();
  if (!errorText) return false;
  return QUOTA_KEYWORDS.some((k) => errorText.includes(k));
}

// Bir arama sonuç listesinden (her provider {url, title, snippet} biçiminde ya da
// düz bir url string'i verebilir) resmi görünen domain adaylarını çıkarır, sosyal
// medya/pazar yeri gibi olanları atlar. title/snippet, AI doğrulaması yapılırken
// bağlam olarak kullanılır (varsa).
function extractCandidates(results, sourceName, trace) {
  const candidates = [];
  const skipped = [];
  for (const r of results) {
    const url = typeof r === "string" ? r : r && r.url;
    if (!url) continue;
    try {
      const domain = new URL(url).hostname.replace(/^www\./, "");
      if (!isOfficialLookingDomain(domain)) {
        skipped.push(domain);
        continue;
      }
      candidates.push({
        domain,
        source: sourceName,
        title: typeof r === "object" ? r.title : undefined,
        snippet: typeof r === "object" ? r.snippet : undefined,
      });
    } catch (e) {
      continue;
    }
  }
  if (skipped.length > 0) {
    trace.push(`${sourceName} sonuçları sosyal medya/pazar yeri/dizin siteleriydi, atlandı: ${skipped.join(", ")}`);
  }
  return candidates;
}

// Arama sonuçları arasından Claude'a "bunlardan hangisi gerçekten bu markanın resmi
// sitesi?" diye sorar. Yalnızca heuristik (kelime eşleştirme) emin olamadığında
// çağrılır — kolay/net eşleşmelerde AI'a hiç gidilmez, böylece hem hızlı kalır hem
// de gereksiz API maliyeti oluşmaz.
async function pickBestDomainWithAI(brandName, candidates, trace) {
  if (!ai.isConfigured() || candidates.length === 0) return null;
  const list = candidates
    .map((c, i) => {
      const bits = [`domain: ${c.domain}`];
      if (c.title) bits.push(`başlık: ${c.title}`);
      if (c.snippet) bits.push(`özet: ${c.snippet}`);
      return `${i + 1}. ${bits.join(" | ")}`;
    })
    .join("\n");
  const prompt = `Bir Amazon toptan satış şirketi için marka web sitesi doğrulaması yapıyorsun.
Aranan marka: "${brandName}"

Google arama sonuçlarından bulunan aday domainler:
${list}

Bu adaylardan hangisi "${brandName}" markasının GERÇEK, RESMİ web sitesidir? Sosyal medya,
pazar yeri (Amazon/eBay/Trendyol/Etsy vb.), haber sitesi, inceleme/dizin sitesi ya da tamamen
alakasız bir şirketse SEÇME. Emin değilsen index'i null bırak, tahmin yürütme.

Sadece şu JSON formatında cevap ver, başka hiçbir açıklama ekleme:
{"index": <1'den başlayan aday numarası ya da null>, "confidence": "high"|"medium"|"low", "reason": "kısa Türkçe açıklama"}`;

  const result = await ai.askClaude(prompt, { maxTokens: 200 });
  if (!result) return null;
  if (result.error) {
    trace.push(`AI doğrulama hatası (domain seçimi): ${result.error}`);
    return null;
  }
  const parsed = ai.extractJson(result.text);
  if (!parsed || !parsed.index || parsed.index < 1 || parsed.index > candidates.length) {
    trace.push(`AI: adaylar arasında güvenilir bir eşleşme bulamadı${parsed?.reason ? ` (${parsed.reason})` : ""}.`);
    return null;
  }
  const picked = candidates[parsed.index - 1];
  trace.push(`AI doğrulaması: "${picked.domain}" seçildi (güven: ${parsed.confidence || "?"}) — ${parsed.reason || ""}`);
  return { domain: picked.domain, confidence: parsed.confidence };
}

// ÖNEMLİ: Bu fonksiyon artık TEK bir domain değil, ÖNCELİK SIRALI bir domain listesi
// döner. Eskiden sadece "en iyi" adayı seçip onu geri veriyorduk; o aday daha sonra
// ana sayfa doğrulamasından geçemezse (örn. gerçekten markaya ait değilse) elimizde
// başka seçenek kalmıyordu ve sistem yine de o (muhtemelen yanlış) siteyi kullanmaya
// devam ediyordu. Artık aday listesinin tamamını sırayla döndürüyoruz ki çağıran taraf
// (findOfficialDomainViaSearch) ilk aday doğrulamayı geçemezse bir sonrakini —
// aynı arama sonucundan, EK bir API isteği harcamadan — deneyebilsin.
async function rankCandidateDomains(candidates, sourceName, brandName, trace) {
  if (candidates.length === 0) return [];
  trace.push(`${sourceName} adayları: ${candidates.map((c) => c.domain).join(", ")}`);

  const matched = candidates.filter((c) => domainMatchesBrand(c.domain, brandName));
  const unmatched = candidates.filter((c) => !domainMatchesBrand(c.domain, brandName));
  let ordered = [...matched, ...unmatched];

  // Heuristik hiçbir adayı net eşleştiremediyse (marka adı hiçbir domain'de
  // görünmüyorsa), AI tanımlıysa ikinci bir görüş alıp onun seçimini listenin başına alıyoruz.
  if (matched.length === 0 && ai.isConfigured()) {
    const aiPick = await pickBestDomainWithAI(brandName, candidates, trace);
    if (aiPick && aiPick.domain) {
      trace.push(`${sourceName}: AI'ın seçimi heuristikten daha güvenilir kabul edildi, öne alınıyor.`);
      ordered = [{ domain: aiPick.domain }, ...ordered.filter((c) => c.domain !== aiPick.domain)];
    }
  }

  if (matched.length > 0) {
    trace.push(`${sourceName}: marka adıyla örtüşen adaylar önce denenecek: ${matched.map((c) => c.domain).join(", ")}`);
  }

  const seen = new Set();
  const uniqueDomains = [];
  for (const c of ordered) {
    if (seen.has(c.domain)) continue;
    seen.add(c.domain);
    uniqueDomains.push(c.domain);
  }
  return uniqueDomains;
}

// Bazı markalar tek bir arama ifadesiyle bulunamıyor (küçük/az bilinen markalar,
// ortak bir kelimeyle çakışan isimler, vb.). Bunun için birden fazla arama ifadesi
// deniyoruz — ama sadece bir öncekinden HİÇBİR sonuç çıkmadıysa bir sonrakine
// geçiyoruz, böylece kolay bulunan markalarda tek istekle bitiyor (API kotası boşa
// harcanmıyor), sadece zor markalarda ekstra deneme yapılıyor.
// 3. ifade tam olarak kullanıcının önerdiği "marka adı .com diye Google'da ara"
// fikrini uyguluyor — önceki sürümde bu sadece tek bir siteye direkt bağlanıp
// deneniyordu (arama değildi), şimdi gerçekten Google/DuckDuckGo'da aratılıyor.
const SEARCH_QUERY_VARIANTS = [
  (brand) => `${brand} official website`,
  (brand) => `${brand} official site -site:amazon.com -site:instagram.com -site:facebook.com -site:ebay.com`,
  (brand) => `${brand}.com`,
  (brand) => `${brand} brand homepage contact`,
];

// Serper.dev — SerpAPI ile aynı işi (Google arama sonuçlarından resmi site bulma)
// çok daha düşük dolar/arama maliyetiyle yapan alternatif sağlayıcı. Tanımlıysa
// SerpAPI'den önce denenir (daha ucuz olduğu için kotayı burada tüketmek mantıklı).
async function searchViaSerper(brandName, trace, query) {
  if (!process.env.SERPER_API_KEY) {
    trace.push("SERPER_API_KEY tanımlı değil, atlandı.");
    return null;
  }
  const resting = Date.now() < serperRestUntil;
  if (resting) {
    trace.push("Serper.dev kotası yakın zamanda bittiği için bu marka için atlanıyor.");
    return null;
  }
  try {
    const { data, status } = await httpClient.post(
      "https://google.serper.dev/search",
      { q: query },
      { headers: { "X-API-KEY": process.env.SERPER_API_KEY, "Content-Type": "application/json" } }
    );
    if (isQuotaError(status, data)) {
      serperRestUntil = Date.now() + 60 * 60 * 1000;
      trace.push(`Serper.dev kotası bitmiş görünüyor (HTTP ${status}), 1 saat boyunca atlanacak.`);
      return null;
    }
    if (status !== 200) {
      trace.push(`Serper.dev HTTP ${status}: ${JSON.stringify(data).slice(0, 200)}`);
      return null;
    }
    const results = data.organic || [];
    if (results.length === 0) {
      trace.push(`Serper.dev ("${query}") 200 döndü ama organic sonuç boş.`);
      return null;
    }
    const candidates = extractCandidates(
      results.map((r) => ({ url: r.link, title: r.title, snippet: r.snippet })),
      "Serper.dev",
      trace
    );
    return rankCandidateDomains(candidates, "Serper.dev", brandName, trace);
  } catch (e) {
    trace.push(`Serper.dev istek hatası: ${e.message}`);
    return null;
  }
}

async function searchViaSerpApi(brandName, trace, query) {
  if (!process.env.SERPAPI_KEY) {
    trace.push("SERPAPI_KEY tanımlı değil, atlandı.");
    return null;
  }
  const resting = Date.now() < serpApiRestUntil;
  if (resting) {
    trace.push("SerpAPI kotası yakın zamanda bittiği için bu marka için atlanıyor.");
    return null;
  }
  try {
    const { data, status } = await httpClient.get("https://serpapi.com/search.json", {
      params: {
        q: query,
        api_key: process.env.SERPAPI_KEY,
        num: 10,
      },
    });
    if (isQuotaError(status, data)) {
      serpApiRestUntil = Date.now() + 60 * 60 * 1000;
      trace.push(`SerpAPI kotası bitmiş görünüyor (HTTP ${status}), 1 saat boyunca atlanacak.`);
      return null;
    }
    if (status !== 200) {
      trace.push(`SerpAPI HTTP ${status}: ${JSON.stringify(data).slice(0, 200)}`);
      return null;
    }
    if (data.error) {
      trace.push(`SerpAPI hata döndürdü: ${data.error}`);
      return null;
    }
    const results = data.organic_results || [];
    if (results.length === 0) {
      trace.push(`SerpAPI ("${query}") 200 döndü ama organic_results boş.`);
      return null;
    }
    const candidates = extractCandidates(
      results.map((r) => ({ url: r.link, title: r.title, snippet: r.snippet })),
      "SerpAPI",
      trace
    );
    return rankCandidateDomains(candidates, "SerpAPI", brandName, trace);
  } catch (e) {
    trace.push(`SerpAPI istek hatası: ${e.message}`);
    return null;
  }
}

// Ücretsiz fallback: DuckDuckGo HTML arama (bulut IP'lerinden çoğu zaman engellenir).
// Render gibi bulut sunuculardan DuckDuckGo'ya istek bazen 10 saniyede yanıt vermeyip
// zaman aşımına uğrayabiliyor (geçici ağ yavaşlığı/rate limit) — bu yüzden biraz daha
// uzun bir süre tanıyoruz ve bir kez daha deniyoruz; ikinci denemede de olmazsa vazgeçip
// bir sonraki arama ifadesine/son çare domain tahminine geçiyoruz.
async function searchViaDuckDuckGo(brandName, trace, query, attempt = 1) {
  try {
    const { data, status } = await httpClient.get("https://html.duckduckgo.com/html/", {
      params: { q: query },
      timeout: 15000,
    });
    const $ = cheerio.load(data);
    const candidatesDdg = [];
    const skippedDdg = [];
    $(".result__a").each((_, el) => {
      const $el = $(el);
      const link = $el.attr("href");
      if (!link) return;
      const title = $el.text().trim();
      const snippet = $el.closest(".result").find(".result__snippet").text().trim();
      const urlMatch = link.match(/uddg=([^&]+)/);
      const target = urlMatch ? decodeURIComponent(urlMatch[1]) : link;
      try {
        const domain = new URL(target).hostname.replace(/^www\./, "");
        if (!isOfficialLookingDomain(domain)) {
          skippedDdg.push(domain);
          return;
        }
        candidatesDdg.push({ domain, source: "DuckDuckGo", title, snippet });
      } catch (e) {
        // geçersiz url, atla
      }
    });
    if (skippedDdg.length > 0) {
      trace.push(`DuckDuckGo sonuçları sosyal medya/pazar yeri/dizin siteleriydi, atlandı: ${skippedDdg.join(", ")}`);
    }
    if (candidatesDdg.length > 0) {
      return rankCandidateDomains(candidatesDdg, "DuckDuckGo", brandName, trace);
    }
    if (skippedDdg.length === 0) {
      trace.push(`DuckDuckGo ("${query}") yanıt ${status} ama sonuç linki yok (muhtemelen bot engeli).`);
    }
    return null;
  } catch (e) {
    if (attempt < 2) {
      trace.push(`DuckDuckGo istek hatası (${e.message}), kısa bir bekleme sonrası tekrar deneniyor...`);
      await sleep(1500);
      return searchViaDuckDuckGo(brandName, trace, query, attempt + 1);
    }
    trace.push(`DuckDuckGo istek hatası: ${e.message}`);
    return null;
  }
}

// Aday domain listesini sırayla dener, ana sayfasını doğrulayıp GERÇEKTEN markaya
// ait görünen ilk domaini döner. Bir aday reddedilirse (verifyDomainIsBrand ok:false
// derse) EK bir arama isteği harcamadan bir sonraki adaya geçer — bu, "sistem yanlış
// siteye mail atıyor" sorununun kök nedenini çözer: eskiden ilk/en olası aday ne
// olursa olsun kullanılıyordu, artık markaya ait olmadığı anlaşılan bir site asla
// kullanılmıyor. En fazla ilk 3 adayı dener (her biri bir sayfa taraması gerektirdiği
// için maliyeti/süreyi sınırlı tutmak amacıyla).
async function verifyCandidateList(brandName, domains, trace) {
  for (const domain of domains.slice(0, 3)) {
    const verdict = await verifyDomainIsBrand(brandName, domain, trace);
    if (verdict.ok && verdict.confidence !== "low") {
      trace.push(`"${domain}" doğrulandı (güven: ${verdict.confidence}), kullanılıyor.`);
      return { domain, confidence: verdict.confidence };
    }
  }
  return null;
}

async function findOfficialDomainViaSearch(brandName, trace) {
  // Hiçbir aday kesin doğrulanamazsa bile elimizde en azından bir "düşük güvenli"
  // yedek olsun istiyoruz — hiç sonuç döndürmemekten (kullanıcının elle aramak
  // zorunda kalması) daha iyidir, ama panelde açıkça "düşük güven" olarak işaretlenir.
  let lowConfidenceFallback = null;

  for (let i = 0; i < SEARCH_QUERY_VARIANTS.length; i++) {
    const query = SEARCH_QUERY_VARIANTS[i](brandName);
    if (i > 0) {
      trace.push(`Önceki arama ifadesi hiç doğrulanabilir sonuç vermedi, farklı bir ifadeyle tekrar deneniyor: "${query}"`);
    }

    const providerDomains = [];
    // 1) Serper.dev (tanımlıysa, dolar başına en verimli seçenek)
    const viaSerper = await searchViaSerper(brandName, trace, query);
    if (viaSerper) providerDomains.push(...viaSerper);

    // 2) SerpAPI (tanımlıysa)
    const viaSerpApi = await searchViaSerpApi(brandName, trace, query);
    if (viaSerpApi) providerDomains.push(...viaSerpApi);

    // 3) Ücretsiz fallback: DuckDuckGo
    const viaDdg = await searchViaDuckDuckGo(brandName, trace, query);
    if (viaDdg) providerDomains.push(...viaDdg);

    if (providerDomains.length === 0) continue;

    const uniqueDomains = [...new Set(providerDomains)];
    const verified = await verifyCandidateList(brandName, uniqueDomains, trace);
    if (verified) return verified;

    if (!lowConfidenceFallback && uniqueDomains[0]) {
      lowConfidenceFallback = { domain: uniqueDomains[0], confidence: "low" };
    }
  }

  if (lowConfidenceFallback) {
    trace.push(
      `Hiçbir aday kesin olarak doğrulanamadı, en olası aday düşük güvenle kullanılıyor: ${lowConfidenceFallback.domain} — göndermeden önce mutlaka elle kontrol et.`
    );
    return lowConfidenceFallback;
  }

  // Son çare: marka adından direkt domain tahmini. Sadece .com değil, dernek/vakıf
  // gibi kâr amacı gütmeyen markalarda sık görülen .org ve .net'i de sırayla dene
  // (ör. "White House Historical Association" gibi isimler genelde .org kullanır).
  // Bu tahmin de aynı doğrulamadan geçirilir — çalışan ilk domain'i körü körüne kabul etmeyiz.
  const guess = brandName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
  if (guess) {
    for (const tld of ["com", "org", "net"]) {
      const guessedDomain = `${guess}.${tld}`;
      try {
        const { status } = await httpClient.get(`https://${guessedDomain}`, { timeout: 6000 });
        if (status < 400) {
          trace.push(`Tahmin edilen domain çalışıyor: ${guessedDomain}, doğrulanıyor...`);
          const verdict = await verifyDomainIsBrand(brandName, guessedDomain, trace);
          if (verdict.ok) {
            return { domain: guessedDomain, confidence: verdict.confidence };
          }
          continue;
        }
        trace.push(`Tahmin edilen domain (${guessedDomain}) yanıt kodu: ${status}`);
      } catch (e) {
        trace.push(`Tahmin edilen domain (${guessedDomain}) ulaşılamadı: ${e.message}`);
      }
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
    return {
      found,
      looksLikeContactPage: hasForm,
      text: $("body").text().slice(0, 5000),
      title: $("title").text().trim(),
    };
  } catch (e) {
    trace.push(`${url} -> istek hatası: ${e.message}`);
    return { found: [], looksLikeContactPage: false, text: "", title: "" };
  }
}

// Ana sayfa metninde heuristik (marka adı geçiyor mu) belirsiz/olumsuz çıktığında,
// AI tanımlıysa Claude'a "bu sayfa gerçekten bu markaya mı ait?" diye sorar. Sadece
// bu belirsiz durumlarda çağrılır (her marka için değil), maliyeti düşük tutar.
async function verifyHomepageWithAI(brandName, domain, pageTitle, pageText, trace) {
  if (!ai.isConfigured()) return null;
  const prompt = `"${domain}" adresindeki bir web sitesinin "${brandName}" markasının GERÇEK
resmi/kurumsal sitesi olup olmadığını değerlendiriyorsun.

Sayfa başlığı: ${pageTitle || "(yok)"}
Sayfa içeriğinden örnek metin: ${(pageText || "").slice(0, 800) || "(yok)"}

Bu site "${brandName}" markasının resmi sitesi mi? Marka adı sayfada birebir geçmese bile,
içerik/ürünler/başlık markayla açıkça örtüşüyorsa evet diyebilirsin. Emin değilsen confidence
"low" ver.

Sadece şu JSON formatında cevap ver, başka açıklama ekleme:
{"is_official": true|false, "confidence": "high"|"medium"|"low", "reason": "kısa Türkçe açıklama"}`;

  const result = await ai.askClaude(prompt, { maxTokens: 150 });
  if (!result) return null;
  if (result.error) {
    trace.push(`AI doğrulama hatası (ana sayfa): ${result.error}`);
    return null;
  }
  const parsed = ai.extractJson(result.text);
  if (!parsed) return null;
  trace.push(
    `AI ana sayfa doğrulaması: ${parsed.is_official ? "resmi site gibi görünüyor" : "resmi site gibi görünmüyor"} (güven: ${parsed.confidence || "?"}) — ${parsed.reason || ""}`
  );
  return parsed;
}

// TEK, MERKEZİ doğrulama fonksiyonu: bir domain'in gerçekten aranan markaya ait olup
// olmadığını kontrol eder. Ana sayfayı çekip markanın en belirgin kelimesinin sayfada
// geçip geçmediğine bakar; geçmiyorsa (ve AI tanımlıysa) Claude'a ikinci bir görüş
// sorar. Hem arama sonuçlarından bulunan adaylar, hem Excel'den verilen website, hem
// de son çare domain tahmini için kullanılır — eskiden bu kontrol sadece findBrandEmail
// içinde bir kere yapılıyor ve olumsuz çıksa bile domain yine de kullanılıyordu (sadece
// trace'e uyarı yazılıyordu). Artık "ok: false" dönerse çağıran taraf bu domain'i
// GERÇEKTEN reddedip bir sonraki adaya geçiyor.
async function verifyDomainIsBrand(brandName, domain, trace) {
  const home = await scrapePage(`https://${domain}`, trace);
  const normPageText = normalizeForMatch(home.text);
  const mainToken = coreBrandTokens(brandName).sort((a, b) => b.length - a.length)[0];
  const heuristicRelated = !(mainToken && mainToken.length >= 3 && !normPageText.includes(mainToken));

  if (heuristicRelated) {
    return { ok: true, confidence: "high" };
  }

  trace.push(`Uyarı: "${brandName}" adı ${domain} ana sayfasında geçmiyor, ek doğrulama yapılıyor...`);
  const aiVerdict = await verifyHomepageWithAI(brandName, domain, home.title, home.text, trace);
  if (aiVerdict) {
    if (aiVerdict.is_official && aiVerdict.confidence !== "low") {
      return { ok: true, confidence: "medium" };
    }
    if (!aiVerdict.is_official) {
      trace.push(`"${domain}" reddedildi: bu site markaya ait görünmüyor, başka bir aday deneniyor.`);
      return { ok: false, confidence: "low" };
    }
  }

  // AI tanımlı değil ya da net bir görüş veremedi: tamamen reddetmek yerine düşük
  // güvenle kabul ediyoruz — aksi halde AI olmadan az bilinen/küçük markaların çoğu
  // hiç bulunamaz hale gelir. Ama bu düşük güven panelde açıkça görünür (bkz. "⚠️
  // kontrol et" etiketi), yani kontrolsüz gönderilmez.
  trace.push(`"${domain}" için kesin bir doğrulama yapılamadı, düşük güvenle işaretlendi.`);
  return { ok: true, confidence: "low" };
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

// Hunter.io/site taramasından bulunan e-mail'in domain'i eşleşiyor mu VE seçtiğimiz
// domain'in kendisi ne kadar güvenilir doğrulandı — ikisini birlikte değerlendirip
// tek bir nihai güven seviyesine indirger. Domain düşük güvenle seçildiyse (yani
// aslında markaya ait olduğundan emin değiliz), bulunan e-mail'in domain'i tutsa
// bile sonucu asla "high" olarak işaretlemeyiz.
function blendConfidence(domainConfidence, emailMatchesDomain) {
  if (domainConfidence === "low") return "low";
  if (emailMatchesDomain && domainConfidence === "high") return "high";
  return "medium";
}

async function findBrandEmail(brandName, providedWebsite) {
  const trace = [];
  let domain = null;
  let domainConfidence = "unknown";

  if (providedWebsite && looksLikeDomain(providedWebsite)) {
    const candidateDomain = providedWebsite
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0];
    // Excel'deki "website" sütunu bazen markanın kendi sitesi değil, bir Amazon ürün
    // linki (amazon.com/dp/...) ya da başka bir pazar yeri/sosyal medya linki olabilir.
    // Bunu körü körüne güvenip amazon.com'u "markanın sitesi" sanmamak için aynı
    // kara listeyi burada da uyguluyoruz — aksi halde tüm markalara aynı (Amazon'a ait)
    // e-mail atanabilir.
    if (isOfficialLookingDomain(candidateDomain)) {
      // Excel'den gelen website de yanlış olabilir (yazım hatası, eski/güncel olmayan
      // bilgi, başka bir markayla karışmış satır vb.) — o yüzden bunu da körü körüne
      // güvenmiyoruz, aynı merkezi doğrulamadan geçiriyoruz.
      const verdict = await verifyDomainIsBrand(brandName, candidateDomain, trace);
      if (verdict.ok) {
        domain = candidateDomain;
        domainConfidence = verdict.confidence;
        trace.push(`Excel'den verilen website kullanıldı: ${domain} (güven: ${domainConfidence})`);
      } else {
        trace.push(
          `Excel'den verilen website ("${candidateDomain}") markaya ait görünmüyor, resmi site aranıyor.`
        );
        const found = await findOfficialDomainViaSearch(brandName, trace);
        if (found) {
          domain = found.domain;
          domainConfidence = found.confidence;
        }
      }
    } else {
      trace.push(
        `Excel'den verilen website bir pazar yeri/sosyal medya linkiydi ("${candidateDomain}"), markanın kendi sitesi olarak kabul edilmedi, resmi site aranıyor.`
      );
      const found = await findOfficialDomainViaSearch(brandName, trace);
      if (found) {
        domain = found.domain;
        domainConfidence = found.confidence;
      }
    }
  } else {
    if (providedWebsite) {
      trace.push(`Excel'deki website değeri geçerli bir domain gibi görünmüyor ("${providedWebsite}"), aramaya geçiliyor.`);
    }
    const found = await findOfficialDomainViaSearch(brandName, trace);
    if (found) {
      domain = found.domain;
      domainConfidence = found.confidence;
    }
  }

  if (!domain) {
    trace.push("Hiçbir yöntemle (kesin ya da düşük güvenle) resmi site/domain bulunamadı.");
    return { email: null, website: null, source: null, confidence: "not_found", contactUrl: null, trace };
  }

  const website = `https://${domain}`;
  if (domainConfidence === "low") {
    trace.push("Bu domain düşük güvenle seçildi — göndermeden önce mutlaka elle kontrol et.");
  }

  const hunterEmails = await findEmailsViaHunter(domain, trace);
  if (hunterEmails.length > 0) {
    const cleaned = cleanEmails(hunterEmails, domain);
    if (cleaned.length > 0) {
      return {
        email: cleaned[0].email,
        website,
        source: "hunter.io",
        confidence: blendConfidence(domainConfidence, cleaned[0].sameDomain),
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
    confidence: blendConfidence(domainConfidence, cleaned[0].sameDomain),
    contactUrl: null,
    trace,
  };
}

module.exports = { findBrandEmail };
