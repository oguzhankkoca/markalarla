// Bir markanın araştırma/arama işlemi (email bulma ya da Brand Intelligence
// araştırması) bazen — nadir de olsa — beklenmedik bir ağ/DNS/AI API takılmasıyla
// dakikalarca hatta SAATLERCE cevap vermeden asılı kalabiliyordu. Tek tek her HTTP
// isteğinin kendi timeout'u olsa bile (bkz. emailFinder.js/brandIntelligence.js/ai.js),
// bunlar ZİNCİRLEME çalıştığı için (aday domain dene -> bul -> AI ile doğrula ->
// wholesale sayfası dene -> ...) toplamda beklenenden çok daha uzun sürebiliyor, ya da
// çok nadir bir durumda (ör. bir soket beklenenden çok daha geç cevap verirse) bireysel
// timeout'lar bile devreye girmeyebiliyor. Sonuç: toplu işlem kuyruğu (find-all /
// intel/research-bulk) TEK bir markada tıkanıp kalıyor, kuyruktaki DİĞER markalara HİÇ
// geçemiyordu.
//
// Çözüm: markanın araştırma/arama fonksiyonunu bu "üst sınır" ile sarmalıyoruz. Söz
// konusu iş MAX_BRAND_RESEARCH_MS (10 dakika) içinde bitmezse, kuyruk bu markayı
// "bulunamadı/araştırılamadı" sayıp bir SONRAKİ markaya geçer — kullanıcı artık
// panelin saatlerce hiçbir ilerleme göstermediği bir duruma düşmez.
//
// ÖNEMLİ SINIRLAMA: JavaScript'te çalışan bir Promise'i "gerçekten" iptal etmenin
// (altındaki HTTP isteğini anında kesmenin) garantili bir yolu yok — bu yüzden zaman
// aşımına uğrayan işlem arka planda TESLİM OLMADAN çalışmaya devam edebilir ve daha
// sonra kendi kendine bitip veritabanına yazabilir (bu ZARARSIZ, hatta faydalı — iş
// sonunda bitip sonucu kaydedebiliyorsa bu iyi bir şey). Burada garanti edilen şey
// SADECE şudur: kuyruk döngüsü bu markayı bekleyerek 10 dakikadan fazla TIKANIP
// KALMAZ, mutlaka bir sonraki markaya geçer.
const MAX_BRAND_RESEARCH_MS = 10 * 60 * 1000; // 10 dakika

class ResearchTimeoutError extends Error {
  constructor(label, ms) {
    super(`${label} ${Math.round(ms / 60000)} dakika içinde tamamlanamadı (zaman aşımı) — bu marka atlanıp bir sonrakine geçildi.`);
    this.name = "ResearchTimeoutError";
    this.isTimeout = true;
  }
}

// promiseFactory: parametresiz bir fonksiyon olmalı (ör. () => findBrandEmail(...))
// — Promise'in kendisi değil, çünkü bazı çağıranlar zaten başlatılmış bir Promise
// geçirebilir; fonksiyon olarak almak hem tutarlı hem de ileride "henüz başlatma"
// gibi ek mantık eklemeyi kolaylaştırır.
function withResearchTimeout(promise, label, ms = MAX_BRAND_RESEARCH_MS) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new ResearchTimeoutError(label, ms)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

module.exports = { withResearchTimeout, ResearchTimeoutError, MAX_BRAND_RESEARCH_MS };
