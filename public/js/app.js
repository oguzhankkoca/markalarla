let batch = null;
let brands = [];
let previewBrandId = null;
const selectedIds = new Set();
let currentFilter = "all";
// Kategori Ağacı: durum sekmelerinden (currentFilter) BAĞIMSIZ, ek bir AND filtresi.
// null ise hiçbir kategori seçilmemiş demektir (tüm kategoriler görünür).
let categoryFilter = null;
// Sayfalandırma: pageSize sayı (20/50/100) ya da "all" (tümü) olabilir. Büyük
// listelerde (500+ marka) tüm tabloyu tek seferde DOM'a basmak yavaşlatabildiği
// için varsayılan 20.
let pageSize = 20;
let currentPage = 1;
// En son yüklenen Excel dosyasının adı/zamanı — "🆕 Yeni Yüklenen" sekmesinin
// etiketinde ("X dosyası, Y marka") göstermek için.
let latestBatchName = null;
let latestBatchUploadedAt = null;

const emailStatusEl = document.getElementById("emailStatus");
const brandsBody = document.getElementById("brandsBody");
const subjectInput = document.getElementById("subjectInput");
const bodyInput = document.getElementById("bodyInput");
const selectAllCheckbox = document.getElementById("selectAllCheckbox");

const previewOverlay = document.getElementById("previewOverlay");
const previewTitle = document.getElementById("previewTitle");
const previewTo = document.getElementById("previewTo");
const previewSubject = document.getElementById("previewSubject");
const previewBody = document.getElementById("previewBody");

// bodyInput/previewBody artık textarea değil, contenteditable bir "rich text" kutusu
// (kalın/italik/liste destekler, başka bir yerden yapıştırılan biçimlendirmeyi korur).
// Toolbar butonları tarayıcının yerleşik execCommand'ıyla çalışır.
function wireRichTextToolbars() {
  document.querySelectorAll(".rte-toolbar").forEach((toolbar) => {
    const editor = document.getElementById(toolbar.dataset.target);
    if (!editor) return;
    toolbar.querySelectorAll(".rte-btn").forEach((btn) => {
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault(); // odağın/imlecin editörden çıkmasını engelle
        editor.focus();
        document.execCommand(btn.dataset.cmd, false, null);
      });
    });
  });
}

// Spam kelime kontrolü gibi düz metin analizleri için HTML etiketlerinden arındırılmış hali.
function richTextToPlain(html) {
  const tmp = document.createElement("div");
  tmp.innerHTML = html || "";
  return tmp.textContent || tmp.innerText || "";
}

function badge(status) {
  const map = {
    pending: "Bekliyor",
    found: "Bulundu",
    not_found: "Bulunamadı",
    sent: "Gönderildi",
    error: "Hata",
    duplicate_blocked: "Tekrar (Engellendi)",
    bounced: "Ulaşmadı (Geri Döndü)",
  };
  return `<span class="badge ${status}">${map[status] || status}</span>`;
}

function formatMoney(n) {
  if (n === null || n === undefined || n === "") return null;
  return "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

// SmartScout tarzı Excel'lerden gelen marka istihbarat verisini kısaca özetler.
function marketSummary(b) {
  const parts = [];
  if (b.brand_score !== null && b.brand_score !== undefined) parts.push(`Skor: ${b.brand_score}`);
  const revenue = formatMoney(b.est_monthly_revenue);
  if (revenue) parts.push(revenue + "/ay");
  if (b.avg_sellers !== null && b.avg_sellers !== undefined) parts.push(`${b.avg_sellers} satıcı`);
  return parts.length > 0 ? parts.join(" · ") : "-";
}

function hasMarketData(b) {
  return (
    b.brand_score !== null ||
    b.main_category ||
    b.est_monthly_revenue !== null ||
    b.est_monthly_sales !== null ||
    b.avg_price !== null ||
    b.avg_fba_sellers !== null ||
    b.avg_sellers !== null ||
    b.dominant_seller ||
    b.sales_percentage !== null ||
    b.amazon_in_stock_rate !== null ||
    b.avg_rating !== null ||
    b.total_reviews !== null ||
    b.growth_12m !== null ||
    b.product_count !== null ||
    b.storefront_url
  );
}

// Durum filtre sekmeleri (Bulunanlar/Bulunamayanlar/Beklemede/İletişim Formu Olanlar)
// için: bir markanın hangi gruba girdiğini tek yerden belirliyoruz.
// "contact_form": e-maili bulunamamış AMA sitesinde bir iletişim formu tespit
// edilmiş markalar — "Form Aç" ile elle mail atabileceğin markalar, bunları tek
// tek aramak yerine bu sekmeyle hepsine kolayca ulaşabilirsin.
function hasContactFormOnly(b) {
  return !b.email && Boolean(b.contact_page_url);
}

function matchesFilter(b, filter) {
  if (filter === "all") return true;
  // En son yüklenen Excel'deki markalar — bir sonraki Excel yüklendiğinde `batch`
  // değişir, bu markalar otomatik olarak bu sekmeden çıkıp genel listenin/diğer
  // sekmelerin arasına "karışmış" olur (ayrı bir taşıma işlemi gerekmez, zaten
  // hepsi aynı tabloda).
  if (filter === "new_upload") return Boolean(batch) && b.batch === batch;
  // "Yeni Yüklenen" grubunun durumuna göre alt kırılımları — aynı en son yükleme
  // içinde hangi markalara zaten mail gitmiş, hangisinin e-maili bulunmuş, hangisi
  // henüz hiç aranmamış olduğunu tek bakışta ayırt edebilmek için.
  if (filter === "new_sent") return Boolean(batch) && b.batch === batch && b.status === "sent";
  if (filter === "new_found") return Boolean(batch) && b.batch === batch && b.status === "found";
  if (filter === "new_pending") return Boolean(batch) && b.batch === batch && b.status === "pending";
  if (filter === "found") return b.status === "found";
  // İletişim formu bulunan markalar (e-mail yok ama form var) burada değil, sadece
  // "İletişim Formu Olanlar" sekmesinde görünür — aynı marka iki sekmede birden
  // tekrar etmesin diye.
  if (filter === "not_found") return (b.status === "not_found" || b.status === "error") && !hasContactFormOnly(b);
  if (filter === "pending") return b.status === "pending";
  if (filter === "contact_form") return hasContactFormOnly(b);
  // Sistem bu domain'in/e-mail'in markaya gerçekten ait olduğundan tam emin
  // olamadı — bunları göndermeden önce gözden geçirmen ya da "Ara" ile tekrar
  // arattırman için kolayca tek yerde toplayan sekme.
  if (filter === "low_confidence") return b.email && b.confidence === "low";
  if (filter === "duplicate_blocked") return b.status === "duplicate_blocked";
  if (filter === "suppressed") return Boolean(b.suppressed);
  return true;
}

// Kategori Ağacı: Excel'deki "Main Category" sütunundan (main_category) otomatik
// oluşur. Boş/eksik olan markalar "Kategorisiz" grubuna düşer — ama Excel'de hiç
// kategori verisi yoksa (tüm markalar kategorisiz) ağaç hiç gösterilmez, çünkü o
// durumda gruplamanın hiçbir faydası olmaz.
const UNCATEGORIZED_LABEL = "Kategorisiz";

function normalizeCategoryName(b) {
  const c = (b.main_category || "").trim();
  return c || UNCATEGORIZED_LABEL;
}

function matchesCategory(b) {
  if (!categoryFilter) return true;
  return normalizeCategoryName(b) === categoryFilter;
}

// Her marka satırının isim hücresinin altında küçük bir "kategori · ciro" etiketi.
// Kategori bilgisi hiç yoksa (Excel'de sütun yoksa) sessizce hiçbir şey göstermez.
function categoryChip(b) {
  const cat = (b.main_category || "").trim();
  if (!cat) return "";
  const revenue = formatMoney(b.est_monthly_revenue);
  const label = revenue ? `${cat} · ${revenue}/ay` : cat;
  return `<div class="cat-chip" title="${label.replace(/"/g, "&quot;")}">🏷️ ${label}</div>`;
}

// Her kategori için: kaç marka var, toplam tahmini aylık ciro ne kadar, ve kaç
// tanesi "fırsat" (e-maili bulunmuş ama henüz gönderilmemiş — status === 'found').
function computeCategoryTree() {
  const map = new Map();
  let anyCategorized = false;
  for (const b of brands) {
    const cat = (b.main_category || "").trim();
    if (cat) anyCategorized = true;
    const key = cat || UNCATEGORIZED_LABEL;
    if (!map.has(key)) map.set(key, { name: key, count: 0, revenue: 0, opportunity: 0 });
    const row = map.get(key);
    row.count++;
    if (b.est_monthly_revenue !== null && b.est_monthly_revenue !== undefined && b.est_monthly_revenue !== "") {
      row.revenue += Number(b.est_monthly_revenue) || 0;
    }
    if (b.status === "found") row.opportunity++;
  }
  // Excel'de hiç kategori verisi yoksa ağacı hiç gösterme.
  if (!anyCategorized) return [];
  return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue || b.count - a.count);
}

