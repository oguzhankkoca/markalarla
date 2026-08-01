const axios = require("axios");
const cheerio = require("cheerio");
const net = require("net");
const dns = require("dns").promises;
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

// Bu kelimeler o kadar sık marka isminin bir parçası olarak kullanılır ki (ör. "XYZ
// Shop", "ABC Home", "Nature Life") TEK BAŞINA bir domain eşleşmesi için güvenilir
// bir sinyal değildir — "shop.com", "homegoods.net" gibi tamamen alakasız bir site de
// tesadüfen bu kelimeyi içerebilir. Marka adının ana (ayırt edici) kelimesi bunlardan
// biriyse, tek başına yeterli saymıyoruz; en az bir ek token da eşleşmeli.
const GENERIC_BRAND_WORDS = [
  "shop", "store", "life", "home", "world", "care", "plus", "pro", "kids",
  "baby", "beauty", "health", "style", "fashion", "kitchen", "house", "goods",
  "market", "collection", "studio", "design", "official", "direct", "online",
  "supply", "supplies", "outlet", "depot", "hub", "one", "prime", "elite",
  "premium", "select", "choice", "best", "top", "first", "new", "modern",
];

// Bulunan domain'in gerçekten aranan markaya ait olup olmadığını kabaca kontrol eder.
// Kesin bir doğrulama değildir ama "alakasız bir siteyi markanın sitesi sanma" hatasının
// önüne büyük ölçüde geçer. Hata oranını en aza indirmek için: tam isim eşleşmesi kısa
// (4 karakterden az) markalarda yanıltıcı olabileceğinden en az 4 karakter şartı arandı,
// ve tek bir "genel" kelimeye (bkz. GENERIC_BRAND_WORDS) güvenmek yerine böyle durumlarda
// en az iki token'ın eşleşmesi isteniyor.
function domainMatchesBrand(domain, brandName) {
  const coreDomain = normalizeForMatch((domain || "").split(".")[0]);
  if (!coreDomain) return false;
  const normBrandFull = normalizeForMatch(brandName);
  if (normBrandFull && normBrandFull.length >= 4 && (coreDomain.includes(normBrandFull) || normBrandFull.includes(coreDomain))) {
    return true;
  }
  const tokens = coreBrandTokens(brandName).sort((a, b) => b.length - a.length);
  const mainToken = tokens[0];
  if (!mainToken || mainToken.length < 3) return false;
  if (!coreDomain.includes(mainToken)) return false;
  if (GENERIC_BRAND_WORDS.includes(mainToken)) {
    const matchedTokenCount = tokens.filter((t) => t.length >= 3 && coreDomain.includes(t)).length;
    return matchedTokenCount >= 2;
  }
  return true;
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

// rawEmails: düz string dizisi (site taramasından/mailto linklerinden) ya da
// {value, confidence} nesneleri (Hunter.io'dan — confidence Hunter'ın kendi 0-100
// güven skoru, bu e-mail'in gerçekten aktif/doğru olduğuna dair KENDİ tahminleri).
// İkisini de kabul ediyoruz; Hunter'dan gelenlerde bu skoru sıralamada ve nihai
// güven hesabında kullanıyoruz — eskiden bu skor tamamen atılıyordu.
function cleanEmails(rawEmails, domain) {
  const seen = new Set();
  const list = [];
  for (const raw of rawEmails) {
    const isObj = raw && typeof raw === "object";
    const rawValue = isObj ? raw.value : raw;
    const hunterConfidence = isObj && typeof raw.confidence === "number" ? raw.confidence : null;
    const phone = isObj && raw.phone ? raw.phone : null;
    if (!rawValue) continue;
    const email = rawValue.trim().toLowerCase().replace(/[.,;]+$/, "");
    if (seen.has(email)) continue;
    seen.add(email);
    const emailDomain = email.split("@")[1] || "";
    if (BAD_DOMAINS.some((bad) => emailDomain.includes(bad))) continue;
    if (/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(email)) continue;
    list.push({
      email,
      sameDomain: domain ? emailDomain.includes(domain) : false,
      generic: GENERIC_LOCAL_PARTS.includes(email.split("@")[0]),
      hunterConfidence,
      phone,
    });
  }
  list.sort((a, b) => {
    // sameDomain (0-2) ve generic-olmama (0-1) ana sıralama kriterleri; Hunter
    // güven skoru varsa (0-1 aralığına normalize edilmiş) küçük bir ek ağırlık
    // olarak ekleniyor — böylece iki eş değerli aday arasında Hunter'ın daha
    // güvendiği e-mail öne çıkıyor, ama sameDomain/generic sinyallerini ezmiyor.
    const score = (x) =>
      (x.sameDomain ? 2 : 0) + (!x.generic ? 1 : 0) + (x.hunterConfidence !== null ? x.hunterConfidence / 100 : 0);
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
// sitesi?" diye sorar. Artık AI tanımlıysa ve birden fazla aday varsa HER ZAMAN
// çağrılır (sadece heuristik belirsiz kaldığında değil) — çünkü heuristik bazen
// yanlış adayı "eşleşti" diye öne çıkarabilir (ör. iki aday da marka adının bir
// kısmını içeriyor olabilir, ama sadece biri gerçek). Amaç: yanlış siteye/e-maile
// gitme hata oranını mümkün olduğunca aza indirmek — bunun karşılığında biraz daha
// fazla API çağrısı/gecikme kabul ediliyor.
// Excel'den gelen SmartScout-tarzı marka verisini (Amazon kategori bilgisi ve/veya
// Amazon mağaza sayfasından çekilen açıklama metni) AI prompt'larına eklenecek kısa
// bir bağlam bloğuna çevirir. Hiçbiri yoksa boş string döner (prompt eskisi gibi kalır).
function buildBrandContextBlock(context) {
  if (!context) return "";
  const lines = [];
  if (context.mainCategory) {
    lines.push(
      `Amazon kategorisi: ${context.mainCategory}${context.subcategory ? ` > ${context.subcategory}` : ""}`
    );
  }
  if (context.storefrontInfo && context.storefrontInfo.description) {
    lines.push(`Amazon mağaza sayfasından alınan marka açıklaması: ${context.storefrontInfo.description.slice(0, 500)}`);
  }
  if (context.linkedinInfo && (context.linkedinInfo.title || context.linkedinInfo.snippet)) {
    lines.push(
      `LinkedIn şirket sayfası bulundu (${context.linkedinInfo.url}) — başlık/özet: ${(context.linkedinInfo.title + " " + context.linkedinInfo.snippet).trim().slice(0, 300)}`
    );
  }
  if (context.domainAgeInfo && typeof context.domainAgeInfo.ageDays === "number") {
    const years = (context.domainAgeInfo.ageDays / 365).toFixed(1);
    if (context.domainAgeInfo.ageDays < 180) {
      lines.push(
        `DİKKAT: Bu domain WHOIS kaydına göre sadece ${context.domainAgeInfo.ageDays} gün önce kaydedilmiş — çok yeni bir domain, gerçek/köklü bir markanın resmi sitesi olma ihtimali daha düşük (yeni kaydedilmiş/parked bir domain olabilir).`
      );
    } else {
      lines.push(`Bu domain WHOIS kaydına göre yaklaşık ${years} yıldır kayıtlı — köklü bir domain olması olumlu bir sinyal.`);
    }
  }
  if (lines.length === 0) return "";
  return `\nEK BAĞLAM (Excel/Amazon verisinden, doğruluğu garanti değil ama yardımcı bir ipucu):\n${lines.join("\n")}\nBu bilgi, adayın gerçekten bu markayla uyumlu olup olmadığını değerlendirirken ek bir sinyal olarak kullanılabilir (ör. kategori tamamen alakasızsa şüphelen).\n`;
}

async function pickBestDomainWithAI(brandName, candidates, trace, context) {
  if (!ai.isConfigured() || candidates.length === 0) return null;
  const list = candidates
    .map((c, i) => {
      const bits = [`domain: ${c.domain}`];
      if (c.title) bits.push(`başlık: ${c.title}`);
      if (c.snippet) bits.push(`özet: ${c.snippet}`);
      return `${i + 1}. ${bits.join(" | ")}`;
    })
    .join("\n");
  const contextBlock = buildBrandContextBlock(context);
  const prompt = `Bir Amazon toptan satış/distribütörlük şirketi için marka web sitesi doğrulaması
yapıyorsun. Bu doğrulama YANLIŞ bir siteye iş teklifi maili gitmesini önlemek için kritik önemde —
son derece dikkatli ve şüpheci ol.

Aranan marka: "${brandName}"
${contextBlock}
Google arama sonuçlarından bulunan aday domainler:
${list}

Bu adaylardan hangisi "${brandName}" markasının GERÇEK, RESMİ kurumsal web sitesidir? Şunlara
özellikle dikkat et:
- Sosyal medya, pazar yeri (Amazon/eBay/Trendyol/Etsy vb.), haber/blog sitesi, inceleme/dizin
  sitesi ya da tamamen alakasız bir şirketse SEÇME.
- Benzer/kısmen aynı isimli ama FARKLI bir şirket olabilir (ör. "Nature's Bounty" ile
  "Nature's Way" farklı şirketlerdir) — sadece isim benzerliğine değil, sayfa
  içeriğinin/ürünlerinin gerçekten bu markayla örtüşüp örtüşmediğine bak.
- Parked/expired domain, jenerik bir şablon mağaza, ya da markayla hiç ilgisi olmayan bir
  içerik varsa SEÇME.
- Emin değilsen index'i null bırak, tahmin yürütme — yanlış bir seçim yapmaktansa hiç seçim
  yapmamak daha iyidir.

Sadece şu JSON formatında cevap ver, başka hiçbir açıklama ekleme:
{"index": <1'den başlayan aday numarası ya da null>, "confidence": "high"|"medium"|"low", "reason": "kısa Türkçe açıklama"}`;

  // Bu, hangi domain'in doğru marka olduğuna karar veren kritik bir seçim — yanlış
  // seçim doğrudan yanlış şirkete mail gitmesine yol açar. Hacim düşük (sadece
  // heuristiğin emin olamadığı durumlarda çağrılır) olduğu için Sonnet kullanmak
  // ek maliyeti ihmal edilebilir düzeyde tutarken doğruluğu artırır.
  const result = await ai.askClaude(prompt, { maxTokens: 200, model: "claude-sonnet-5" });
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
async function rankCandidateDomains(candidates, sourceName, brandName, trace, context) {
  if (candidates.length === 0) return [];
  trace.push(`${sourceName} adayları: ${candidates.map((c) => c.domain).join(", ")}`);

  const matched = candidates.filter((c) => domainMatchesBrand(c.domain, brandName));
  const unmatched = candidates.filter((c) => !domainMatchesBrand(c.domain, brandName));
  let ordered = [...matched, ...unmatched];

  if (matched.length > 0) {
    trace.push(`${sourceName}: marka adıyla örtüşen adaylar önce denenecek: ${matched.map((c) => c.domain).join(", ")}`);
  }

  // AI tanımlıysa VE birden fazla aday varsa, heuristik bir eşleşme bulmuş olsa BİLE
  // ikinci bir görüş olarak her zaman çalıştırılır — sadece heuristik hiçbir şey
  // bulamadığında değil. Heuristik bazen YANLIŞ adayı "eşleşti" diye öne çıkarabilir
  // (iki aday da marka adının bir kısmını içeriyor olabilir, sadece biri gerçek resmi
  // site olabilir); bu yüzden kullanıcının istediği düşük hata oranı için AI'ın son
  // sözü söylemesine izin veriyoruz.
  if (ai.isConfigured() && candidates.length > 1) {
    const aiPick = await pickBestDomainWithAI(brandName, candidates, trace);
    if (aiPick && aiPick.domain && aiPick.confidence !== "low") {
      trace.push(`${sourceName}: AI'ın seçimi öne alınıyor (${aiPick.domain}, güven: ${aiPick.confidence}).`);
      ordered = [{ domain: aiPick.domain }, ...ordered.filter((c) => c.domain !== aiPick.domain)];
    } else if (aiPick === null && matched.length === 0) {
      // AI da hiçbir adayı seçemediyse ve heuristik de eşleşme bulamadıysa, bu arama
      // sonucu grubunun muhtemelen hiç doğru aday içermediğini not düş (verifyCandidateList
      // yine de ilk 3'ü dener, ama trace'te bu belirsizlik görünür kalsın).
      trace.push(`${sourceName}: ne heuristik ne de AI net bir aday seçebildi — bu gruptaki adaylar şüpheli.`);
    }
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
    return extractCandidates(
      results.map((r) => ({ url: r.link, title: r.title, snippet: r.snippet })),
      "Serper.dev",
      trace
    );
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
    return extractCandidates(
      results.map((r) => ({ url: r.link, title: r.title, snippet: r.snippet })),
      "SerpAPI",
      trace
    );
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
      return candidatesDdg;
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

// LinkedIn şirket sayfası ek doğrulama sinyali: markanın gerçek/aktif bir şirket
// olduğunu gösteren ek bir ipucu olarak, "{marka} linkedin" aramasında çıkan bir
// linkedin.com/company sonucunun başlık/özetini yakalamaya çalışır. NOT: LinkedIn
// sayfasının kendisini AÇIP okumuyoruz (LinkedIn oturum açmamış isteklere neredeyse
// her zaman bir "giriş yap" duvarı gösterir, Amazon mağaza sayfalarına benzer bir
// bot-engelleme sorunu) — bunun yerine arama motorunun ZATEN indekslediği başlık/özet
// metnini kullanıyoruz, bu yüzden LinkedIn'e hiç istek atmadan da çalışabilir. Bulursa
// bunu AI doğrulama bağlamına ek bir sinyal olarak ekliyoruz (buildBrandContextBlock);
// bulamazsa (çoğu zaman böyle olacaktır) sessizce null döner, akışı hiç etkilemez.
async function findLinkedInSignal(brandName, trace) {
  const query = `${brandName} company linkedin`;

  function pickFromResults(results) {
    for (const r of results || []) {
      const link = r && (r.link || r.url);
      if (!link) continue;
      if (/linkedin\.com\/company\//i.test(link)) {
        return { url: link, title: r.title || "", snippet: r.snippet || "" };
      }
    }
    return null;
  }

  try {
    if (process.env.SERPER_API_KEY && Date.now() >= serperRestUntil) {
      const { data, status } = await httpClient.post(
        "https://google.serper.dev/search",
        { q: query },
        { headers: { "X-API-KEY": process.env.SERPER_API_KEY, "Content-Type": "application/json" } }
      );
      if (status === 200 && !isQuotaError(status, data)) {
        const found = pickFromResults(data.organic);
        if (found) return found;
      }
    }
  } catch (e) {
    trace.push(`LinkedIn sinyali için Serper.dev denemesi başarısız: ${e.message}`);
  }

  try {
    if (process.env.SERPAPI_KEY && Date.now() >= serpApiRestUntil) {
      const { data, status } = await httpClient.get("https://serpapi.com/search.json", {
        params: { q: query, api_key: process.env.SERPAPI_KEY, num: 10 },
      });
      if (status === 200 && !isQuotaError(status, data) && !data.error) {
        const found = pickFromResults(data.organic_results);
        if (found) return found;
      }
    }
  } catch (e) {
    trace.push(`LinkedIn sinyali için SerpAPI denemesi başarısız: ${e.message}`);
  }

  try {
    const { data } = await httpClient.get("https://html.duckduckgo.com/html/", {
      params: { q: query },
      timeout: 15000,
    });
    const $ = cheerio.load(data);
    let found = null;
    $(".result__a").each((_, el) => {
      if (found) return;
      const $el = $(el);
      const link = $el.attr("href");
      if (!link) return;
      const urlMatch = link.match(/uddg=([^&]+)/);
      const target = urlMatch ? decodeURIComponent(urlMatch[1]) : link;
      if (/linkedin\.com\/company\//i.test(target)) {
        const title = $el.text().trim();
        const snippet = $el.closest(".result").find(".result__snippet").text().trim();
        found = { url: target, title, snippet };
      }
    });
    if (found) return found;
  } catch (e) {
    trace.push(`LinkedIn sinyali için DuckDuckGo denemesi başarısız: ${e.message}`);
  }

  return null;
}

// MX kaydı kontrolü: bir domain'e "resmi site" olarak karar verdikten sonra, o
// domain'in gerçekten mail ALABİLEN bir sunucusu var mı diye bakıyoruz. Bu, hiçbir
// ek paket/API gerektirmeyen (Node'un yerleşik dns modülü), ücretsiz ve çok ucuz bir
// kontrol — ama bounce oranını düşürmek için en doğrudan sinyallerden biri: MX kaydı
// yoksa o adrese giden HER mail kesin olarak geri döner.
// Döner: true (MX var), false (MX kesinlikle yok — ENOTFOUND/ENODATA), null (geçici
// bir DNS sorunu, karar veremedik — bu durumda cezalandırmıyoruz).
async function checkMxRecords(domain) {
  try {
    const records = await dns.resolveMx(domain);
    return Array.isArray(records) && records.length > 0;
  } catch (e) {
    if (e.code === "ENOTFOUND" || e.code === "ENODATA") return false;
    return null; // ESERVFAIL, timeout vb. geçici sorunlar — bilinmiyor say
  }
}

// Domain yaşı (WHOIS) sinyali: yeni npm paketi kurmadan, Node'un yerleşik `net`
// modülüyle ham WHOIS protokolüne (port 43) doğrudan bağlanıyoruz. En yaygın
// TLD'ler için bilinen WHOIS sunucularını kullanıyoruz; kapsam dışı bir TLD ise
// ya da sorgu başarısız/zaman aşımına uğrarsa (WHOIS sunucuları bazı bulut/veri
// merkezi IP'lerini kısıtlayabiliyor) sessizce null dönüyoruz — Amazon mağaza
// sayfası ve LinkedIn sinyalleriyle aynı "best-effort, hiçbir şeyi bozmaz" mantığı.
const WHOIS_SERVERS = {
  com: "whois.verisign-grs.com",
  net: "whois.verisign-grs.com",
  org: "whois.pir.org",
  info: "whois.afilias.net",
  biz: "whois.nic.biz",
  co: "whois.nic.co",
  io: "whois.nic.io",
  us: "whois.nic.us",
  shop: "whois.nic.shop",
  store: "whois.nic.store",
};

function rawWhoisQuery(server, domain) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: server, port: 43 });
    let data = "";
    socket.setTimeout(5000);
    socket.on("connect", () => socket.write(domain + "\r\n"));
    socket.on("data", (chunk) => (data += chunk.toString("utf8")));
    socket.on("end", () => resolve(data));
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("WHOIS sorgusu zaman aşımına uğradı"));
    });
    socket.on("error", (err) => reject(err));
  });
}

