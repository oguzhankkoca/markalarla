// Bounce oranı güvenlik freni (circuit breaker) — eşik altı/üstü davranışı ve
// "sadece bir kez tetiklenir" garantisi.
//
// Not: EMAIL_APP_PASSWORD kasıtlı olarak AYARLANMIYOR, böylece mailer.isConfigured()
// false döner ve bildirim maili denemesi gerçek bir SMTP bağlantısı açmadan (anında
// reddedilip .catch ile yutularak) güvenle test edilebilir.
const { useTempDataDir, check, summaryAndExit } = require("./_helpers");
const tmpDir = useTempDataDir();
process.env.EMAIL_USER = "wholesale@neofa.net";
delete process.env.EMAIL_APP_PASSWORD;

const db = require("../src/db");
const {
  checkAndUpdateCircuitBreaker,
  CIRCUIT_BREAKER_MIN_SAMPLE,
  CIRCUIT_BREAKER_THRESHOLD,
} = require("../src/routes/tracking");

console.log("circuitBreaker.test.js — Bounce oranı güvenlik freni");

const insertBrand = db.prepare(
  `INSERT INTO brands (batch, name, email, status, sent_at) VALUES (?, ?, ?, ?, ?)`
);
const getSettings = () => db.prepare("SELECT * FROM settings WHERE id = 1").get();

const now = new Date().toISOString();

async function run() {
  await check("sabitler beklenen değerlerde (eşik %30, min örneklem 5)", () => {
    if (CIRCUIT_BREAKER_MIN_SAMPLE !== 5 || CIRCUIT_BREAKER_THRESHOLD !== 0.3) {
      throw new Error(
        `Beklenmeyen sabitler: MIN_SAMPLE=${CIRCUIT_BREAKER_MIN_SAMPLE} THRESHOLD=${CIRCUIT_BREAKER_THRESHOLD}`
      );
    }
  });

  await check("örneklem eşiğin altındaysa (min 5) yüksek bounce oranı olsa bile tetiklenmez", () => {
    // 2 gönderim, 2 bounce = %100 oran ama toplam örneklem 5'in altında
    insertBrand.run("b1", "A", "a@x.com", "bounced", now);
    insertBrand.run("b1", "B", "b@x.com", "bounced", now);
    const result = checkAndUpdateCircuitBreaker();
    if (result.justTripped) throw new Error("Düşük örneklemde yanlışlıkla tetiklendi");
    if (getSettings().circuit_breaker_active) throw new Error("Fren yanlışlıkla aktifleşti");
  });

  await check("örneklem >=5 ve oran >=%30 ise fren devreye girer", () => {
    // Toplamda 5'e tamamla: 3 sent (bounce değil) daha ekle -> toplam 5, bounce 2 -> %40
    insertBrand.run("b1", "C", "c@x.com", "sent", now);
    insertBrand.run("b1", "D", "d@x.com", "sent", now);
    insertBrand.run("b1", "E", "e@x.com", "sent", now);
    const result = checkAndUpdateCircuitBreaker();
    if (!result.justTripped) throw new Error(`Fren tetiklenmeliydi, sonuç: ${JSON.stringify(result)}`);
    if (Math.abs(result.rate - 0.4) > 0.001) throw new Error(`Beklenen oran 0.4, gelen: ${result.rate}`);
    if (!getSettings().circuit_breaker_active) throw new Error("settings.circuit_breaker_active=1 olmalıydı");
  });

  await check("fren zaten aktifken tekrar 'justTripped' döndürmez (spam bildirim önlenir)", () => {
    const result = checkAndUpdateCircuitBreaker();
    if (result.justTripped) throw new Error("Zaten aktif frende tekrar tetiklenme bayrağı dönmemeliydi");
  });

  await check("bildirim zaman damgası sadece bir kez set edilir", () => {
    const notifiedAt = getSettings().circuit_breaker_notified_at;
    if (!notifiedAt) throw new Error("circuit_breaker_notified_at set edilmemiş");
    checkAndUpdateCircuitBreaker();
    const notifiedAt2 = getSettings().circuit_breaker_notified_at;
    if (notifiedAt !== notifiedAt2) throw new Error("Bildirim zaman damgası tekrar değişti (ikinci mail riski)");
  });

  summaryAndExit(tmpDir);
}

run();
