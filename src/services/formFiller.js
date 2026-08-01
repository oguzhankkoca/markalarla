// v63: Playwright ile toptan satış (wholesale) başvuru formu otomatik doldurma.
//
// ÖNEMLİ TASARIM KARARI: "playwright" paketi BİLEREK package.json'a eklenmedi.
// Playwright'ın kurulumu (npx playwright install) yüzlerce MB'lık bir tarayıcı
// (Chromium) indirir — bu, Render'daki `npm install` adımını yavaşlatabilir ya
// da (disk/zaman sınırına takılırsa) BAŞARISIZ ederek TÜM UYGULAMANIN
// deploy'unu bozabilir. Bu, "hali hazırda işleyen sistemi bozma" kısıtıyla
// doğrudan çelişir. Bunun yerine bu özellik TAMAMEN İSTEĞE BAĞLIDIR: playwright
// modülü burada SADECE bu route çağrıldığında, lazy (gecikmeli) require ile
// yüklenmeye çalışılır. Kurulu değilse sistemin geri kalanı (e-mail bulma,
// gönderim, CRM, vs.) hiç etkilenmez — sadece bu tek özellik net bir hata
// mesajıyla "önce şunu kur" der.
//
// Kullanıcı bu özelliği açmak isterse:
//   npm install playwright
//   npx playwright install chromium
// (README'de detaylı anlatılıyor.)
//
// GÜVENLİK KISITI (kullanıcının açıkça istediği gibi): form ASLA otomatik
// gönderilmez (submit edilmez). Sadece doldurulur, bir ekran görüntüsü alınır
// ve kullanıcının GÖZDEN GEÇİRİP kendisinin onaylaması/göndermesi için sunulur.

function loadPlaywright() {
  try {
    return require("playwright");
  } catch (e) {
    return null;
  }
}

function isAvailable() {
  return loadPlaywright() !== null;
}

// Formda en sık görülen alan adı/etiket kalıplarına göre, bir <input>/<textarea>
// elemanının hangi anlamsal alana (isim, e-mail, şirket, telefon, mesaj) karşılık
// geldiğini tahmin eder. Kesin bir çözüm değildir — formlar çok çeşitlidir, bu
// yüzden sonuç kullanıcıya "gözden geçir" diye sunulur, otomatik gönderilmez.
const FIELD_PATTERNS = {
  name: /\b(name|full[-_ ]?name|contact[-_ ]?name|your[-_ ]?name|ad[-_ ]?soyad|isim)\b/i,
  email: /\b(email|e-mail|e[-_ ]?posta)\b/i,
  company: /\b(company|business|organization|şirket|firma)\b/i,
  phone: /\b(phone|tel|telephone|mobile|telefon)\b/i,
  message: /\b(message|comment|note|inquiry|details|mesaj|not)\b/i,
};

function guessFieldType(attrs) {
  const haystack = `${attrs.name || ""} ${attrs.id || ""} ${attrs.placeholder || ""} ${attrs.label || ""}`;
  for (const [type, pattern] of Object.entries(FIELD_PATTERNS)) {
    if (pattern.test(haystack)) return type;
  }
  return null;
}

// url: doldurulacak form sayfasının adresi (genelde brand.wholesale_page_url).
// fillData: { name, email, company, phone, message } — Ayarlar'daki bilgiler +
// marka adı kullanılarak route tarafında hazırlanır.
// Döner: { screenshotBase64, filledFields: [...], warning? }
async function fillWholesaleForm(url, fillData) {
  const playwright = loadPlaywright();
  if (!playwright) {
    throw new Error(
      "Bu özellik için 'playwright' paketi kurulu değil. Sunucuda şunu çalıştırıp yeniden başlatman gerekiyor: " +
        "npm install playwright && npx playwright install chromium"
    );
  }
  const { chromium } = playwright;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });

    const inputs = await page.$$("input, textarea");
    const filledFields = [];

    for (const input of inputs) {
      const attrs = await input.evaluate((el) => ({
        type: (el.getAttribute("type") || "").toLowerCase(),
        name: el.getAttribute("name") || "",
        id: el.getAttribute("id") || "",
        placeholder: el.getAttribute("placeholder") || "",
        label:
          (el.labels && el.labels[0] && el.labels[0].textContent) ||
          (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent) ||
          "",
      }));
      if (["hidden", "submit", "button", "checkbox", "radio", "file"].includes(attrs.type)) continue;

      const fieldType = guessFieldType(attrs);
      if (!fieldType || !fillData[fieldType]) continue;

      try {
        await input.fill(String(fillData[fieldType]));
        filledFields.push({ field: fieldType, selector: attrs.name || attrs.id || "(isimsiz alan)" });
      } catch (e) {
        // tek bir alan doldurulamazsa (ör. görünmez/devre dışı) diğerlerine devam et
      }
    }

    const screenshotBuffer = await page.screenshot({ fullPage: true });
    await browser.close();

    return {
      screenshotBase64: screenshotBuffer.toString("base64"),
      filledFields,
      warning:
        filledFields.length === 0
          ? "Formda otomatik doldurulabilecek bilinen bir alan bulunamadı — sayfayı elle kontrol et."
          : null,
    };
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
}

module.exports = { isAvailable, fillWholesaleForm };
