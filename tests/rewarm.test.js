// Soğuk marka yeniden ısıtma (opt-in) — sessiz kalan / olumsuz yanıt veren
// markaların doğru şekilde seçilip yeniden "found" durumuna alındığını, kalıcı
// suppression listesinin HER ZAMAN önceliği olduğunu ve rewarm_count sınırının
// (en fazla 2) uygulandığını doğrular.
const { useTempDataDir, check, summaryAndExit } = require("./_helpers");
const tmpDir = useTempDataDir();
process.env.EMAIL_USER = "wholesale@neofa.net";
delete process.env.EMAIL_APP_PASSWORD;

const db = require("../src/db");
const { reWarmColdBrands } = require("../src/routes/tracking");
const { addToSuppressionList } = require("../src/services/suppression");

console.log("rewarm.test.js — Soğuk marka yeniden ısıtma");

function daysAgoIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

const insert = db.prepare(`
  INSERT INTO brands (
    batch, name, email, status, sent_at, replied, bounced, reply_sentiment,
    follow_up_stage, last_follow_up_at, last_checked_at, rewarm_count, suppressed
  ) VALUES (@batch, @name, @email, @status, @sent_at, @replied, @bounced, @reply_sentiment,
    @follow_up_stage, @last_follow_up_at, @last_checked_at, @rewarm_count, @suppressed)
`);
const getBrand = db.prepare("SELECT * FROM brands WHERE id = ?");

async function run() {
  await check("rewarm_enabled kapalıyken hiçbir şey yapmaz", () => {
    const result = reWarmColdBrands();
    if (result.reason !== "disabled" || result.rewarmed !== 0) {
      throw new Error(`Beklenmeyen sonuç: ${JSON.stringify(result)}`);
    }
  });

  db.prepare("UPDATE settings SET rewarm_enabled = 1 WHERE id = 1").run();

const silentId = insert.run({
  batch: "b1", name: "SilentBrand", email: "silent@x.com", status: "sent",
  sent_at: daysAgoIso(130), replied: 0, bounced: 0, reply_sentiment: null,
  follow_up_stage: 3, last_follow_up_at: daysAgoIso(125), last_checked_at: daysAgoIso(125),
  rewarm_count: 0, suppressed: 0,
}).lastInsertRowid;

const tooRecentId = insert.run({
  batch: "b1", name: "RecentSilentBrand", email: "recent@x.com", status: "sent",
  sent_at: daysAgoIso(10), replied: 0, bounced: 0, reply_sentiment: null,
  follow_up_stage: 3, last_follow_up_at: daysAgoIso(5), last_checked_at: daysAgoIso(5),
  rewarm_count: 0, suppressed: 0,
}).lastInsertRowid;

const negativeId = insert.run({
  batch: "b1", name: "NegativeBrand", email: "negative@x.com", status: "sent",
  sent_at: daysAgoIso(200), replied: 1, bounced: 0, reply_sentiment: "negative",
  follow_up_stage: 1, last_follow_up_at: daysAgoIso(190), last_checked_at: daysAgoIso(190),
  rewarm_count: 0, suppressed: 0,
}).lastInsertRowid;

const suppressedNegativeId = insert.run({
  batch: "b1", name: "SuppressedNegativeBrand", email: "suppressed@x.com", status: "sent",
  sent_at: daysAgoIso(200), replied: 1, bounced: 0, reply_sentiment: "negative",
  follow_up_stage: 1, last_follow_up_at: daysAgoIso(190), last_checked_at: daysAgoIso(190),
  rewarm_count: 0, suppressed: 0,
}).lastInsertRowid;
addToSuppressionList("suppressed@x.com", "unsubscribe", "SuppressedNegativeBrand");

const maxedOutId = insert.run({
  batch: "b1", name: "MaxedOutBrand", email: "maxed@x.com", status: "sent",
  sent_at: daysAgoIso(200), replied: 1, bounced: 0, reply_sentiment: "negative",
  follow_up_stage: 1, last_follow_up_at: daysAgoIso(190), last_checked_at: daysAgoIso(190),
  rewarm_count: 2, suppressed: 0,
}).lastInsertRowid;

  await check("120+ gün sessiz kalan uygun marka ısıtılır, 10 günlük marka ısıtılmaz", () => {
    const result = reWarmColdBrands();
    if (!result.brands.includes("SilentBrand")) {
      throw new Error(`SilentBrand ısıtılmalıydı: ${JSON.stringify(result)}`);
    }
    if (result.brands.includes("RecentSilentBrand")) {
      throw new Error("RecentSilentBrand (henüz 120 gün olmamış) yanlışlıkla ısıtıldı");
    }
  });

  await check("180+ gün önce olumsuz yanıt veren marka ısıtılır", () => {
    const brand = getBrand.get(negativeId);
    if (brand.status !== "found") throw new Error(`NegativeBrand status 'found' olmalıydı, geldi: ${brand.status}`);
    if (brand.rewarm_count !== 1) throw new Error(`rewarm_count 1 olmalıydı, geldi: ${brand.rewarm_count}`);
    if (!brand.notes || !brand.notes.includes("Otomatik yeniden ısıtma")) {
      throw new Error("Not alanına ısıtma kaydı eklenmemiş");
    }
  });

  await check("suppression listesindeki adres UYGUN OLSA BİLE asla ısıtılmaz", () => {
    const brand = getBrand.get(suppressedNegativeId);
    if (brand.status !== "sent") {
      throw new Error(`Suppress edilmiş marka yanlışlıkla ısıtıldı, status: ${brand.status}`);
    }
  });

  await check("rewarm_count zaten 2 olan marka bir daha ısıtılmaz", () => {
    const brand = getBrand.get(maxedOutId);
    if (brand.status !== "sent" || brand.rewarm_count !== 2) {
      throw new Error(`Limit aşan marka yanlışlıkla tekrar ısıtıldı: ${JSON.stringify(brand)}`);
    }
  });

  await check("ısıtılan markanın takip alanları sıfırlanır (yeni bir gönderim döngüsü gibi)", () => {
    const brand = getBrand.get(silentId);
    if (brand.replied !== 0 || brand.follow_up_stage !== 0 || brand.bounced !== 0) {
      throw new Error(`Takip alanları sıfırlanmamış: ${JSON.stringify(brand)}`);
    }
  });

  summaryAndExit(tmpDir);
}

run();
