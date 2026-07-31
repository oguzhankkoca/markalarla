const dns = require("dns").promises;

// Deliverability (mailin spam'e düşmemesi) için en kritik üç DNS kaydını (SPF,
// DKIM, DMARC) gerçekten sorgulayıp kontrol ediyoruz — README'de "şunu manuel
// kur" demekle yetinmek yerine, sistem kendisi bunun gerçekten doğru kurulu olup
// olmadığını doğrulayabiliyor. Hiçbir ek paket gerekmiyor, Node'un yerleşik dns
// modülü yeterli.

// En yaygın sağlayıcıların varsayılan DKIM selector'ları. Her sağlayıcı farklı bir
// isim kullandığı için (ve DKIM kaydının kendisi domain sahibinin seçtiği rastgele
// bir isimde olabilir), kesin bir "DKIM yok" sonucu veremeyiz — sadece en sık
// rastlanan birkaçını deneyip herhangi biri bulunursa "muhtemelen kurulu" diyebiliriz.
const COMMON_DKIM_SELECTORS = [
  "google", // Google Workspace
  "selector1", // Microsoft 365
  "selector2", // Microsoft 365 (ikinci anahtar)
  "k1", // Mailchimp/Sendgrid tarzı
  "dkim", // genel
  "default", // genel
];

async function resolveTxtSafe(hostname) {
  try {
    const records = await dns.resolveTxt(hostname);
    // dns.resolveTxt her kaydı parça parça (chunk) bir dizi olarak döner, birleştiriyoruz.
    return records.map((chunks) => chunks.join(""));
  } catch (e) {
    if (e.code === "ENOTFOUND" || e.code === "ENODATA") return [];
    throw e; // gerçek/geçici bir sorun — çağıran taraf "unknown" olarak işlesin
  }
}

async function checkSpf(domain) {
  try {
    const records = await resolveTxtSafe(domain);
    const spfRecord = records.find((r) => r.toLowerCase().startsWith("v=spf1"));
    return { checked: true, found: Boolean(spfRecord), record: spfRecord || null };
  } catch (e) {
    return { checked: false, found: null, error: e.message };
  }
}

async function checkDmarc(domain) {
  try {
    const records = await resolveTxtSafe(`_dmarc.${domain}`);
    const dmarcRecord = records.find((r) => r.toLowerCase().startsWith("v=dmarc1"));
    if (!dmarcRecord) return { checked: true, found: false, record: null, policy: null };
    const policyMatch = dmarcRecord.match(/p=(\w+)/i);
    return {
      checked: true,
      found: true,
      record: dmarcRecord,
      policy: policyMatch ? policyMatch[1].toLowerCase() : null,
    };
  } catch (e) {
    return { checked: false, found: null, error: e.message };
  }
}

async function checkDkim(domain) {
  const foundSelectors = [];
  let hadRealError = false;
  for (const selector of COMMON_DKIM_SELECTORS) {
    try {
      const records = await resolveTxtSafe(`${selector}._domainkey.${domain}`);
      const dkimRecord = records.find((r) => /v=dkim1|p=/i.test(r));
      if (dkimRecord) foundSelectors.push(selector);
    } catch (e) {
      hadRealError = true; // geçici bir DNS sorunu olabilir, ama diğer selector'ları denemeye devam et
    }
  }
  if (foundSelectors.length > 0) {
    return { checked: true, found: true, selectors: foundSelectors };
  }
  // Hiçbiri bulunamadıysa: eğer sorgular tamamen başarısız olduysa (ağ sorunu)
  // "bilinmiyor" de, aksi halde "bulunamadı" ama bunun kesin bir "yok" anlamına
  // gelmediğini (özel bir selector kullanıyor olabilir) belirt.
  return {
    checked: !hadRealError,
    found: false,
    selectors: [],
    note: "Yaygın selector'larda bulunamadı — özel bir selector kullanıyorsan bu normal, DKIM'in gerçekten kurulu olmadığı anlamına gelmez.",
  };
}

async function checkSenderDnsHealth() {
  const emailUser = process.env.EMAIL_USER || "";
  const domain = emailUser.split("@")[1];
  if (!domain) {
    return { error: "EMAIL_USER tanımlı değil, kontrol edilecek bir domain yok." };
  }

  const [spf, dmarc, dkim] = await Promise.all([
    checkSpf(domain),
    checkDmarc(domain),
    checkDkim(domain),
  ]);

  return { domain, spf, dmarc, dkim };
}

module.exports = { checkSenderDnsHealth, checkSpf, checkDmarc, checkDkim };
