// Ülke bazlı gönderim saati — isLikelyBusinessHoursForCountry saf mantığı.
// Bilinmeyen/eşleşmeyen ülkeler için fail-open (true) davranışını ve bilinen
// bir ülke için doğru yerel saat hesaplamasını doğrular.
const { useTempDataDir, check, summaryAndExit } = require("./_helpers");
const tmpDir = useTempDataDir();

const { isLikelyBusinessHoursForCountry } = require("../src/routes/brands");

console.log("sendTiming.test.js — Ülke bazlı gönderim saati");

async function run() {
  await check("bilinmeyen ülke -> fail-open, her zaman true döner", () => {
    if (!isLikelyBusinessHoursForCountry("Atlantis", new Date())) {
      throw new Error("Bilinmeyen ülke engellenmemeliydi");
    }
  });

  await check("ülke boş/null -> fail-open, true döner", () => {
    if (!isLikelyBusinessHoursForCountry(null, new Date())) {
      throw new Error("Boş ülke engellenmemeliydi");
    }
    if (!isLikelyBusinessHoursForCountry("", new Date())) {
      throw new Error("Boş string engellenmemeliydi");
    }
  });

  await check("Türkiye (UTC+3) için 09:00 UTC -> yerel 12:00, iş saatleri içinde", () => {
    const fakeNow = new Date(Date.UTC(2026, 0, 15, 9, 0, 0));
    if (!isLikelyBusinessHoursForCountry("turkey", fakeNow)) {
      throw new Error("12:00 yerel saat iş saatleri içinde sayılmalıydı");
    }
  });

  await check("Türkiye (UTC+3) için 20:00 UTC -> yerel 23:00, iş saatleri DIŞINDA", () => {
    const fakeNow = new Date(Date.UTC(2026, 0, 15, 20, 0, 0));
    if (isLikelyBusinessHoursForCountry("türkiye", fakeNow)) {
      throw new Error("23:00 yerel saat iş saatleri dışında sayılmalıydı");
    }
  });

  await check("ABD (UTC-5) için 14:00 UTC -> yerel 09:00, iş saatleri sınırında (dahil)", () => {
    const fakeNow = new Date(Date.UTC(2026, 0, 15, 14, 0, 0));
    if (!isLikelyBusinessHoursForCountry("United States", fakeNow)) {
      throw new Error("09:00 yerel saat iş saatlerine dahil olmalıydı");
    }
  });

  await check("Hindistan (UTC+5.5, kesirli ofset) doğru hesaplanır", () => {
    // 06:00 UTC + 5.5 = 11:30 yerel -> iş saatleri içinde
    const fakeNow = new Date(Date.UTC(2026, 0, 15, 6, 0, 0));
    if (!isLikelyBusinessHoursForCountry("india", fakeNow)) {
      throw new Error("11:30 yerel saat (Hindistan) iş saatleri içinde sayılmalıydı");
    }
  });

  await check("büyük/küçük harf ve boşluğa duyarsız eşleşme (case-insensitive)", () => {
    const fakeNow = new Date(Date.UTC(2026, 0, 15, 9, 0, 0));
    if (!isLikelyBusinessHoursForCountry("  TURKEY  ", fakeNow)) {
      throw new Error("Büyük harf/boşluklu ülke adı eşleşmedi");
    }
  });

  summaryAndExit(tmpDir);
}

run();