function renderCategoryTree() {
  const container = document.getElementById("categoryTree");
  const details = document.getElementById("categoryTreeDetails");
  if (!container || !details) return;
  const rows = computeCategoryTree();
  document.getElementById("categoryTreeCount").textContent = rows.length;

  if (rows.length === 0) {
    details.style.display = "none";
    return;
  }
  details.style.display = "";

  const totalCount = brands.length;
  const allRowHtml = `
    <div class="category-row cat-all" data-category="">
      <span class="cat-name">Tümü</span>
      <span class="cat-stat">${totalCount} marka</span>
    </div>
  `;
  const rowsHtml = rows
    .map((r) => {
      const active = categoryFilter === r.name ? " active" : "";
      const revenueLabel = r.revenue > 0 ? formatMoney(r.revenue) + "/ay" : "-";
      return `
        <div class="category-row${active}" data-category="${r.name.replace(/"/g, "&quot;")}">
          <span class="cat-name">${r.name}</span>
          <span class="cat-stat">${revenueLabel}</span>
          <span class="cat-stat cat-opportunity">🚀 ${r.opportunity} fırsat</span>
          <span class="cat-stat">${r.count} marka</span>
        </div>
      `;
    })
    .join("");
  container.innerHTML = allRowHtml + rowsHtml;
}

// Bir kategoriye tıklayınca tabloyu o kategoriyle filtreler (mevcut durum sekmesiyle
// birlikte, AND mantığıyla çalışır); aynı kategoriye tekrar tıklayınca filtre kalkar.
document.getElementById("categoryTree").addEventListener("click", (e) => {
  const row = e.target.closest(".category-row");
  if (!row) return;
  const cat = row.dataset.category;
  categoryFilter = !cat || categoryFilter === cat ? null : cat;
  currentPage = 1;
  renderBrands();
});

// Sayfalandırma kontrolleri: sayfa başına 20/50/100/Tümü ve önceki/sonraki.
document.getElementById("pageSizeGroup").addEventListener("click", (e) => {
  const btn = e.target.closest(".page-size-btn");
  if (!btn) return;
  const size = btn.dataset.size;
  pageSize = size === "all" ? "all" : Number(size);
  currentPage = 1;
  renderBrands();
});

document.getElementById("prevPageBtn").addEventListener("click", () => {
  currentPage = Math.max(1, currentPage - 1);
  renderBrands();
});

document.getElementById("nextPageBtn").addEventListener("click", () => {
  currentPage = currentPage + 1;
  renderBrands();
});

function renderFilterTabs() {
  const counts = {
    all: brands.length,
    new_upload: 0,
    new_sent: 0,
    new_found: 0,
    new_pending: 0,
    found: 0,
    not_found: 0,
    pending: 0,
    contact_form: 0,
    low_confidence: 0,
    duplicate_blocked: 0,
    suppressed: 0,
  };
  for (const b of brands) {
    if (b.status === "found") counts.found++;
    else if ((b.status === "not_found" || b.status === "error") && !hasContactFormOnly(b)) counts.not_found++;
    else if (b.status === "pending") counts.pending++;
    else if (b.status === "duplicate_blocked") counts.duplicate_blocked++;
    if (hasContactFormOnly(b)) counts.contact_form++;
    if (b.email && b.confidence === "low") counts.low_confidence++;
    if (b.suppressed) counts.suppressed++;
    if (batch && b.batch === batch) {
      counts.new_upload++;
      if (b.status === "sent") counts.new_sent++;
      else if (b.status === "found") counts.new_found++;
      else if (b.status === "pending") counts.new_pending++;
    }
  }
  const setText = (id, n) => {
    const el = document.getElementById(id);
    if (el) el.textContent = n;
  };
  setText("countAll", counts.all);
  setText("countNewUpload", counts.new_upload);
  setText("countNewSent", counts.new_sent);
  setText("countNewFound", counts.new_found);
  setText("countNewPending", counts.new_pending);
  setText("countFound", counts.found);
  setText("countNotFound", counts.not_found);
  setText("countPending", counts.pending);
  setText("countContactForm", counts.contact_form);
  setText("countLowConfidence", counts.low_confidence);
  setText("countDuplicateBlocked", counts.duplicate_blocked);
  setText("countSuppressed", counts.suppressed);
  document.querySelectorAll(".filter-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.filter === currentFilter);
  });

  // "Yeni Yüklenen" sekmesi, hiç Excel yüklenmemişse (batch yok) ya da eski bir
  // veritabanından geliyorsa (batch_name/uploaded_at hiç dolmamışsa) gösterilmez —
  // eski kayıtlarda bu sütunlar boş olabilir, o zaman sekme anlamsız kalır. Aynı
  // mantık, o batch'in durum bazlı alt-sekmeleri (Gönderildi/Bulundu/Bekliyor)
  // için de geçerli — ilgili durumda hiç marka yoksa sekme gizlenir.
  const newUploadTab = document.getElementById("newUploadTab");
  const newUploadLabel = document.getElementById("newUploadLabel");
  const newSentTab = document.getElementById("newSentTab");
  const newFoundTab = document.getElementById("newFoundTab");
  const newPendingTab = document.getElementById("newPendingTab");
  if (newUploadTab) newUploadTab.style.display = counts.new_upload > 0 ? "" : "none";
  if (newSentTab) newSentTab.style.display = counts.new_sent > 0 ? "" : "none";
  if (newFoundTab) newFoundTab.style.display = counts.new_found > 0 ? "" : "none";
  if (newPendingTab) newPendingTab.style.display = counts.new_pending > 0 ? "" : "none";
  if (newUploadLabel) {
    if (counts.new_upload > 0 && latestBatchName) {
      const dateLabel = latestBatchUploadedAt
        ? new Date(latestBatchUploadedAt).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" })
        : "";
      newUploadLabel.textContent = `🆕 En son yüklenen: "${latestBatchName}" — ${counts.new_upload} marka${dateLabel ? " · " + dateLabel : ""}. Bir sonraki Excel'i yüklediğinde bu liste genel markaların arasına karışır, yeni sekmede o dosya görünür.`;
      newUploadLabel.style.display = "";
    } else {
      newUploadLabel.style.display = "none";
    }
  }
}

// Sayfalandırma: pageSize ve currentPage'e göre, verilen (zaten filtrelenmiş)
// listeden gösterilecek dilimi ve sayfa bilgisini hesaplar. Sayfa numarası,
// filtre/kategori/sayfa boyutu değiştiğinde aralık dışında kalırsa otomatik
// olarak geçerli sınıra çekilir (ör. son sayfadayken sayfa boyutunu büyütmek).
function paginate(list) {
  const total = list.length;
  const effectiveSize = pageSize === "all" ? Math.max(total, 1) : pageSize;
  const totalPages = Math.max(1, Math.ceil(total / effectiveSize));
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;
  const start = (currentPage - 1) * effectiveSize;
  const end = Math.min(start + effectiveSize, total);
  return { pageItems: list.slice(start, end), start, end, total, totalPages };
}