const WHOIS_DATE_PATTERNS = [
  /creation date:\s*(.+)/i,
  /created on:\s*(.+)/i,
  /created:\s*(.+)/i,
  /registered on:\s*(.+)/i,
  /domain registration date:\s*(.+)/i,
  /registration time:\s*(.+)/i,
];

async function getDomainAgeInfo(domain, trace) {
  try {
    const tld = domain.split(".").pop().toLowerCase();
    const server = WHOIS_SERVERS[tld];
    if (!server) return null; // kapsam dışı TLD, sessizce atla

    const raw = await rawWhoisQuery(server, domain);
    let createdAt = null;
    for (const pattern of WHOIS_DATE_PATTERNS) {
      const match = raw.match(pattern);
      if (match) {
        const parsed = new Date(match[1].trim());
        if (!isNaN(parsed.getTime())) {
          createdAt = parsed;
          break;
        }
      }
    }
    if (!createdAt) return null;

    const ageDays = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
    return { ageDays, createdAt };
  } catch (e) {
    trace.push(`Domain yaşı (WHOIS) sorgusu başarısız (${domain}): ${e.message}`);
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
async function verifyCandidateList(brandName, domains, trace, context) {
  for (const domain of domains.slice(0, 3)) {
    const verdict = await verifyDomainIsBrand(brandName, domain, trace, context);
    if (verdict.ok && verdict.confidence !== "low") {
      trace.push(`"${domain}" doğrulandı (güven: ${verdict.confidence}), kullanılıyor.`);
      return { domain, confidence: verdict.confidence };
    }
  }
  return null;
}

async function findOfficialDomainViaSearch(brandName, trace, context) {
  // Hiçbir aday kesin doğrulanamazsa bile elimizde en azından bir "düşük güvenli"
  // yedek olsun istiyoruz — hiç sonuç döndürmemekten (kullanıcının elle aramak
  // zorunda kalması) daha iyidir, ama panelde açıkça "düşük güven" olarak işaretlenir.
  let lowConfidenceFallback = null;

  for (let i = 0; i < SEARCH_QUERY_VARIANTS.length; i++) {
    const query = SEARCH_QUERY_VARIANTS[i](brandName);
    if (i > 0) {
      trace.push(`Önceki arama ifadesi hiç doğrulanabilir sonuç vermedi, farklı bir ifadeyle tekrar deneniyor: "${query}"`);
    }

    // Üç sağlayıcının HAM (henüz sıralanmamış) adaylarını topluyoruz, sonra hepsini
    // TEK BİR AI/heuristik sıralama geçişinden birlikte geçiriyoruz. Eskiden her
    // sağlayıcı kendi listesini ayrı ayrı sıralıyordu (ve AI'ya ayrı ayrı soruluyordu);
    // artık AI, o arama ifadesi için bulunan TÜM adayları bir arada görüyor — bu hem
    // daha isabetli bir seçim yapmasını sağlıyor hem de gereksiz tekrarlı AI çağrısını
    // önlüyor.
    const rawCandidates = [];
    // 1) Serper.dev (tanımlıysa, dolar başına en verimli seçenek)
    const viaSerper = await searchViaSerper(brandName, trace, query);
    if (viaSerper) rawCandidates.push(...viaSerper);

    // 2) SerpAPI (tanımlıysa)
    const viaSerpApi = await searchViaSerpApi(brandName, trace, query);
    if (viaSerpApi) rawCandidates.push(...viaSerpApi);

    // 3) Ücretsiz fallback: DuckDuckGo
    const viaDdg = await searchViaDuckDuckGo(brandName, trace, query);
    if (viaDdg) rawCandidates.push(...viaDdg);

    if (rawCandidates.length === 0) continue;

    // Aynı domain birden fazla sağlayıcıdan gelmiş olabilir — ilk görülen title/snippet'i
    // koruyarak tekilleştir.
    const seenDomains = new Set();
    const dedupedCandidates = [];
    for (const c of rawCandidates) {
      if (seenDomains.has(c.domain)) continue;
      seenDomains.add(c.domain);
      dedupedCandidates.push(c);
    }

    const uniqueDomains = await rankCandidateDomains(dedupedCandidates, "arama sonuçları", brandName, trace, context);
    const verified = await verifyCandidateList(brandName, uniqueDomains, trace, context);
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
          const verdict = await verifyDomainIsBrand(brandName, guessedDomain, trace, context);
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
    const rawEmails = data.data?.emails || [];
    const emails = rawEmails.map((e) => ({
      value: e.value,
      confidence: typeof e.confidence === "number" ? e.confidence : null,
      // Hunter bazı e-mail kayıtları için bir telefon numarası da döndürebiliyor
      // (nadiren dolu oluyor, ama doluysa markayı doğrudan aramak için değerli
      // ekstra bir kanal — panelde gösteriyoruz, başka bir işlem yapmıyoruz).
      phone: e.phone_number || null,
    }));
    const confidences = emails.map((e) => e.confidence).filter((c) => c !== null);
    trace.push(
      `Hunter.io ${emails.length} email döndürdü` +
        (confidences.length > 0 ? ` (güven skoru: ${Math.min(...confidences)}-${Math.max(...confidences)})` : "") +
        "."
    );
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

// Excel'deki "Storefront Url" sütunu genelde bir Amazon marka mağazası linkidir
// (amazon.com/stores/BrandName/page/...). Bunu taramaya çalışıyoruz çünkü Amazon
// bazen mağaza sayfasında kısa bir "marka hakkında" açıklaması gösterir — bu, aday
// sitenin gerçekten bu markayla örtüşüp örtüşmediğini AI'ın değerlendirmesine yardımcı
// olabilir. ÖNEMLİ UYARI: (1) Amazon, Store sayfalarında markaların dışarıya link
// vermesine genelde izin vermez, yani bir "resmi website" linki bulma ihtimali düşük —
// bu yüzden bunu ana kaynak değil, bir BONUS ipucu olarak kullanıyoruz. (2) Amazon,
// veri merkezi IP'lerinden (Render dahil) gelen istekleri sıklıkla engeller/CAPTCHA
// gösterir — bu yüzden bu fonksiyon büyük ihtimalle çoğu zaman boş dönecektir, bu
// beklenen bir durumdur ve hiçbir hata fırlatmaz, sistem sessizce normal aramaya devam eder.
async function scrapeAmazonStorefront(storefrontUrl, trace) {
  try {
    const { data, status } = await httpClient.get(storefrontUrl, { timeout: 8000 });
    if (status >= 400 || typeof data !== "string" || data.length < 200) {
      trace.push(`Amazon mağaza sayfası (${storefrontUrl}) erişilemedi/engellenmiş görünüyor (HTTP ${status}), atlanıyor.`);
      return null;
    }
    // Amazon'un bot koruması genelde bir "robot check"/captcha sayfası döndürür —
    // bunu tespit edip gerçek bir sayfa gibi işlemeyi önlüyoruz.
    if (/captcha|robot check|are you a human/i.test(data)) {
      trace.push(`Amazon mağaza sayfası bot korumasına takıldı (captcha), atlanıyor.`);
      return null;
    }
    const $ = cheerio.load(data);
    const title = $("title").text().trim();
    const bodyText = $("body").text().replace(/\s+/g, " ").trim();

    // Amazon Store sayfaları politikası gereği dışarıya link vermeyi genelde
    // engeller; yine de nadir/eski bir sayfada olabilir diye kontrol ediyoruz.
    // amazon.com'a, statik CDN'lerine (media-amazon, ssl-images-amazon) ve bilinen
    // takip/politika linklerine ait olmayan ilk https link'i "dış link adayı" sayıyoruz.
    let externalLink = null;
    $("a[href^='http']").each((_, el) => {
      if (externalLink) return;
      const href = $(el).attr("href") || "";
      try {
        const host = new URL(href).hostname.replace(/^www\./, "");
        if (/amazon\.|media-amazon\.|ssl-images-amazon\.|associates-amazon\./i.test(host)) return;
        if (!isOfficialLookingDomain(host)) return;
        externalLink = host;
      } catch (e) {
        // geçersiz url, atla
      }
    });

    trace.push(
      `Amazon mağaza sayfası okundu${externalLink ? ` (dış link bulundu: ${externalLink})` : " (dış link yok, sadece açıklama kullanılacak)"}.`
    );
    return { title, description: bodyText.slice(0, 800), externalLink };
  } catch (e) {
    trace.push(`Amazon mağaza sayfası (${storefrontUrl}) okunamadı: ${e.message} — bu beklenir (Amazon bulut IP'lerini sık engeller), normal aramaya devam ediliyor.`);
    return null;
  }
}

// Ana sayfa metninde heuristik (marka adı geçiyor mu) belirsiz/olumsuz çıktığında,
// AI tanımlıysa Claude'a "bu sayfa gerçekten bu markaya mı ait?" diye sorar. Sadece
// bu belirsiz durumlarda çağrılır (her marka için değil), maliyeti düşük tutar.
async function verifyHomepageWithAI(brandName, domain, pageTitle, pageText, trace, context) {
  if (!ai.isConfigured()) return null;
  const contextBlock = buildBrandContextBlock(context);
  const prompt = `"${domain}" adresindeki bir web sitesinin "${brandName}" markasının GERÇEK
resmi/kurumsal sitesi olup olmadığını değerlendiriyorsun. Bu bir Amazon toptan satış/distribütörlük
şirketinin iş teklifi maili göndereceği adresi belirlemek için kritik bir kontrol — yanlış siteyi
onaylarsan mail tamamen alakasız bir şirkete/kişiye gidebilir, bu yüzden dikkatli ve şüpheci ol.
${contextBlock}
Sayfa başlığı: ${pageTitle || "(yok)"}
Sayfa içeriğinden örnek metin: ${(pageText || "").slice(0, 1200) || "(yok)"}

Bu site "${brandName}" markasının resmi sitesi mi? Marka adı sayfada birebir geçmese bile,
içerik/ürünler/başlık markayla açıkça örtüşüyorsa evet diyebilirsin. Ama şunlara dikkat et:
- Benzer isimli ama FARKLI bir şirket olabilir — sadece isim benzerliğine değil, sayfanın
  gerçekten bu markayla mı ilgili olduğuna bak.
- Parked/expired domain, satılık domain sayfası, jenerik bir şablon/placeholder sayfa, ya da
  markayla hiç ilgisi olmayan bir içerikse "is_official": false ver.
- Sayfa boş/çok az bilgi içeriyorsa ya da emin olamıyorsan confidence "low" ver, "is_official"ı
  yine de en olası tahminine göre işaretle.

Sadece şu JSON formatında cevap ver, başka açıklama ekleme:
{"is_official": true|false, "confidence": "high"|"medium"|"low", "reason": "kısa Türkçe açıklama"}`;

  // Ana sayfanın gerçekten markaya ait olup olmadığına karar veren son kontrol —
  // aynı gerekçeyle (yanlış onay = yanlış şirkete mail) burada da Sonnet kullanılıyor.
  const result = await ai.askClaude(prompt, { maxTokens: 150, model: "claude-sonnet-5" });
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
async function verifyDomainIsBrand(brandName, domain, trace, context) {
  const home = await scrapePage(`https://${domain}`, trace);
  const normPageText = normalizeForMatch(home.text);
  const mainToken = coreBrandTokens(brandName).sort((a, b) => b.length - a.length)[0];
  const heuristicRelated = !(mainToken && mainToken.length >= 3 && !normPageText.includes(mainToken));

  // ÖNEMLİ: AI tanımlıysa artık HER ZAMAN ikinci bir görüş olarak çalıştırılır —
  // heuristik "marka adı sayfada geçiyor" dese bile. Bunun sebebi: heuristik sadece
  // bir kelimenin sayfada geçip geçmediğine bakıyor, bu YANLIŞ POZİTİF üretebilir
  // (ör. marka adı sayfada bir referans/karşılaştırma olarak geçebilir, ya da kısa/
  // genel bir kelime tesadüfen eşleşebilir). Kullanıcı hata oranını en aza indirmek
  // istediği için, AI mevcutsa onun nihai kararına güveniyoruz; AI yoksa (ya da
  // yanıt veremezse) eskisi gibi heuristiğe geri dönüyoruz.
  if (ai.isConfigured()) {
    // WHOIS sorgusu ekstra bir ağ isteği/gecikme gerektirdiği için sadece AI
    // gerçekten bu bağlamı kullanacaksa çalıştırılıyor.
    context.domainAgeInfo = await getDomainAgeInfo(domain, trace);
    const aiVerdict = await verifyHomepageWithAI(brandName, domain, home.title, home.text, trace, context);
    if (aiVerdict) {
      if (!aiVerdict.is_official) {
        trace.push(`"${domain}" reddedildi: AI bu sitenin "${brandName}" markasına ait olmadığını düşünüyor, başka bir aday deneniyor.`);
        return { ok: false, confidence: "low" };
      }
      if (aiVerdict.confidence === "low") {
        // AI "resmi ama emin değilim" diyor. Heuristik de destekliyorsa orta güvenle
        // kabul et, desteklemiyorsa düşük güvenle işaretle (reddetme, ama panelde uyar).
        return { ok: true, confidence: heuristicRelated ? "medium" : "low" };
      }
      return { ok: true, confidence: heuristicRelated ? "high" : "medium" };
    }
    trace.push(`AI'dan yanıt alınamadı (${domain}), heuristiğe geri dönülüyor.`);
  }

  if (heuristicRelated) {
    return { ok: true, confidence: "high" };
  }

  trace.push(`Uyarı: "${brandName}" adı ${domain} ana sayfasında geçmiyor ve AI ile teyit edilemedi.`);

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

// Hunter.io/site taramasından bulunan e-mail'in domain'i eşleşiyor mu, seçtiğimiz
// domain'in kendisi ne kadar güvenilir doğrulandı VE (varsa) Hunter.io'nun bu
// e-mail için KENDİ güven skoru — üçünü birlikte değerlendirip tek bir nihai güven
// seviyesine indirger. Domain düşük güvenle seçildiyse (markaya ait olduğundan tam
// emin değilsek) ya da Hunter'ın kendisi bu e-mail'den emin değilse (skor < 50),
// sonucu asla "high" olarak işaretlemeyiz — panelde "⚠️ düşük güven" olarak çıkar.
function blendConfidence(domainConfidence, emailMatchesDomain, hunterConfidence) {
  if (domainConfidence === "low") return "low";
  if (typeof hunterConfidence === "number" && hunterConfidence < 50) return "low";
  if (emailMatchesDomain && domainConfidence === "high") return "high";
  return "medium";
}

// extra: { mainCategory, subcategory, storefrontUrl } — SmartScout-tarzı Excel
// sütunlarından (varsa) gelen ek bağlam. Hiçbiri yoksa davranış tamamen eskisi gibidir.
async function findBrandEmail(brandName, providedWebsite, extra = {}) {
  const trace = [];
  let domain = null;
  let domainConfidence = "unknown";

  const context = {
    mainCategory: extra.mainCategory || null,
    subcategory: extra.subcategory || null,
    storefrontInfo: null,
    linkedinInfo: null,
  };

  // 0) Amazon mağaza sayfası varsa bir kez taramayı dene (bonus sinyal — bloklanırsa
  // sessizce atlanır, hiçbir şeyi bozmaz). Nadiren de olsa bir dış link bulunursa,
  // onu ÖNCELİKLE doğrulayıp kullanmayı deniyoruz — bu, Amazon'un markaya atfettiği
  // bir bilgi olduğu için güçlü bir sinyal sayılır, ama yine de körü körüne güvenmiyoruz,
  // aynı merkezi doğrulamadan (verifyDomainIsBrand) geçiriyoruz.
  if (extra.storefrontUrl && /^https?:\/\//i.test(extra.storefrontUrl)) {
    context.storefrontInfo = await scrapeAmazonStorefront(extra.storefrontUrl, trace);
    if (context.storefrontInfo && context.storefrontInfo.externalLink) {
      const verdict = await verifyDomainIsBrand(brandName, context.storefrontInfo.externalLink, trace, context);
      if (verdict.ok && verdict.confidence !== "low") {
        domain = context.storefrontInfo.externalLink;
        // Amazon'un kendi mağaza sayfasından geldiği için ekstra bir korobasyon sayılır.
        domainConfidence = verdict.confidence === "medium" ? "high" : verdict.confidence;
        trace.push(`Amazon mağaza sayfasından bulunan dış link doğrulandı ve kullanılıyor: ${domain} (güven: ${domainConfidence})`);
      }
    }
  }

  // 0.5) LinkedIn şirket sayfası sinyali: sadece AI tanımlıysa aranır (heuristik bu
  // bağlamı zaten kullanmıyor, tanımlı değilse arama kotasını boşa harcamamak için
  // atlanır) VE domain Amazon mağaza sayfasından çoktan kesin bulunmadıysa (o zaten
  // yeterince güçlü bir sinyal, ekstra bir arama isteğine gerek yok).
  if (!domain && ai.isConfigured()) {
    context.linkedinInfo = await findLinkedInSignal(brandName, trace);
    if (context.linkedinInfo) {
      trace.push(`LinkedIn şirket sayfası bulundu, ek bağlam olarak kullanılacak: ${context.linkedinInfo.url}`);
    }
  }

  if (domain) {
    // Amazon mağaza linki zaten doğrulanıp kabul edildi, aşağıdaki arama adımları
    // tamamen atlanıyor (hem daha hızlı hem de gereksiz API kotası harcanmıyor).
  } else if (providedWebsite && looksLikeDomain(providedWebsite)) {
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
      const verdict = await verifyDomainIsBrand(brandName, candidateDomain, trace, context);
      if (verdict.ok) {
        domain = candidateDomain;
        domainConfidence = verdict.confidence;
        trace.push(`Excel'den verilen website kullanıldı: ${domain} (güven: ${domainConfidence})`);
      } else {
        trace.push(
          `Excel'den verilen website ("${candidateDomain}") markaya ait görünmüyor, resmi site aranıyor.`
        );
        const found = await findOfficialDomainViaSearch(brandName, trace, context);
        if (found) {
          domain = found.domain;
          domainConfidence = found.confidence;
        }
      }
    } else {
      trace.push(
        `Excel'den verilen website bir pazar yeri/sosyal medya linkiydi ("${candidateDomain}"), markanın kendi sitesi olarak kabul edilmedi, resmi site aranıyor.`
      );
      const found = await findOfficialDomainViaSearch(brandName, trace, context);
      if (found) {
        domain = found.domain;
        domainConfidence = found.confidence;
      }
    }
  } else {
    if (providedWebsite) {
      trace.push(`Excel'deki website değeri geçerli bir domain gibi görünmüyor ("${providedWebsite}"), aramaya geçiliyor.`);
    }
    const found = await findOfficialDomainViaSearch(brandName, trace, context);
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

  // MX kaydı yoksa bu domain'e giden HİÇBİR mail teslim edilemez — ne kadar emin
  // olursak olalım (yüksek güvenle doğrulanmış bile olsa) nihai güveni düşürüyoruz
  // ki gönderim öncesi mutlaka elle kontrol edilsin. Geçici bir DNS sorunu varsa
  // (mxOk === null) cezalandırmıyoruz.
  const mxOk = await checkMxRecords(domain);
  if (mxOk === false) {
    trace.push(
      `UYARI: "${domain}" için MX (mail) kaydı bulunamadı — bu domain e-posta ALAMIYOR olabilir, gönderilirse kesin olarak geri dönebilir.`
    );
  }
  const applyMxPenalty = (confidence) => (mxOk === false ? "low" : confidence);

  const hunterEmails = await findEmailsViaHunter(domain, trace);
  if (hunterEmails.length > 0) {
    const cleaned = cleanEmails(hunterEmails, domain);
    if (cleaned.length > 0) {
      return {
        email: cleaned[0].email,
        website,
        source: "hunter.io",
        confidence: applyMxPenalty(blendConfidence(domainConfidence, cleaned[0].sameDomain, cleaned[0].hunterConfidence)),
        contactUrl: null,
        phone: cleaned[0].phone || null,
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
    confidence: applyMxPenalty(blendConfidence(domainConfidence, cleaned[0].sameDomain)),
    contactUrl: null,
    trace,
  };
}

// Wholesale/Distributor/Dealer/Become-a-Partner/Retailer sayfası otomatik
// tespiti (v49). Ana sayfadaki tüm linkleri tarar, href'i ya da link metni bu
// anahtar kelimelerden birini içeren İLK linki döner — genelde site navigasyonunda
// ya da footer'da "Wholesale Inquiries", "Become a Dealer" gibi bir link olur.
// Hiçbir şey bulunamazsa (çoğu site için beklenen durum) sessizce null döner,
// e-mail arama akışını hiçbir şekilde etkilemez/yavaşlatmaz (best-effort).
const WHOLESALE_KEYWORDS = [
  "wholesale",
  "distributor",
  "become a dealer",
  "become-a-dealer",
  "dealer inquiries",
  "become a partner",
  "become-a-partner",
  "partner with us",
  "retailer",
  "reseller",
  "trade account",
  "trade program",
  "b2b",
];

async function detectWholesalePage(website) {
  if (!website) return null;
  let url = website;
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  try {
    const { data, status } = await httpClient.get(url, { timeout: 8000 });
    if (status >= 400 || typeof data !== "string") return null;
    const $ = cheerio.load(data);
    let found = null;
    $("a[href]").each((_, el) => {
      if (found) return;
      const href = ($(el).attr("href") || "").toLowerCase();
      const text = $(el).text().toLowerCase().trim();
      const hit = WHOLESALE_KEYWORDS.find((kw) => href.includes(kw.replace(/ /g, "-")) || href.includes(kw) || text.includes(kw));
      if (hit) {
        try {
          found = new URL($(el).attr("href"), url).href;
        } catch (e) {
          // href geçersiz bir URL parçasıysa (ör. "javascript:void(0)") atla
        }
      }
    });
    return found;
  } catch (e) {
    return null;
  }
}

module.exports = { findBrandEmail };
// Test setinin (tests/) MX kaydı sınıflandırma mantığını (true/false/null) doğrudan
// çağırıp doğrulayabilmesi için dışa aktarıldı — findBrandEmail'in davranışını değiştirmez.
module.exports.checkMxRecords = checkMxRecords;
// AI kişiselleştirme (routes/aiFeatures.js) ve wholesale/distributor sayfa tespiti
// (find-email akışı) AYNI sayfa taramasını (email adayları + form var mı + sayfa
// metni) tekrar yazmak yerine burayı kullanıyor.
module.exports.scrapePage = scrapePage;
module.exports.detectWholesalePage = detectWholesalePage;
