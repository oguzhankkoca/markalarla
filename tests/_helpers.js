// Test dosyaları arasında paylaşılan küçük yardımcılar. Harici bir test
// framework'üne (jest/mocha) ihtiyaç duymadan, sadece Node'un yerleşik
// assert modülüyle basit bir "check" yardımcısı sağlar.
const os = require("os");
const fs = require("fs");
const path = require("path");

// ÖNEMLİ: Bu satır, bu dosyayı require eden test dosyasının en üstünde,
// "../src/db" ya da onu dolaylı olarak require eden herhangi bir modül
// (routes/brands.js, routes/tracking.js vb.) require edilmeden ÖNCE
// çalışmalıdır — aksi halde gerçek data/ klasöründeki veritabanı açılır.
function useTempDataDir() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "brand-outreach-test-"));
  process.env.DATA_DIR = tmpDir;
  return tmpDir;
}

let passCount = 0;
let failCount = 0;

// fn hem senkron hem de async (Promise döndüren) olabilir — her iki durumda da
// çağıran taraf `await check(...)` ile bekleyebilir (senkron durumda await no-op'tur).
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passCount++;
  } catch (e) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
    failCount++;
  }
}

function summaryAndExit(tmpDir) {
  if (tmpDir) {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {
      // temizlik başarısız olsa bile test sonucunu etkilemesin
    }
  }
  console.log(`  (${passCount} geçti, ${failCount} başarısız)\n`);
  if (failCount > 0) process.exit(1);
}

module.exports = { useTempDataDir, check, summaryAndExit };