function renderPaginationBar(info) {
  const rangeLabel = info.total === 0 ? "0-0 / 0 marka" : `${info.start + 1}-${info.end} / ${info.total} marka`;
  document.getElementById("pageRangeLabel").textContent = rangeLabel;
  document.getElementById("pageIndicatorLabel").textContent = `Sayfa ${currentPage}/${info.totalPages}`;
  document.getElementById("prevPageBtn").disabled = currentPage <= 1;
  document.getElementById("nextPageBtn").disabled = currentPage >= info.totalPages;
  document.querySelectorAll(".page-size-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.size === String(pageSize));
  });
}

function renderBrands() {
  brandsBody.innerHTML = "";
  const visibleBrands = brands.filter((b) => matchesFilter(b, currentFilter) && matchesCategory(b));
  const pageInfo = paginate(visibleBrands);
  renderPaginationBar(pageInfo);
  const { pageItems, start } = pageInfo;
  pageItems.forEach((b, i) => {
    const rowNumber = start + i + 1;
    const tr = document.createElement("tr");
    const contactLine =
      !b.email && b.contact_page_url
        ? `<div class="muted" style="margin-top:4px;">📩 <a href="${b.contact_page_url}" target="_blank" rel="noopener">İletişim formu bulundu ↗</a></div>`
        : "";
    const checked = selectedIds.has(String(b.id)) ? "checked" : "";
    const sentViaTag = b.status === "sent" && b.sent_via === "contact_form" ? " (form ile)" : "";
    tr.innerHTML = `
      <td><input type="checkbox" class="row-checkbox" data-id="${b.id}" ${checked} /></td>
      <td class="row-number">${rowNumber}</td>
      <td>${b.name}${categoryChip(b)}</td>
      <td class="muted">${marketSummary(b)}</td>
      <td><input data-field="website" data-id="${b.id}" value="${b.website || ""}" /></td>
      <td>
        <input data-field="email" data-id="${b.id}" value="${b.email || ""}" />
        ${b.email && b.confidence === "low" ? `<div class="confidence-warn">⚠️ düşük güven — bu site markaya ait olmayabilir, kontrol et</div>` : ""}
        ${b.suppressed ? `<div class="confidence-warn">🚫 kalıcı "bir daha yazma" listesinde — gönderim engellendi</div>` : ""}
        ${b.phone ? `<div class="muted" style="font-size:12px;">📞 ${b.phone}</div>` : ""}
        ${contactLine}
        <input data-field="notes" data-id="${b.id}" value="${(b.notes || "").replace(/"/g, "&quot;")}" placeholder="Not ekle (ör. tekrar ara, fiyat bekliyor)" style="margin-top:4px; font-size:12px;" />
      </td>
      <td>${badge(b.status)}${sentViaTag}</td>
      <td>
        <div class="actions-cell">
          <button class="small find-btn" data-id="${b.id}" title="E-mail ara">Ara</button>
          <button class="small send-btn" data-id="${b.id}" title="Mail gönder" ${!b.email || b.status === "duplicate_blocked" || b.suppressed ? "disabled" : ""}>Gönder</button>
          ${
            !b.email && b.contact_page_url
              ? `<button class="small secondary contact-btn" data-id="${b.id}" title="İletişim formunu aç">Form Aç</button>
                 <button class="small secondary mark-sent-btn" data-id="${b.id}" title="Formdan gönderildi olarak işaretle" ${b.status === "sent" ? "disabled" : ""}>✓ İşaretle</button>`
              : ""
          }
          ${hasMarketData(b) ? `<button class="small secondary market-btn" data-id="${b.id}" title="Piyasa verisi">📊</button>` : ""}
          ${
            b.storefront_url
              ? `<button class="small secondary amazon-btn" data-url="${b.storefront_url.replace(/"/g, "&quot;")}" title="Amazon mağaza sayfasını aç">🛒 Amazon</button>`
              : ""
          }
          <button class="small secondary detail-btn" data-id="${b.id}" title="Arama adımları detayı">Detay</button>
        </div>
      </td>
    `;
    brandsBody.appendChild(tr);
  });
  attachRowEvents();
  updateSelectedCount();
  renderFilterTabs();
  renderCategoryTree();
}

function updateSelectedCount() {
  const el = document.getElementById("selectedCount");
  if (el) el.textContent = `${selectedIds.size} marka seçili`;
}

function attachRowEvents() {
  document.querySelectorAll(".row-checkbox").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) selectedIds.add(cb.dataset.id);
      else selectedIds.delete(cb.dataset.id);
      updateSelectedCount();
    });
  });

  document.querySelectorAll("input[data-field]").forEach((input) => {
    input.addEventListener("change", async () => {
      const id = input.dataset.id;
      const field = input.dataset.field;
      const brand = brands.find((b) => String(b.id) === id);
      brand[field] = input.value;
      await fetch(`/api/brands/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: brand.email, website: brand.website, notes: brand.notes }),
      });
      renderBrands();
    });
  });

  document.querySelectorAll(".find-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "...";
      const res = await fetch(`/api/brands/${btn.dataset.id}/find-email`, { method: "POST" });
      const data = await res.json();
      if (data.brand) {
        const idx = brands.findIndex((b) => b.id === data.brand.id);
        brands[idx] = data.brand;
      }
      renderBrands();
    });
  });

  document.querySelectorAll(".send-btn").forEach((btn) => {
    btn.addEventListener("click", () => openPreview(btn.dataset.id));
  });

  // E-mail bulunamayan ama bir "bize ulaşın" sayfası tespit edilen markalar için:
  // formu yeni sekmede aç ve hazırladığın mail metnini panoya kopyala, böylece
  // formun mesaj alanına doğrudan yapıştırabilirsin. Formu otomatik doldurup
  // göndermiyoruz çünkü her sitenin form yapısı farklı; kör bir otomasyon markanın
  // sitesine hatalı/eksik veri gönderebilir.
  document.querySelectorAll(".contact-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const brand = brands.find((b) => String(b.id) === btn.dataset.id);
      if (!brand || !brand.contact_page_url) return;
      const subject = fillTemplate(subjectInput.value, brand.name);
      // İletişim formları düz metin bekler, HTML biçimlendirmesini panoya kopyalarken çıkarıyoruz.
      const body = fillTemplate(richTextToPlain(bodyInput.innerHTML), brand.name);
      try {
        await navigator.clipboard.writeText(`Konu: ${subject}\n\n${body}`);
        alert("Mail metni panoya kopyalandı. Açılan iletişim formuna yapıştırabilirsin.");
      } catch (e) {
        alert("Metin panoya kopyalanamadı, formu manuel doldurman gerekebilir.");
      }
      window.open(brand.contact_page_url, "_blank", "noopener");
    });
  });

  document.querySelectorAll(".detail-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const brand = brands.find((b) => String(b.id) === btn.dataset.id);
      const steps = (brand.last_error || "Henüz aranmadı.").split(" | ").join("\n");
      alert(`${brand.name} için yapılan adımlar:\n\n${steps}`);
    });
  });

  // Excel'deki "Storefront Url" sütunundan gelen Amazon mağaza sayfası linkini
  // yeni sekmede açar — marka satırında ayrıca aramaya/kopyalamaya gerek kalmadan
  // tek tıkla Amazon'daki mağazasına ulaşmak için.
  document.querySelectorAll(".amazon-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      let url = btn.dataset.url;
      if (!url) return;
      // Excel'den gelen linkte protokol (https://) eksik olabilir — tarayıcı
      // bunu göreli bir yol sanıp mevcut sayfa üzerinden açmaya çalışmasın diye.
      if (!/^https?:\/\//i.test(url)) url = "https://" + url;
      window.open(url, "_blank", "noopener");
    });
  });

  // Excel'den gelen marka istihbarat verisini (Brand Score, ciro, satıcı sayısı vb.)
  // tek satırda göstermek yerine detaylı halini burada gösteriyoruz.
  document.querySelectorAll(".market-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const b = brands.find((x) => String(x.id) === btn.dataset.id);
      if (!b) return;
      const lines = [
        b.brand_score !== null && b.brand_score !== undefined ? `Marka Skoru: ${b.brand_score}` : null,
        b.main_category ? `Ana Kategori: ${b.main_category}` : null,
        b.subcategory ? `Alt Kategori: ${b.subcategory}` : null,
        formatMoney(b.est_monthly_revenue) ? `Tahmini Aylık Ciro: ${formatMoney(b.est_monthly_revenue)}` : null,
        b.est_monthly_sales !== null && b.est_monthly_sales !== undefined ? `Tahmini Aylık Satış: ${b.est_monthly_sales}` : null,
        formatMoney(b.avg_price) ? `Ortalama Fiyat: ${formatMoney(b.avg_price)}` : null,
        b.avg_fba_sellers !== null && b.avg_fba_sellers !== undefined ? `Ort. FBA Satıcı Sayısı: ${b.avg_fba_sellers}` : null,
        b.avg_sellers !== null && b.avg_sellers !== undefined ? `Ort. Toplam Satıcı Sayısı: ${b.avg_sellers}` : null,
        b.dominant_seller ? `Baskın Satıcı: ${b.dominant_seller}` : null,
        b.sales_percentage !== null && b.sales_percentage !== undefined ? `Amazon'un Kendi Satış Payı: %${b.sales_percentage}` : null,
        b.amazon_in_stock_rate !== null && b.amazon_in_stock_rate !== undefined ? `Amazon Stok Oranı: %${b.amazon_in_stock_rate}` : null,
        b.avg_rating !== null && b.avg_rating !== undefined ? `Ortalama Puan: ${b.avg_rating}` : null,
        b.total_reviews !== null && b.total_reviews !== undefined ? `Toplam Yorum: ${b.total_reviews}` : null,
        b.growth_12m !== null && b.growth_12m !== undefined ? `12 Aylık Büyüme: %${b.growth_12m}` : null,
        b.product_count !== null && b.product_count !== undefined ? `Ürün Sayısı: ${b.product_count}` : null,
        b.storefront_url ? `Storefront: ${b.storefront_url}` : null,
      ].filter(Boolean);
      alert(`${b.name} - Piyasa Verisi:\n\n${lines.join("\n") || "Veri yok."}`);
    });
  });

  // Marka e-maili bulunamayıp iletişim formu üzerinden elle gönderim yaptıysan,
  // bunu sisteme "gönderildi" olarak işaretlemek için (kara liste/tekrar koruması
  // ve takip sayfasına dahil olması için gerekli).
  document.querySelectorAll(".mark-sent-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const brand = brands.find((b) => String(b.id) === btn.dataset.id);
      if (!brand) return;
      if (!confirm(`${brand.name} markasına iletişim formu üzerinden mail gönderdiğini onaylıyor musun? Bu marka "Gönderildi" olarak işaretlenecek.`)) return;
      const res = await fetch(`/api/brands/${brand.id}/mark-contact-sent`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) return alert(data.error || "İşaretlenemedi.");
      const idx = brands.findIndex((b) => String(b.id) === String(brand.id));
      brands[idx] = data.brand;
      renderBrands();
    });
  });
}

