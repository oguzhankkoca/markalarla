// MX kaydı kontrolünün üç yönlü sınıflandırması: true (MX var), false (MX
// kesinlikle yok — ENOTFOUND/ENODATA), null (geçici/bilinmeyen bir DNS hatası,
// CEZALANDIRILMAMALI). Gerçek ağ isteği ATMAZ — Node'un yerleşik `dns` modülü
// process genelinde tek bir singleton olduğu için, dns.promises.resolveMx'i
// geçici olarak sahte bir fonksiyonla değiştirip test bitince eski haline
// döndürüyoruz (checkMxRecords bu modülü require ile aynı referanstan kullanıyor).
const { check, summaryAndExit } = require("./_helpers");
const dns = require("dns").promises;
const { checkMxRecords } = require("../src/services/emailFinder");

console.log("mxCheck.test.js — MX kaydı üç yönlü sınıflandırma");

const originalResolveMx = dns.resolveMx;

async function withMockedResolveMx(impl, fn) {
  dns.resolveMx = impl;
  try {
    await fn();
  } finally {
    dns.resolveMx = originalResolveMx;
  }
}

async function run() {
  await withMockedResolveMx(
    async () => [{ exchange: "mail.example.com", priority: 10 }],
    async () => {
      await check("MX kaydı varsa true döner", async () => {
        const result = await checkMxRecords("example.com");
        if (result !== true) throw new Error(`Beklenen true, gelen: ${result}`);
      });
    }
  );

  await withMockedResolveMx(
    async () => {
      const e = new Error("not found");
      e.code = "ENOTFOUND";
      throw e;
    },
    async () => {
      await check("ENOTFOUND -> false (MX kesinlikle yok)", async () => {
        const result = await checkMxRecords("nonexistent-domain-xyz.com");
        if (result !== false) throw new Error(`Beklenen false, gelen: ${result}`);
      });
    }
  );

  await withMockedResolveMx(
    async () => {
      const e = new Error("no data");
      e.code = "ENODATA";
      throw e;
    },
    async () => {
      await check("ENODATA -> false (MX kesinlikle yok)", async () => {
        const result = await checkMxRecords("no-mx-domain.com");
        if (result !== false) throw new Error(`Beklenen false, gelen: ${result}`);
      });
    }
  );

  await withMockedResolveMx(
    async () => {
      const e = new Error("connection refused");
      e.code = "ECONNREFUSED";
      throw e;
    },
    async () => {
      await check("ECONNREFUSED (geçici ağ sorunu) -> null, CEZALANDIRILMAZ", async () => {
        const result = await checkMxRecords("some-domain.com");
        if (result !== null) throw new Error(`Beklenen null, gelen: ${result}`);
      });
    }
  );

  await withMockedResolveMx(
    async () => {
      const e = new Error("timeout");
      e.code = "ETIMEOUT";
      throw e;
    },
    async () => {
      await check("Zaman aşımı (ETIMEOUT) -> null, CEZALANDIRILMAZ", async () => {
        const result = await checkMxRecords("slow-domain.com");
        if (result !== null) throw new Error(`Beklenen null, gelen: ${result}`);
      });
    }
  );

  summaryAndExit();
}

run();
