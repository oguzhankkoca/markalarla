// v66: index.html'i tek bir kalabalık sayfa olmaktan çıkarıp, URL hash'ine göre
// (#marka-listesi, #marka-ekle, #mail-sablonu, #crm-pipeline, #ayarlar) tek bir
// bölümü gösteren/diğerlerini gizleyen basit bir "görünüm yönlendiricisi".
//
// BİLİNÇLİ TASARIM KARARI: app.js'i sayfalara bölmek yerine (ki bu, 2000+ satırlık,
// birbirine sıkı bağlı, hiçbir null-check içermeyen kodu riskli şekilde yeniden
// yazmayı gerektirirdi) tüm mevcut HTML/JS/id'ler AYNEN korunuyor — bu script SADECE
// hangi <section class="view"> bölümünün görünür olduğunu değiştiriyor. Böylece
// gönderim/filtreleme/CRM gibi hiçbir özellik bozulma riski taşımadan kullanıcı
// gerçek, odaklı, ayrı "sayfalar" arasında geziniyormuş gibi bir deneyim alıyor.
(function () {
  const VIEWS = {
    "marka-listesi": {
      title: "Marka Listesi",
      subtitle: "Marka listeni filtrele, seç ve gönder.",
    },
    "marka-ekle": {
      title: "Yeni Marka Ekle",
      subtitle: "Excel/CSV yükle, e-mail ara.",
    },
    "mail-sablonu": {
      title: "Mail Şablonu",
      subtitle: "Konu ve içerik metnini hazırla.",
    },
    "crm-pipeline": {
      title: "CRM Pipeline",
      subtitle: "Markaları satış aşamalarına göre gör ve yönet.",
    },
    "ayarlar": {
      title: "Ayarlar",
      subtitle: "Profil, DNS, gönderim limiti, kara liste.",
    },
  };
  const DEFAULT_VIEW = "marka-listesi";

  function currentViewFromHash() {
    const raw = (window.location.hash || "").replace(/^#/, "");
    return VIEWS[raw] ? raw : DEFAULT_VIEW;
  }

  function activateView(view) {
    document.querySelectorAll(".view").forEach((el) => {
      el.classList.toggle("active", el.getAttribute("data-view") === view);
    });
    document.querySelectorAll(".nav-link[data-view]").forEach((link) => {
      link.classList.toggle("active", link.getAttribute("data-view") === view);
    });
    const meta = VIEWS[view];
    const titleEl = document.getElementById("pageTitle");
    const subtitleEl = document.getElementById("pageSubtitle");
    if (meta && titleEl) titleEl.textContent = meta.title;
    if (meta && subtitleEl) subtitleEl.textContent = meta.subtitle;
  }

  function render() {
    activateView(currentViewFromHash());
  }

  window.addEventListener("hashchange", render);
  // "#marka-listesi" gibi görünür/anlamlı linkler (kart içi yönlendirmeler,
  // ör. "Bulduktan sonra Marka Listesi'nden gönderebilirsin") data-view-link
  // ile işaretli — normal <a href="#..."> davranışı zaten hashchange'i tetikler,
  // burada ekstra bir şey yapmaya gerek yok.
  render();
})();