function fillTemplate(text, brandName) {
  return (text || "").replace(/{{\s*marka\s*}}/gi, brandName);
}

// Gönderme öncesi bu markaya özel doldurulmuş metni önizleme/düzenleme penceresinde göster
function openPreview(id) {
  const brand = brands.find((b) => String(b.id) === String(id));
  if (!brand || !brand.email) return alert("Bu markanın e-mail adresi yok.");
  if (!subjectInput.value || !richTextToPlain(bodyInput.innerHTML).trim()) {
    return alert("Önce 4. adımdaki mail şablonunu doldur.");
  }

  previewBrandId = id;
  previewTitle.textContent = `${brand.name} için mail önizleme`;
  previewTo.value = brand.email;
  previewSubject.value = fillTemplate(subjectInput.value, brand.name);
  previewBody.innerHTML = fillTemplate(bodyInput.innerHTML, brand.name);
  previewOverlay.style.display = "flex";
}

function closePreview() {
  previewOverlay.style.display = "none";
  previewBrandId = null;
}

// Gerçek gönderim isteği. subject/body verilmezse global şablondan doldurur
// (toplu gönderimde önizleme açmadan hızlıca kullanılır).
async function sendToBrand(id, overrideSubject, overrideBody) {
  const brand = brands.find((b) => String(b.id) === String(id));
  if (!brand || !brand.email) return alert("Bu markanın e-mail adresi yok.");
  const subject = overrideSubject !== undefined ? overrideSubject : fillTemplate(subjectInput.value, brand.name);
  const body = overrideBody !== undefined ? overrideBody : fillTemplate(bodyInput.innerHTML, brand.name);
  if (!subject || !richTextToPlain(body).trim()) return alert("Önce mail şablonunu doldur.");

  const res = await fetch(`/api/brands/${id}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject, body }),
  });
  const data = await res.json();
  if (!res.ok) {
    alert("Gönderim hatası: " + data.error);
    return;
  }
  const idx = brands.findIndex((b) => String(b.id) === String(id));
  brands[idx].status = "sent";
  renderBrands();
}

async function loadSettings() {
  const res = await fetch("/api/settings");
  const data = await res.json();
  const s = data.settings || {};
  document.getElementById("settingsName").value = s.name || "";
  document.getElementById("settingsCompany").value = s.company || "";
  document.getElementById("settingsOffer").value = s.offer_text || "";
  document.getElementById("settingsSignature").value = s.signature || "";
  document.getElementById("settingsCompanyAddress").value = s.company_address || "";

  const breakerBanner = document.getElementById("circuitBreakerBanner");
  if (breakerBanner) {
    if (s.circuit_breaker_active) {
      breakerBanner.style.display = "block";
      document.getElementById("circuitBreakerText").textContent =
        "⚠️ Güvenlik freni devreye girdi: son 24 saatte gönderilen maillerin çok yüksek bir oranı geri döndü, bu yüzden otomatik günlük gönderim durduruldu. \"Ulaşmayanlar\" listesini incele (Gönderim Takibi sayfası) — muhtemelen listede çok sayıda geçersiz e-posta var. Sorunu çözdükten sonra aşağıdan devam edebilirsin.";
    } else {
      breakerBanner.style.display = "none";
    }
  }

  if (data.emailConfigured) {
    emailStatusEl.innerHTML = `<span class="ok">Gönderim hesabı: ${data.emailAddress}</span>`;
  } else {
    emailStatusEl.innerHTML = `<span class="warn">E-mail hesabı ayarlanmamış (.env dosyasına bak)</span>`;
  }

  // Mail şablonu artık sunucuda (settings tablosunda) tutuluyor — böylece otomatik
  // günlük gönderim (server tarafındaki cron) da aynı şablona erişebiliyor. Eskiden
  // sadece tarayıcıda (localStorage) tutuluyordu, cron bunu göremiyordu.
  // Gövde artık HTML (zengin metin) olarak saklanıyor; varsayılan metinde satır
  // sonları için \n yerine <br> kullanıyoruz ki editörde düzgün görünsün.
  subjectInput.value = s.main_subject || `{{marka}} ile iş birliği teklifi`;
  bodyInput.innerHTML =
    s.main_body ||
    `Sayın {{marka}} Yetkilisi,<br><br>${s.company || "Şirketimiz"} olarak Amazon üzerinde ${s.offer_text || "iş birliği"} konusunda sizinle görüşmek isteriz.<br><br>${s.signature || ""}`;

  document.getElementById("dailyLimitInput").value = s.daily_send_limit || 0;
  document.getElementById("rewarmEnabledCheckbox").checked = Boolean(s.rewarm_enabled);

  document.getElementById("warmupEnabledCheckbox").checked = Boolean(s.warmup_enabled);
  document.getElementById("warmupStartLimitInput").value = s.warmup_start_limit || 10;
  document.getElementById("warmupIncrementInput").value = s.warmup_increment || 10;
  document.getElementById("warmupFields").style.display = s.warmup_enabled ? "flex" : "none";
  if (s.warmup_enabled && s.warmup_started_at) {
    const daysElapsed = Math.floor((Date.now() - new Date(s.warmup_started_at).getTime()) / (1000 * 60 * 60 * 24));
    const weeksElapsed = Math.max(0, Math.floor(daysElapsed / 7));
    const current = Math.min(
      (s.warmup_start_limit || 10) + weeksElapsed * (s.warmup_increment || 10),
      s.daily_send_limit || 0
    );
    document.getElementById("warmupStatus").textContent = `Şu anki etkin limit: ${current}/gün (hedef: ${s.daily_send_limit || 0})`;
  }
}

async function loadBrands() {
  const res = await fetch("/api/brands");
  const data = await res.json();
  brands = data.brands || [];
  batch = data.batch;
  latestBatchName = data.batchName || null;
  latestBatchUploadedAt = data.batchUploadedAt || null;
  renderBrands();
}

document.getElementById("saveSettingsBtn").addEventListener("click", async () => {
  const payload = {
    name: document.getElementById("settingsName").value,
    company: document.getElementById("settingsCompany").value,
    offer_text: document.getElementById("settingsOffer").value,
    signature: document.getElementById("settingsSignature").value,
    company_address: document.getElementById("settingsCompanyAddress").value,
  };
  await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  alert("Kaydedildi.");
});

document.getElementById("uploadBtn").addEventListener("click", async () => {
  const fileInput = document.getElementById("fileInput");
  if (!fileInput.files[0]) return alert("Önce bir dosya seç.");
  const formData = new FormData();
  formData.append("file", fileInput.files[0]);
  document.getElementById("uploadStatus").textContent = "Yükleniyor...";
  const res = await fetch("/api/brands/upload", { method: "POST", body: formData });
  const data = await res.json();
  if (!res.ok) {
    document.getElementById("uploadStatus").textContent = "Hata: " + data.error;
    return;
  }
  let msg = `${data.count} yeni marka eklendi.`;
  if (data.skippedExistingCount) {
    msg += ` ${data.skippedExistingCount} tanesi sistemde zaten kayıtlı olduğu için tekrar eklenmedi.`;
  }
  if (data.skippedNoDataCount) {
    msg += ` ${data.skippedNoDataCount} tanesi Ciro/Skor verisi olmadığı (0/boş) için eklenmedi.`;
  }
  if (data.enrichmentFieldsFound && data.enrichmentFieldsFound.length > 0) {
    msg += ` Ek marka verisi algılandı (${data.enrichmentFieldsFound.length} sütun) — satırlardaki "Piyasa Verisi" butonundan görebilirsin.`;
  }
  document.getElementById("uploadStatus").textContent = msg;
  batch = data.batch;
  // Sadece bu yüklemeden gelenleri değil, sistemdeki tüm (tekilleştirilmiş) marka
  // listesini yeniden çekiyoruz ki panel her zaman tam ve tutarlı kalsın.
  await loadBrands();
});

// Toplu email arama artık durdurulup kaldığı yerden devam ettirilebiliyor. Sunucu
// tarafında bir kuyruk tutuluyor; burada sadece o kuyruğun durumunu 3 saniyede bir
// kontrol edip ekrandaki butonları/metni güncelliyoruz.
let findAllPollInterval = null;

function updateFindAllButtons(status) {
  document.getElementById("findAllBtn").disabled = status.running;
  document.getElementById("stopFindAllBtn").disabled = !status.running;
  document.getElementById("resumeFindAllBtn").disabled = status.running || status.remaining === 0;
  const findSelectedBtn = document.getElementById("findSelectedBtn");
  if (findSelectedBtn) findSelectedBtn.disabled = status.running;
}

// "Tüm markalar için ara" VE "Seçilenler için Email Ara" artık AYNI sunucu
// kuyruğunu (findAllJob) paylaşıyor — ids gönderilirse sadece o markalar,
// gönderilmezse tüm uygun markalar aranıyor. Bu yüzden ilerleme metni/toast'ı
// da tek bir yerden (bu fonksiyon) güncelleniyor; hangi buton başlattıysa onun
// durum metni de burada dolduruluyor.
async function pollFindAllStatus() {
  await loadBrands();
  const res = await fetch("/api/brands/find-all/status");
  const status = await res.json();
  updateFindAllButtons(status);
  const findSelectedStatusEl = document.getElementById("findSelectedStatus");
  if (status.total > 0) {
    updateProgressToast(status.processedCount, status.total, status.currentBrandName);
    if (findSelectedStatusEl) findSelectedStatusEl.textContent = `${status.processedCount}/${status.total}`;
  }
  if (!status.running) {
    clearInterval(findAllPollInterval);
    findAllPollInterval = null;
    document.getElementById("findStatus").textContent =
      status.remaining > 0
        ? `Duraklatıldı. ${status.remaining} marka kaldı — "Devam Et" ile devam edebilirsin.`
        : "Tamamlandı.";
    if (findSelectedStatusEl && status.total > 0) {
      findSelectedStatusEl.textContent = status.remaining > 0 ? "Duraklatıldı." : "Tamamlandı.";
    }
    if (status.total > 0) finishProgressToast(status.processedCount);
  } else {
    document.getElementById("findStatus").textContent = `Aranıyor... (${status.remaining} marka kaldı)`;
  }
}

function startFindAllPolling() {
  if (findAllPollInterval) clearInterval(findAllPollInterval);
  findAllPollInterval = setInterval(pollFindAllStatus, 3000);
}

document.getElementById("findAllBtn").addEventListener("click", async () => {
  if (brands.length === 0) return alert("Önce bir liste yükle.");
  const res = await fetch("/api/brands/find-all", { method: "POST" });
  const data = await res.json();
  if (!res.ok) return alert(data.error || "Başlatılamadı.");
  document.getElementById("findStatus").textContent = "Arama başladı, arka planda çalışıyor...";
  showProgressToast(`🔍 Tüm Markalar İçin Email Arama (${data.queued})`);
  updateFindAllButtons({ running: true, remaining: data.queued });
  startFindAllPolling();
});

document.getElementById("stopFindAllBtn").addEventListener("click", async () => {
  const res = await fetch("/api/brands/find-all/stop", { method: "POST" });
  const data = await res.json();
  document.getElementById("findStatus").textContent = `Durduruluyor... (${data.remaining} marka kaldı)`;
});

document.getElementById("resumeFindAllBtn").addEventListener("click", async () => {
  const res = await fetch("/api/brands/find-all/resume", { method: "POST" });
  const data = await res.json();
  if (!res.ok) return alert(data.error);
  document.getElementById("findStatus").textContent = "Devam ediliyor...";
  showProgressToast(`🔍 Email Arama (${data.remaining} kaldı)`);
  updateFindAllButtons({ running: true, remaining: data.remaining });
  startFindAllPolling();
});

// Basit spam-tetikleyici kelime kontrolü. Kesin bir spam filtresi değildir,
// sadece Gmail/Outlook gibi filtrelerin sıkça tepki verdiği kalıpları
// göstererek şablonu göndermeden önce gözden geçirmeni sağlar.
const SPAM_TRIGGER_WORDS = [
  "free",
  "ücretsiz",
  "act now",
  "hemen ara",
  "limited time",
  "sınırlı süre",
  "guarantee",
  "garanti",
  "click here",
  "buraya tıkla",
  "$$$",
  "act immediately",
  "risk free",
  "winner",
  "kazandınız",
  "100% free",
  "no obligation",
  "congratulations",
  "tebrikler",
  "cash bonus",
  "nakit bonus",
  "double your",
  "miktarını ikiye",
  "urgent",
  "acil",
  "money back",
  "para iade",
];

const URL_SHORTENERS = ["bit.ly", "tinyurl.com", "goo.gl", "t.co", "ow.ly", "is.gd", "buff.ly"];

// Basit spam-tetikleyici kontrolü. Kesin bir spam filtresi değildir, sadece Gmail/
// Outlook gibi filtrelerin sıkça tepki verdiği kalıpları (yasaklı kelimeler, aşırı
// link/ünlem, tamamen büyük harf, link kısaltıcılar) göstererek göndermeden önce
// gözden geçirmeni sağlar.
function checkSpamTriggers(subject, body) {
  const text = `${subject} ${body}`.toLowerCase();
  const found = SPAM_TRIGGER_WORDS.filter((w) => text.includes(w));
  const exclamations = (text.match(/!/g) || []).length;
  if (exclamations >= 3) found.push(`çok fazla ünlem işareti (${exclamations} adet)`);
  const capsWords = (subject.match(/\b[A-ZÇĞİÖŞÜ]{4,}\b/g) || []).length;
  if (capsWords >= 1) found.push("konu satırında tamamı büyük harf kelime");
  const linkCount = (text.match(/https?:\/\//g) || []).length;
  if (linkCount >= 4) found.push(`çok fazla link (${linkCount} adet) — soğuk mailde 1-2 link idealdir`);
  const shortenerHit = URL_SHORTENERS.find((s) => text.includes(s));
  if (shortenerHit) found.push(`link kısaltıcı kullanılmış (${shortenerHit}) — spam filtreleri bunlara şüpheyle bakar`);
  return found;
}

document.getElementById("saveTemplateBtn").addEventListener("click", async () => {
  const triggers = checkSpamTriggers(subjectInput.value, richTextToPlain(bodyInput.innerHTML));
  if (triggers.length > 0) {
    const proceed = confirm(
      `Şablonda spam filtrelerini tetikleyebilecek şu ifadeler var:\n\n- ${triggers.join("\n- ")}\n\nYine de kaydetmek istiyor musun?`
    );
    if (!proceed) return;
  }
  await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ main_subject: subjectInput.value, main_body: bodyInput.innerHTML }),
  });
  alert("Şablon kaydedildi.");
});

document.getElementById("rewarmEnabledCheckbox").addEventListener("change", async (e) => {
  await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rewarm_enabled: e.target.checked }),
  });
});

document.getElementById("warmupEnabledCheckbox").addEventListener("change", async (e) => {
  document.getElementById("warmupFields").style.display = e.target.checked ? "flex" : "none";
  await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      warmup_enabled: e.target.checked,
      warmup_start_limit: Number(document.getElementById("warmupStartLimitInput").value) || 10,
      warmup_increment: Number(document.getElementById("warmupIncrementInput").value) || 10,
    }),
  });
  loadSettings();
});

document.getElementById("saveWarmupBtn").addEventListener("click", async () => {
  await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      warmup_enabled: document.getElementById("warmupEnabledCheckbox").checked,
      warmup_start_limit: Number(document.getElementById("warmupStartLimitInput").value) || 10,
      warmup_increment: Number(document.getElementById("warmupIncrementInput").value) || 10,
    }),
  });
  loadSettings();
  alert("Isınma ayarları kaydedildi.");
});

document.getElementById("saveDailyLimitBtn").addEventListener("click", async () => {
  const value = Number(document.getElementById("dailyLimitInput").value) || 0;
  await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ daily_send_limit: value }),
  });
  alert(
    value > 0
      ? `Kaydedildi. Sistem her gün en fazla ${value} mail gönderecek (08:00-20:00 UTC arasına yayarak).`
      : "Kaydedildi. Otomatik günlük gönderim kapalı, sadece elle/seçerek göndereceksin."
  );
});

// En değerli markalara (Brand Score / tahmini aylık ciro yüksek olanlara) önce
// ulaşmak için: toplu gönderimde sıralama artık listeye eklenme sırası değil,
// bu değer sırası. Veri yoksa (SmartScout tarzı Excel yüklenmediyse) sıralama
// hiçbir şeyi değiştirmez, hepsi eşit sayılıp mevcut sıra korunur.
function sortByValue(list) {
  return [...list].sort((a, b) => {
    const scoreA = a.brand_score ?? 0;
    const scoreB = b.brand_score ?? 0;
    if (scoreB !== scoreA) return scoreB - scoreA;
    const revA = a.est_monthly_revenue ?? 0;
    const revB = b.est_monthly_revenue ?? 0;
    return revB - revA;
  });
}

// Sağ üstte sabit kalan ilerleme kartı — toplu gönderim ya da toplu email arama
// sırasında kullanıcı sayfanın neresinde olursa olsun ne kadar ilerlendiğini
// görebilsin diye. Aynı kart her iki işlem için de (başlık değiştirilerek)
// tekrar kullanılıyor.
function showProgressToast(title) {
  const el = document.getElementById("progressToast");
  el.classList.remove("done");
  document.getElementById("progressToastTitle").textContent = title;
  document.getElementById("progressToastSub").textContent = "";
  document.getElementById("progressToastFill").style.width = "0%";
  document.getElementById("progressToastCount").textContent = "0/0";
  el.style.display = "";
}

function updateProgressToast(done, total, currentName) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  document.getElementById("progressToastSub").textContent = currentName
    ? `İşleniyor: ${currentName}`
    : "";
  document.getElementById("progressToastFill").style.width = `${pct}%`;
  document.getElementById("progressToastCount").textContent = `${done}/${total}`;
}

function finishProgressToast(doneCount) {
  const el = document.getElementById("progressToast");
  el.classList.add("done");
  document.getElementById("progressToastSub").textContent = `✓ ${doneCount} tamamlandı`;
  document.getElementById("progressToastFill").style.width = "100%";
  // Birkaç saniye "tamamlandı" olarak görünür kalsın, sonra kendiliğinden kaybolsun.
  setTimeout(() => {
    el.style.display = "none";
  }, 4000);
}

// Toplu gönderim artık TARAYICIDA bir döngü değil — sunucuda arka planda
// (send-batch kuyruğu) çalışıyor, böylece "Dashboard" ya da başka bir sayfaya
// geçilse bile gönderim durmadan devam ediyor. Burada sadece işi başlatıp
// ardından durumu 3 saniyede bir sorguluyoruz.
let sendBatchPollInterval = null;

function updateSendBatchButtons(running) {
  document.getElementById("sendSelectedBtn").disabled = running;
  document.getElementById("sendAllBtn").disabled = running;
  document.getElementById("stopSendBatchBtn").disabled = !running;
}

async function pollSendBatchStatus() {
  const res = await fetch("/api/brands/send-batch/status");
  const status = await res.json();
  updateSendBatchButtons(status.running);
  if (status.total > 0) {
    const done = status.sentCount + status.failedCount;
    document.getElementById("sendStatus").textContent = `${done}/${status.total}`;
    updateProgressToast(done, status.total, status.currentBrandName);
  }
  if (!status.running) {
    clearInterval(sendBatchPollInterval);
    sendBatchPollInterval = null;
    if (status.total > 0) {
      document.getElementById("sendStatus").textContent =
        status.failedCount > 0
          ? `Tamamlandı: ${status.sentCount} gönderildi, ${status.failedCount} başarısız.`
          : "Tamamlandı.";
      finishProgressToast(status.sentCount + status.failedCount);
    }
    await loadBrands();
  }
}

function startSendBatchPolling() {
  if (sendBatchPollInterval) clearInterval(sendBatchPollInterval);
  sendBatchPollInterval = setInterval(pollSendBatchStatus, 3000);
}

async function sendBatch(targets) {
  if (targets.length === 0) return alert("Gönderilecek e-mail yok.");

  // Göndermeden hemen önce ŞU AN kullanılan şablonu tekrar kontrol et — kullanıcı
  // şablonu kaydettikten sonra elle değiştirip tekrar kaydetmeden gönderebilir,
  // bu yüzden sadece "Şablonu kaydet" anında değil, gönderim anında da uyarıyoruz.
  const rawSubject = subjectInput.value;
  const rawBody = bodyInput.innerHTML;
  const triggers = checkSpamTriggers(rawSubject, richTextToPlain(rawBody));
  if (triggers.length > 0) {
    const proceed = confirm(
      `Göndereceğin mail şablonunda spam filtrelerini tetikleyebilecek şu ifadeler var:\n\n- ${triggers.join("\n- ")}\n\n` +
        `Bunlar ${targets.length} markaya gidecek maillerin spam'e düşme riskini artırabilir. Yine de göndermek istiyor musun?`
    );
    if (!proceed) return;
  }

  if (!confirm(`${targets.length} markaya mail gönderilecek. Onaylıyor musun?`)) return;

  const res = await fetch("/api/brands/send-batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: targets.map((b) => b.id), subject: rawSubject, body: rawBody }),
  });
  const data = await res.json();
  if (!res.ok) return alert(data.error || "Başlatılamadı.");
  document.getElementById("sendStatus").textContent = `0/${data.queued}`;
  showProgressToast(`📤 Toplu Gönderim (${data.queued})`);
  updateSendBatchButtons(true);
  startSendBatchPolling();
}

