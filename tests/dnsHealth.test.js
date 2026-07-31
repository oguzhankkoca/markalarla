// SPF/DKIM/DMARC canlı DNS doğrulaması. Gerçek ağ isteği ATMAZ — dns.promises.resolveTxt
// process genelinde tek bir singleton olduğu için (mxCheck.test.js'teki aynı teknik),
// geçici olarak sahte kayıtlar döndüren bir fonksiyonla değiştirip test bitince
// eski haline döndürüyoruz.
const { check, summaryAndExit } = require("./_helpers");
const dns = require("dns").promises;
const { checkSpf, checkDmarc, checkDkim } = require("../src/services/dnsCheck");

console.log("dnsHealth.test.js — SPF/DKIM/DMARC canlı doğrulama");

const originalResolveTxt = dns.resolveTxt;

async function withMockedResolveTxt(impl, fn) {
  dns.resolveTxt = impl;
  try {
    await fn();
  } finally {
    dns.resolveTxt = originalResolveTxt;
  }
}

async function run() {
  await withMockedResolveTxt(
    async (hostname) => {
      if (hostname === "example.com") return [["v=spf1 include:_spf.google.com ~all"]];
      const e = new Error("no data");
      e.code = "ENODATA";
      throw e;
    },
    async () => {
      await check("SPF kaydı bulunduğunda found:true döner", async () => {
        const result = await checkSpf("example.com");
        if (!result.found || !result.record.startsWith("v=spf1")) {
          throw new Error(`Beklenmeyen sonuç: ${JSON.stringify(result)}`);
        }
      });
    }
  );

  await withMockedResolveTxt(
    async () => {
      const e = new Error("no data");
      e.code = "ENODATA";
      throw e;
    },
    async () => {
      await check("SPF kaydı yoksa (ENODATA) found:false döner (hata fırlatmaz)", async () => {
        const result = await checkSpf("no-spf.com");
        if (result.checked !== true || result.found !== false) {
          throw new Error(`Beklenmeyen sonuç: ${JSON.stringify(result)}`);
        }
      });
    }
  );

  await withMockedResolveTxt(
    async () => {
      const e = new Error("timeout");
      e.code = "ETIMEOUT";
      throw e;
    },
    async () => {
      await check("Geçici DNS hatasında checked:false (unknown, cezalandırmaz)", async () => {
        const result = await checkSpf("flaky.com");
        if (result.checked !== false || result.found !== null) {
          throw new Error(`Beklenmeyen sonuç: ${JSON.stringify(result)}`);
        }
      });
    }
  );

  await withMockedResolveTxt(
    async (hostname) => {
      if (hostname === "_dmarc.example.com") return [["v=DMARC1; p=reject; rua=mailto:a@example.com"]];
      const e = new Error("no data");
      e.code = "ENODATA";
      throw e;
    },
    async () => {
      await check("DMARC policy doğru ayıklanır (p=reject)", async () => {
        const result = await checkDmarc("example.com");
        if (!result.found || result.policy !== "reject") {
          throw new Error(`Beklenmeyen sonuç: ${JSON.stringify(result)}`);
        }
      });
    }
  );

  await withMockedResolveTxt(
    async (hostname) => {
      if (hostname === "google._domainkey.example.com") return [["v=DKIM1; k=rsa; p=ABC123"]];
      const e = new Error("no data");
      e.code = "ENODATA";
      throw e;
    },
    async () => {
      await check("DKIM, bilinen selector'lardan biriyle (google) bulunur", async () => {
        const result = await checkDkim("example.com");
        if (!result.found || !result.selectors.includes("google")) {
          throw new Error(`Beklenmeyen sonuç: ${JSON.stringify(result)}`);
        }
      });
    }
  );

  await withMockedResolveTxt(
    async () => {
      const e = new Error("no data");
      e.code = "ENODATA";
      throw e;
    },
    async () => {
      await check("DKIM hiçbir selector'da bulunamazsa found:false + not (kesin 'yok' demez)", async () => {
        const result = await checkDkim("no-dkim.com");
        if (result.found !== false || !result.note) {
          throw new Error(`Beklenmeyen sonuç: ${JSON.stringify(result)}`);
        }
      });
    }
  );

  summaryAndExit();
}

run();
