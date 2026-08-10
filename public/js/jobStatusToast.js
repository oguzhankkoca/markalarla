// Sağ üstte sabit kalan ilerleme kartı — toplu gönderim ya da toplu email arama
// sunucuda arka planda devam ederken, kullanıcı hangi sayfada olursa olsun
// (Marka Keşif, Dashboard, Gönderim Takibi) ilerlemeyi görebilsin diye bu
// dosya HER ÜÇ sayfada da yükleniyor. Kart HTML'i sayfada zaten varsa (index.html)
// onu kullanır, yoksa (tracking.html/analytics.html) burada oluşturup body'e ekler.
(function () {
  function ensureToastMarkup() {
    let el = document.getElementById("progressToast");
    if (el) return el;
    el = document.createElement("div");
    el.id = "progressToast";
    el.className = "progress-toast";
    el.style.display = "none";
    el.innerHTML =
      '<div class="progress-toast-title"><span id="progressToastTitle">İşlem</span></div>' +
      '<div class="progress-toast-sub" id="progressToastSub"></div>' +
      '<div class="progress-toast-bar"><div class="progress-toast-fill" id="progressToastFill"></div></div>' +
      '<div class="progress-toast-count" id="progressToastCount">0/0</div>';
    document.body.appendChild(el);
    return el;
  }

  window.showProgressToast = function (title) {
    const el = ensureToastMarkup();
    el.classList.remove("done");
    document.getElementById("progressToastTitle").textContent = title;
    document.getElementById("progressToastSub").textContent = "";
    document.getElementById("progressToastFill").style.width = "0%";
    document.getElementById("progressToastCount").textContent = "0/0";
    el.style.display = "";
  };

  window.updateProgressToast = function (done, total, currentName) {
    const el = ensureToastMarkup();
    if (el.style.display === "none") el.style.display = "";
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    document.getElementById("progressToastSub").textContent = currentName ? `İşleniyor: ${currentName}` : "";
    document.getElementById("progressToastFill").style.width = `${pct}%`;
    document.getElementById("progressToastCount").textContent = `${done}/${total}`;
  };

  window.finishProgressToast = function (doneCount) {
    const el = document.getElementById("progressToast");
    if (!el) return;
    el.classList.add("done");
    document.getElementById("progressToastSub").textContent = `✓ ${doneCount} tamamlandı`;
    document.getElementById("progressToastFill").style.width = "100%";
    // Birkaç saniye "tamamlandı" olarak görünür kalsın, sonra kendiliğinden kaybolsun.
    setTimeout(() => {
      el.style.display = "none";
    }, 4000);
  };

  // Marka Keşif sayfasında (index.html/app.js) zaten kendi butonlarını/durum
  // metnini de güncelleyen daha DETAYLI bir polling var (findAllBtn vb. o
  // sayfaya özel elemanlar). Orada tekrar (ikinci) bir genel polling başlatıp
  // aynı uç noktaları gereksiz yere iki kere sorgulamamak için, bu sayfada
  // olup olmadığımızı "findAllBtn" elemanının varlığından anlıyoruz — sadece
  // Dashboard/Gönderim Takibi gibi DİĞER sayfalarda kendi basit polling'imizi
  // çalıştırıyoruz.
  if (document.getElementById("findAllBtn")) return;

  let currentJobKind = null; // "find" | "send" | null — kartın şu an hangi işi gösterdiğini takip eder

  async function pollOnce() {
    try {
      const [findRes, sendRes, followupRes] = await Promise.all([
        fetch("/api/brands/find-all/status"),
        fetch("/api/brands/send-batch/status"),
        // v75: toplu follow-up gönderimi de arka planda çalışıyor, aynı kartla takip edilir.
        fetch("/api/tracking/send-followup-batch/status").catch(() => null),
      ]);
      const find = await findRes.json();
      const send = await sendRes.json();
      const followup = followupRes ? await followupRes.json() : { running: false, total: 0 };

      if (find.running && find.total > 0) {
        if (currentJobKind !== "find") {
          window.showProgressToast(`🔍 Email Arama (${find.total})`);
          currentJobKind = "find";
        }
        window.updateProgressToast(find.processedCount, find.total, find.currentBrandName);
      } else if (send.running && send.total > 0) {
        if (currentJobKind !== "send") {
          window.showProgressToast(`📤 Toplu Gönderim (${send.total})`);
          currentJobKind = "send";
        }
        const done = send.sentCount + send.failedCount;
        window.updateProgressToast(done, send.total, send.currentBrandName);
      } else if (followup.running && followup.total > 0) {
        if (currentJobKind !== "followup") {
          window.showProgressToast(`✉️ Toplu Follow-up (${followup.total})`);
          currentJobKind = "followup";
        }
        const done = followup.sentCount + followup.failedCount;
        window.updateProgressToast(done, followup.total, followup.currentBrandName);
      } else if (currentJobKind) {
        const doneCount =
          currentJobKind === "find"
            ? find.processedCount
            : currentJobKind === "send"
            ? send.sentCount + send.failedCount
            : followup.sentCount + followup.failedCount;
        window.finishProgressToast(doneCount);
        currentJobKind = null;
      }
    } catch (e) {
      // sessizce geç, kritik değil
    }
  }

  pollOnce();
  setInterval(pollOnce, 3000);
})();