document.getElementById("stopSendBatchBtn").addEventListener("click", async () => {
  const res = await fetch("/api/brands/send-batch/stop", { method: "POST" });
  const data = await res.json();
  document.getElementById("sendStatus").textContent = `Durduruluyor... (${data.remaining} marka kaldı)`;
});

// İşaretlediğin (checkbox) markalar için email arama başlatır — "Tüm markalar
// için email ara" tüm listeyi tararken, bu sadece seçtiklerini hedefler (ör.
// "Bulunamayanlar" sekmesinden birkaçını işaretleyip sadece onları tekrar
// aratmak istediğinde). Artık tekli endpoint'i tarayıcıda döngüyle çağırmak
// yerine, "Tüm markalar için ara" ile AYNI sunucu kuyruğunu (find-all) belirli
// ID'lerle başlatıyor — böylece bu da sayfa değişince durmuyor.
async function findEmailBatch(targets) {
  if (targets.length === 0) return alert("Önce tablodan en az bir marka seç (checkbox).");
  const res = await fetch("/api/brands/find-all", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: targets.map((b) => b.id) }),
  });
  const data = await res.json();
  if (!res.ok) return alert(data.error || "Başlatılamadı.");
  document.getElementById("findSelectedStatus").textContent = `0/${data.queued}`;
  showProgressToast(`🔍 Email Arama (${data.queued})`);
  updateFindAllButtons({ running: true, remaining: data.queued });
  startFindAllPolling();
}

