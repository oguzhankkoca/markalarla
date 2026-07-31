// Kademeli ısınma (warm-up) otomasyonu — getEffectiveDailyLimit saf mantığı.
// DB'ye ihtiyaç duymaz ama import zinciri (routes/brands.js) db.js'i tetiklediği
// için izole bir geçici veritabanı kullanıyoruz (diğer testlerle aynı desen).
const { useTempDataDir, check, summaryAndExit } = require("./_helpers");
const tmpDir = useTempDataDir();

const { getEffectiveDailyLimit } = require("../src/routes/brands");

console.log("warmup.test.js — Kademeli ısınma limit hesaplama");

function daysAgoIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function run() {
  await check("ısınma kapalıysa hedef limit doğrudan kullanılır", () => {
    const limit = getEffectiveDailyLimit({
      daily_send_limit: 60,
      warmup_enabled: 0,
      warmup_started_at: null,
    });
    if (limit !== 60) throw new Error(`Beklenen 60, gelen: ${limit}`);
  });

  await check("ısınma açık ama hiç başlamamışsa (started_at yok) hedef limit kullanılır", () => {
    const limit = getEffectiveDailyLimit({
      daily_send_limit: 60,
      warmup_enabled: 1,
      warmup_started_at: null,
      warmup_start_limit: 10,
      warmup_increment: 10,
    });
    if (limit !== 60) throw new Error(`Beklenen 60, gelen: ${limit}`);
  });

  await check("ısınma yeni başladıysa (0. hafta) başlangıç limiti kullanılır", () => {
    const limit = getEffectiveDailyLimit({
      daily_send_limit: 60,
      warmup_enabled: 1,
      warmup_started_at: daysAgoIso(0),
      warmup_start_limit: 10,
      warmup_increment: 10,
    });
    if (limit !== 10) throw new Error(`Beklenen 10, gelen: ${limit}`);
  });

  await check("2 hafta geçtiyse limit kademeli artar (10 + 2*10 = 30)", () => {
    const limit = getEffectiveDailyLimit({
      daily_send_limit: 60,
      warmup_enabled: 1,
      warmup_started_at: daysAgoIso(15), // 2 tam hafta geçti
      warmup_start_limit: 10,
      warmup_increment: 10,
    });
    if (limit !== 30) throw new Error(`Beklenen 30, gelen: ${limit}`);
  });

  await check("hesaplanan değer hedefi (daily_send_limit) ASLA aşmaz", () => {
    const limit = getEffectiveDailyLimit({
      daily_send_limit: 25,
      warmup_enabled: 1,
      warmup_started_at: daysAgoIso(365), // çok uzun zaman geçmiş
      warmup_start_limit: 10,
      warmup_increment: 10,
    });
    if (limit !== 25) throw new Error(`Hedefi aşmamalıydı, gelen: ${limit}`);
  });

  summaryAndExit(tmpDir);
}

run();
