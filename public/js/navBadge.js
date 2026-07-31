// Sidebar'daki "Mail Merkezi" linkinin yanında toplam yanıt sayısını gösteren
// küçük rozet — üç sayfada da (Marka Keşif, Mail Merkezi, Dashboard) aynı şekilde
// çalışsın diye ortak bir script'e alındı. Hata olursa (ör. henüz hiç veri yok)
// rozeti sessizce gizler, sayfanın geri kalanını etkilemez.
(async function () {
  try {
    const res = await fetch("/api/tracking");
    if (!res.ok) return;
    const data = await res.json();
    const repliedCount = (data.brands || []).filter((b) => b.replied).length;
    const badge = document.getElementById("navMailBadge");
    if (!badge) return;
    if (repliedCount > 0) {
      badge.textContent = repliedCount;
      badge.style.display = "";
    }
  } catch (e) {
    // sessizce yut — rozet olmadan da sayfa normal çalışmaya devam eder
  }
})();