document.getElementById("findSelectedBtn").addEventListener("click", () => {
  const targets = brands.filter((b) => selectedIds.has(String(b.id)));
  findEmailBatch(targets);
});

document.getElementById("sendAllBtn").addEventListener("click", () => {
  const targets = sortByValue(
    brands.filter(
      (b) =>
        b.email &&
        !b.suppressed &&
        !["sent", "duplicate_blocked", "bounced"].includes(b.status) &&
        b.confidence !== "low"
    )
  );
  const skippedLowConfidence = brands.filter(
    (b) =>
      b.email &&
      !b.suppressed &&
      !["sent", "duplicate_blocked", "bounced"].includes(b.status) &&
      b.confidence === "low"
  ).length;
  if (skippedLowConfidence > 0) {
    const proceed = confirm(
      `${skippedLowConfidence} marka düşük güven skoru nedeniyle bu gönderimden hariç tutuldu ` +
        `(yanlış markaya mail gitme riskini azaltmak için). Bunları "⚠️ Düşük Güven" sekmesinden ` +
        `elle kontrol edip tekrar arayabilir ya da elle gönderebilirsin.\n\n` +
        `Kalan ${targets.length} markaya göndermeye devam edilsin mi?`
    );
    if (!proceed) return;
  }
  sendBatch(targets);
});

