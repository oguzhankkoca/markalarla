// Çapraz marka aynı e-posta koruması + kalıcı "bir daha yazma" listesinin
// gönderim kararına doğru şekilde yansıdığını doğrular (gerçek üretim kodu
// çağrılarak — kopya/simülasyon değil).
const { useTempDataDir, check, summaryAndExit } = require("./_helpers");
const tmpDir = useTempDataDir();

const db = require("../src/db");
const { findEmailOwner, resolveStatusAndDuplicateFlag } = require("../src/routes/brands");
const { addToSuppressionList } = require("../src/services/suppression");

console.log("dedup.test.js — Çapraz marka aynı e-posta + suppression");

const insertBrand = db.prepare(
  "INSERT INTO brands (batch, name, email, status) VALUES (?, ?, ?, ?)"
);

const ownerId = insertBrand.run("b1", "BrandA", "info@example.com", "sent").lastInsertRowid;
const dupId = insertBrand.run("b1", "BrandB", "INFO@Example.com ", "pending").lastInsertRowid;
const freshId = insertBrand.run("b1", "BrandC", "fresh@newcompany.com", "pending").lastInsertRowid;

async function run() {
  await check("findEmailOwner: aynı e-postayı büyük/küçük harf ve boşluğa duyarsız bulur", () => {
    const owner = findEmailOwner("  info@EXAMPLE.com  ", dupId);
    if (!owner || owner.id !== ownerId) {
      throw new Error(`Beklenen sahip id=${ownerId}, bulunan: ${JSON.stringify(owner)}`);
    }
  });

  await check("findEmailOwner: kendi kaydını (excludeId) hariç tutar", () => {
    const owner = findEmailOwner("info@example.com", ownerId);
    if (owner) throw new Error(`Kendi kaydı sahip olarak dönmemeli, dönen: ${JSON.stringify(owner)}`);
  });

  await check("resolveStatusAndDuplicateFlag: başka markaya ait e-posta -> duplicate_blocked", () => {
    const result = resolveStatusAndDuplicateFlag("info@example.com", dupId);
    if (result.status !== "duplicate_blocked" || result.crossBrandDuplicate !== 1) {
      throw new Error(`Beklenmeyen sonuç: ${JSON.stringify(result)}`);
    }
  });

  await check("resolveStatusAndDuplicateFlag: yeni/temiz e-posta -> found", () => {
    const result = resolveStatusAndDuplicateFlag("fresh@newcompany.com", freshId);
    if (result.status !== "found" || result.crossBrandDuplicate !== 0) {
      throw new Error(`Beklenmeyen sonuç: ${JSON.stringify(result)}`);
    }
  });

  await check("resolveStatusAndDuplicateFlag: e-posta yok -> not_found", () => {
    const result = resolveStatusAndDuplicateFlag(null, freshId);
    if (result.status !== "not_found") {
      throw new Error(`Beklenmeyen sonuç: ${JSON.stringify(result)}`);
    }
  });

  await check("resolveStatusAndDuplicateFlag: suppression listesi, sahiplik kontrolünden ÖNCE gelir", () => {
    addToSuppressionList("blocked@company.com", "unsubscribe", "BrandX");
    const blockedId = insertBrand.run("b1", "BrandY", "blocked@company.com", "pending").lastInsertRowid;
    const result = resolveStatusAndDuplicateFlag("blocked@company.com", blockedId);
    if (result.status !== "duplicate_blocked") {
      throw new Error(`Suppression listesindeki adres engellenmedi: ${JSON.stringify(result)}`);
    }
  });

  summaryAndExit(tmpDir);
}

run();
