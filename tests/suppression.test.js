// Kalıcı "bir daha yazma" (suppression) listesinin ekleme/çıkarma ve
// brands.suppressed denormalize bayrağıyla senkron kalması.
const { useTempDataDir, check, summaryAndExit } = require("./_helpers");
const tmpDir = useTempDataDir();

const db = require("../src/db");
const {
  isSuppressed,
  addToSuppressionList,
  removeFromSuppressionList,
  listSuppressed,
} = require("../src/services/suppression");

console.log("suppression.test.js — Kalıcı bir daha yazma listesi");

const insertBrand = db.prepare(
  "INSERT INTO brands (batch, name, email, status) VALUES (?, ?, ?, ?)"
);
const getBrand = db.prepare("SELECT * FROM brands WHERE id = ?");

async function run() {
  await check("bilinmeyen e-posta suppress değildir", () => {
    if (isSuppressed("nobody@nowhere.com")) throw new Error("Yanlışlıkla suppressed döndü");
  });

  const brandId = insertBrand.run("b1", "BrandA", "unsub@example.com", "sent").lastInsertRowid;

  await check("addToSuppressionList sonrası isSuppressed true döner", () => {
    addToSuppressionList("unsub@example.com", "unsubscribe isteği", "BrandA");
    if (!isSuppressed("UNSUB@Example.com")) throw new Error("Büyük/küçük harf duyarsız kontrol başarısız");
  });

  await check("addToSuppressionList, brands.suppressed bayrağını da günceller", () => {
    const brand = getBrand.get(brandId);
    if (brand.suppressed !== 1) throw new Error(`brands.suppressed=1 olmalıydı, geldi: ${brand.suppressed}`);
  });

  await check("listSuppressed eklenen kaydı içerir", () => {
    const list = listSuppressed();
    const found = list.find((r) => r.email === "unsub@example.com");
    if (!found || found.reason !== "unsubscribe isteği") {
      throw new Error(`Liste beklenen kaydı içermiyor: ${JSON.stringify(list)}`);
    }
  });

  await check("removeFromSuppressionList sonrası isSuppressed false döner ve bayrak sıfırlanır", () => {
    removeFromSuppressionList("unsub@example.com");
    if (isSuppressed("unsub@example.com")) throw new Error("Çıkarıldıktan sonra hâlâ suppressed görünüyor");
    const brand = getBrand.get(brandId);
    if (brand.suppressed !== 0) throw new Error(`brands.suppressed=0 olmalıydı, geldi: ${brand.suppressed}`);
  });

  summaryAndExit(tmpDir);
}

run();