// Sadece işaretlediğin (checkbox) markalara gönderir — 400 marka gibi büyük bir
// listenin tamamını tek seferde göndermek yerine, istediğin kadarını seçip
// göndermek için.
document.getElementById("sendSelectedBtn").addEventListener("click", () => {
  const targets = sortByValue(
    brands.filter(
      (b) =>
        selectedIds.has(String(b.id)) &&
        b.email &&
        !b.suppressed &&
        !["sent", "duplicate_blocked", "bounced"].includes(b.status)
    )
  );
  if (targets.length === 0) return alert("Önce tablodan en az bir marka seç (checkbox).");
  sendBatch(targets);
});

selectAllCheckbox.addEventListener("change", () => {
  // Bir filtre sekmesi aktifse "tümünü seç" sadece o an görünen (filtrelenmiş)
  // markaları etkiler, gizli olanları değil.
  const visible = brands.filter((b) => matchesFilter(b, currentFilter) && matchesCategory(b));
  if (selectAllCheckbox.checked) {
    visible.forEach((b) => selectedIds.add(String(b.id)));
  } else {
    visible.forEach((b) => selectedIds.delete(String(b.id)));
  }
  renderBrands();
});

// Durum filtre sekmeleri: tıklanan sekmeye göre tabloyu filtreler VE o gruptaki
// tüm markaları otomatik seçer ki "Seçilenleri Gönder" ile direkt o gruba
// gönderilebilsin. "Tümü" sekmesi sadece filtreyi kaldırır, seçimi değiştirmez.
// "⚠️ Düşük Güven" sekmesi İSTİSNA: burada amaç göndermek değil, gözden geçirip
// tekrar aratmak — bu yüzden otomatik seçim yapmıyoruz (yanlışlıkla toplu
// gönderilmelerini engellemek için).
document.querySelectorAll(".filter-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    currentFilter = btn.dataset.filter;
    currentPage = 1;
    if (currentFilter !== "all" && currentFilter !== "low_confidence") {
      selectedIds.clear();
      brands.filter((b) => matchesFilter(b, currentFilter) && matchesCategory(b)).forEach((b) => selectedIds.add(String(b.id)));
    }
    renderBrands();
  });
});

// Kullanıcı aynı Excel'i birden fazla kez yüklediyse (ya da eski bir sürümde
// yüklediyse, çünkü tekrar önleme sonradan eklendi), sistemde aynı marka birden
// fazla satır olarak kalmış olabilir — bu da "Seçilenleri Gönder" dediğinde aynı
// markaya 2-3 kez mail atılmasına yol açar. Bu buton mevcut veriyi tekilleştirir.
document.getElementById("dedupeBtn").addEventListener("click", async () => {
  if (!confirm("Aynı marka adına sahip tekrarlanan satırlar bulunup temizlenecek (en gelişmiş durumdaki kayıt tutulur, diğerleri silinecek). Devam edilsin mi?")) return;
  const btn = document.getElementById("dedupeBtn");
  btn.disabled = true;
  btn.textContent = "Temizleniyor...";
  try {
    const res = await fetch("/api/brands/dedupe", { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "Temizlenemedi.");
      return;
    }
    alert(data.removed > 0 ? `${data.removed} tekrarlanan marka satırı kaldırıldı.` : "Tekrarlanan marka bulunamadı.");
    await loadBrands();
  } catch (e) {
    alert("Hata: " + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Tekrarlananları Birleştir";
  }
});

document.getElementById("previewSendBtn").addEventListener("click", async () => {
  if (!previewBrandId) return;
  await sendToBrand(previewBrandId, previewSubject.value, previewBody.innerHTML);
  closePreview();
});

document.getElementById("previewCancelBtn").addEventListener("click", closePreview);

previewOverlay.addEventListener("click", (e) => {
  if (e.target === previewOverlay) closePreview();
});

// Sağ üstteki "API Kredileri" kutusu: SerpAPI ve Hunter.io kendi resmi "hesap" uç
// noktalarını sağladığı için gerçek kalan sayıyı gösterebiliyoruz. Serper.dev ve
// Anthropic'in ise kalan krediyi döndüren bir API'si yok (sadece kendi panellerinde
// görünüyor) — burada uydurma bir sayı göstermek yerine bunu açıkça belirtiyoruz.
function creditsRow(label, valueText, cls) {
  return `<div class="credits-row"><span class="credits-label">${label}</span><span class="credits-value ${cls || ""}">${valueText}</span></div>`;
}

async function loadCredits() {
  const body = document.getElementById("creditsBody");
  try {
    const res = await fetch("/api/credits");
    const data = await res.json();
    if (!res.ok) {
      body.innerHTML = `<span class="warn">Kredi bilgisi alınamadı.</span>`;
      return;
    }
    const rows = [];

    // SerpAPI
    if (!data.serpapi.configured) {
      rows.push(creditsRow("SerpAPI", "tanımlı değil", "unknown"));
    } else if (!data.serpapi.ok) {
      rows.push(creditsRow("SerpAPI", `okunamadı (${data.serpapi.error || "hata"})`, "unknown"));
    } else {
      const remaining = data.serpapi.remaining;
      const cls = remaining !== null && remaining <= 20 ? "warn" : "ok";
      rows.push(creditsRow("SerpAPI", remaining !== null ? `${remaining} arama kaldı` : "bilinmiyor", cls));
    }

    // Hunter.io
    if (!data.hunter.configured) {
      rows.push(creditsRow("Hunter.io", "tanımlı değil", "unknown"));
    } else if (!data.hunter.ok) {
      rows.push(creditsRow("Hunter.io", `okunamadı (${data.hunter.error || "hata"})`, "unknown"));
    } else {
      const available = data.hunter.available;
      const cls = available !== null && available <= 10 ? "warn" : "ok";
      rows.push(creditsRow("Hunter.io", available !== null ? `${available} kaldı` : "bilinmiyor", cls));
    }

    // Serper.dev — API'de kalan krediyi döndüren bir uç nokta yok, sadece dashboard'da var
    if (!data.serper.configured) {
      rows.push(creditsRow("Serper.dev", "tanımlı değil", "unknown"));
    } else {
      rows.push(creditsRow("Serper.dev", "serper.dev panelinden bak", "unknown"));
    }

    // Anthropic (Claude AI doğrulama) — aynı şekilde API'den bakiye okunamıyor
    if (!data.anthropic.configured) {
      rows.push(creditsRow("Claude AI", "tanımlı değil (opsiyonel)", "unknown"));
    } else {
      rows.push(creditsRow("Claude AI", "console.anthropic.com'dan bak", "unknown"));
    }

    body.innerHTML = rows.join("");
  } catch (e) {
    body.innerHTML = `<span class="warn">Kredi bilgisi alınamadı: ${e.message}</span>`;
  }
}

// Kalıcı "bir daha yazma" listesi: elle ekleme/çıkarma + görüntüleme.
async function loadSuppressionList() {
  const container = document.getElementById("suppressionList");
  if (!container) return;
  try {
    const res = await fetch("/api/suppression");
    const data = await res.json();
    const entries = data.entries || [];
    if (entries.length === 0) {
      container.innerHTML = `<span class="muted">Liste şu an boş.</span>`;
      return;
    }
    container.innerHTML = entries
      .map(
        (e) => `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:6px 0; border-bottom:1px solid #eee;">
        <div>
          <div><strong>${e.email}</strong></div>
          <div class="muted" style="font-size:12px;">${e.reason || ""}${e.brand_name ? ` (${e.brand_name})` : ""}</div>
        </div>
        <button class="small secondary remove-suppression-btn" data-email="${e.email}">Çıkar</button>
      </div>`
      )
      .join("");
    container.querySelectorAll(".remove-suppression-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm(`${btn.dataset.email} adresini listeden çıkarmak istediğine emin misin? Bu adrese tekrar mail gönderilebilir hale gelecek.`)) return;
        await fetch(`/api/suppression/${encodeURIComponent(btn.dataset.email)}`, { method: "DELETE" });
        loadSuppressionList();
        loadBrands();
      });
    });
  } catch (e) {
    container.innerHTML = `<span class="warn">Liste alınamadı: ${e.message}</span>`;
  }
}

document.getElementById("addSuppressionBtn")?.addEventListener("click", async () => {
  const input = document.getElementById("suppressionEmailInput");
  const email = (input.value || "").trim();
  if (!email || !email.includes("@")) return alert("Geçerli bir e-posta adresi gir.");
  await fetch("/api/suppression", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, reason: "Elle eklendi" }),
  });
  input.value = "";
  loadSuppressionList();
  loadBrands();
});

document.getElementById("checkDnsHealthBtn")?.addEventListener("click", async () => {
  const resultEl = document.getElementById("dnsHealthResult");
  resultEl.innerHTML = `<span class="muted">Kontrol ediliyor...</span>`;
  try {
    const res = await fetch("/api/settings/dns-health");
    const data = await res.json();
    if (data.error) {
      resultEl.innerHTML = `<span class="warn">${data.error}</span>`;
      return;
    }
    const row = (label, ok, detail) => {
      const icon = ok === true ? "✅" : ok === false ? "❌" : "❓";
      return `<div style="margin-bottom:6px;">${icon} <strong>${label}</strong>${detail ? ` — ${detail}` : ""}</div>`;
    };
    let html = `<div class="muted" style="margin-bottom:8px;">Domain: ${data.domain}</div>`;
    html += row("SPF", data.spf.found, data.spf.record ? data.spf.record.slice(0, 80) : (data.spf.checked ? "bulunamadı" : "kontrol edilemedi"));
    html += row(
      "DMARC",
      data.dmarc.found,
      data.dmarc.found ? `politika: ${data.dmarc.policy || "belirtilmemiş"}` : (data.dmarc.checked ? "bulunamadı" : "kontrol edilemedi")
    );
    html += row(
      "DKIM",
      data.dkim.found,
      data.dkim.found ? `selector: ${data.dkim.selectors.join(", ")}` : (data.dkim.note || "kontrol edilemedi")
    );
    resultEl.innerHTML = html;
  } catch (e) {
    resultEl.innerHTML = `<span class="warn">Kontrol edilemedi: ${e.message}</span>`;
  }
});

document.getElementById("backupNowBtn")?.addEventListener("click", async () => {
  const statusEl = document.getElementById("backupStatus");
  statusEl.textContent = "Yedek gönderiliyor...";
  try {
    const res = await fetch("/api/settings/backup/send-now", { method: "POST" });
    const data = await res.json();
    if (data.sent) {
      statusEl.textContent = `✅ Yedek gönderildi (${Math.round(data.sizeBytes / 1024)} KB).`;
    } else if (data.reason === "already_sent_this_week") {
      statusEl.textContent = "Bu hafta zaten bir yedek gönderilmiş.";
    } else {
      statusEl.textContent = "Yedek gönderilemedi: " + (data.error || data.reason || "bilinmeyen hata");
    }
  } catch (e) {
    statusEl.textContent = "Yedek gönderilemedi: " + e.message;
  }
});

document.getElementById("circuitBreakerResetBtn")?.addEventListener("click", async () => {
  if (
    !confirm(
      "Bounce oranını inceledin ve gönderime devam etmek istediğine emin misin? Sorun devam ediyorsa (ör. kötü bir liste) freni tekrar tetikleyecektir."
    )
  )
    return;
  await fetch("/api/tracking/circuit-breaker/reset", { method: "POST" });
  loadSettings();
});

wireRichTextToolbars();
loadSettings();
loadBrands();
loadCredits();
loadSuppressionList();

// Sayfa yenilenirse (arama devam ederken ya da duraklatılmışken), butonların ve
// durumun doğru görünmesi için mevcut arama durumunu kontrol et.
(async () => {
  try {
    const res = await fetch("/api/brands/find-all/status");
    const status = await res.json();
    updateFindAllButtons(status);
    if (status.running) {
      document.getElementById("findStatus").textContent = `Aranıyor... (${status.remaining} marka kaldı)`;
      if (status.total > 0) showProgressToast(`🔍 Email Arama (${status.total})`);
      startFindAllPolling();
    } else if (status.remaining > 0) {
      document.getElementById("findStatus").textContent = `Duraklatıldı. ${status.remaining} marka kaldı — "Devam Et" ile devam edebilirsin.`;
    }
  } catch (e) {
    // sessizce geç, kritik değil
  }
})();

// Sayfa değiştirip geri dönüldüğünde ("Dashboard"a bakıp tekrar "Marka Keşif"e
// gelmek gibi) devam eden bir toplu gönderim varsa, ilerleme kartını ve durum
// yazısını kaldığı yerden göstermeye devam etsin diye aynı kontrolü gönderim
// kuyruğu için de yapıyoruz.
(async () => {
  try {
    const res = await fetch("/api/brands/send-batch/status");
    const status = await res.json();
    updateSendBatchButtons(status.running);
    if (status.running) {
      const done = status.sentCount + status.failedCount;
      document.getElementById("sendStatus").textContent = `${done}/${status.total}`;
      showProgressToast(`📤 Toplu Gönderim (${status.total})`);
      startSendBatchPolling();
    }
  } catch (e) {
    // sessizce geç, kritik değil
  }
})();
