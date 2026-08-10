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
// CRM Pipeline: kullanıcının ayarlardan yeniden adlandırıp sıralayabildiği aşama
// listesi (bkz. GET /api/crm/stages) ve — Kategori Ağacı'yla aynı desende — durum
// sekmelerinden BAĞIMSIZ, ek bir AND filtresi.
let pipelineStages = [];
let crmStageFilter = null;

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

// Bug fix: Spam kelime kontrolü, panoya kopyalama (İletişim Formu linki) ve
// diğer düz metin analizleri için HTML etiketlerinden arındırılmış hali üretir.
// ESKİDEN: tmp.textContent/innerText kullanılıyordu — bu, <p>/<div>/<br>/<li>
// gibi blok etiketleri arasına HİÇBİR satır sonu eklemediği için "<p>A</p><p>B</p>"
// gibi bir metin "AB" olarak birleşip paragrafların birbirine girmesine neden
// oluyordu (İletişim Formu'na kopyalanan mail metni, gerçekte gönderilen mailin
// göründüğü gibi değil, tek bir satırda karışık görünüyordu). ARTIK: gerçek mail
// gönderiminde zaten kullanılan, doğru satır sonu üreten AYNI etiket-bazlı
// dönüşüm mantığı (bkz. src/services/mailer.js -> htmlToPlainText) burada da
// kullanılıyor — iki yerdeki (gönderilen mail vs kopyalanan metin) sonuç artık
// TUTARLI.
function richTextToPlain(html) {
  return (html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

function matchesCrmStage(b) {
  if (!crmStageFilter) return true;
  return b.crm_stage === crmStageFilter;
}

// v50: Gelişmiş arama motoru — marka adı, e-mail, website, kategori, ülke, not
// ve AI etiketleri dahil geniş bir metin havuzunda arar (tek satırlık, sunucuya
// gitmeden anında filtreler; binlerce marka için bile pratikte gecikme yaratmaz).
let searchQuery = "";

function brandSearchHaystack(b) {
  let tags = "";
  try {
    const parsed = JSON.parse(b.ai_tags || "[]");
    if (Array.isArray(parsed)) tags = parsed.join(" ");
  } catch (e) {
    // ai_tags henüz yok/bozuksa arama sonucunu etkilemesin
  }
  return [
    b.name,
    b.email,
    b.website,
    b.main_category,
    b.subcategory,
    b.notes,
    b.country,
    b.dominant_seller,
    b.wholesale_page_url,
    tags,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function matchesSearch(b) {
  if (!searchQuery) return true;
  return brandSearchHaystack(b).includes(searchQuery);
}

// v51: Gelişmiş filtreleme — durum sekmeleri/kategori/CRM aşamasının üzerine,
// güven seviyesi, AI önceliği, wholesale sayfası varlığı ve minimum Opportunity
// Score gibi ek kriterler ekler. Hiçbiri seçilmemişse (varsayılan) davranış değişmez.
let advancedFilters = { confidence: "", aiPriority: "", hasWholesale: false, minScore: "" };

function matchesAdvancedFilters(b) {
  if (advancedFilters.confidence && b.confidence !== advancedFilters.confidence) return false;
  if (advancedFilters.aiPriority && b.ai_priority !== advancedFilters.aiPriority) return false;
  if (advancedFilters.hasWholesale && !b.wholesale_page_url) return false;
  if (advancedFilters.minScore !== "" && (Number(b.opportunity_score) || 0) < Number(advancedFilters.minScore)) return false;
  return true;
}

function matchesAllFilters(b) {
  return (
    matchesFilter(b, currentFilter) &&
    matchesCategory(b) &&
    matchesCrmStage(b) &&
    matchesSearch(b) &&
    matchesAdvancedFilters(b)
  );
}

// Marka satırının durum hücresinde, o markayı elle bir pipeline aşamasına
// taşıyabileceğin küçük bir açılır menü. Aşama listesi henüz yüklenmediyse
// (sayfa ilk açıldığında bir an için) hiçbir şey göstermez.
function crmStageSelect(b) {
  if (!pipelineStages || pipelineStages.length === 0) return "";
  const options = pipelineStages
    .map((s) => `<option value="${s.key}" ${b.crm_stage === s.key ? "selected" : ""}>${s.label}</option>`)
    .join("");
  return `<select class="crm-stage-select" data-id="${b.id}" title="CRM Pipeline aşamasını elle değiştir">${options}</select>`;
}

// CRM Pipeline'ın kategori ağacına benzer bir görselleştirmesi: her aşamada kaç
// marka olduğunu gösterir, bir aşamaya tıklanınca tablo o aşamayla filtrelenir.
// Sayılar her zaman anlık yüklü brands[] dizisinden hesaplanır (kategori ağacıyla
// aynı desen) — böylece bir marka bulunduğunda/gönderildiğinde sunucuya tekrar
// sorup beklemeden panel hemen güncellenir.
function renderCrmPipelinePanel() {
  const container = document.getElementById("crmPipeline");
  if (!container || pipelineStages.length === 0) return;
  const counts = {};
  for (const b of brands) {
    const key = b.crm_stage || "new_lead";
    counts[key] = (counts[key] || 0) + 1;
  }
  const totalCount = brands.length;
  const allRowHtml = `
    <div class="category-row cat-all" data-stage="">
      <span class="cat-name">Tümü</span>
      <span class="cat-stat">${totalCount} marka</span>
    </div>
  `;
  const rowsHtml = pipelineStages
    .map((s) => {
      const active = crmStageFilter === s.key ? " active" : "";
      return `
        <div class="category-row${active}" data-stage="${s.key}">
          <span class="cat-name">${s.label}</span>
          <span class="cat-stat">${counts[s.key] || 0} marka</span>
        </div>
      `;
    })
    .join("");
  container.innerHTML = allRowHtml + rowsHtml;
}

async function loadCrmStages() {
  try {
    const res = await fetch("/api/crm/stages");
    const data = await res.json();
    pipelineStages = (data.stages || []).map((s) => ({ key: s.key, label: s.label }));
    // loadBrands() daha önce bitip tabloyu render etmiş olabilir — o anda
    // pipelineStages henüz boş olduğu için satırlardaki aşama seçici görünmemiş
    // olabilir. Marka listesi zaten yüklendiyse tabloyu burada yeniden çiziyoruz
    // ki seçiciler ve pipeline paneli hemen görünsün.
    if (brands.length > 0) renderBrands();
    else renderCrmPipelinePanel();
  } catch (e) {
    // sessizce geç — pipeline sadece bir görselleştirme, kritik değil
  }
}

document.getElementById("crmPipeline").addEventListener("click", (e) => {
  const row = e.target.closest(".category-row");
  if (!row) return;
  const stage = row.dataset.stage;
  crmStageFilter = !stage || crmStageFilter === stage ? null : stage;
  currentPage = 1;
  renderBrands();
});

// --- Pipeline aşamalarını düzenleme (yeniden adlandırma/sıralama/ekleme/silme) ---
// Çalışma kopyası: kullanıcı "Kaydet"e basana kadar sunucuya hiçbir şey gönderilmez.
let pipelineEditorRows = [];

function slugifyStageKey(label, existingKeys) {
  let base = String(label || "stage")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!base) base = "stage";
  let key = base;
  let n = 1;
  while (existingKeys.includes(key)) {
    key = `${base}_${n}`;
    n++;
  }
  return key;
}

function renderPipelineEditor() {
  const container = document.getElementById("pipelineEditorRows");
  if (!container) return;
  container.innerHTML = pipelineEditorRows
    .map(
      (s, i) => `
      <div class="pipeline-editor-row" data-index="${i}" style="display:flex; gap:6px; align-items:center; margin-bottom:6px;">
        <span class="muted" style="width:20px; text-align:right;">${i + 1}.</span>
        <input type="text" class="pipeline-label-input" data-index="${i}" value="${String(s.label).replace(/"/g, "&quot;")}" style="flex:1;" />
        <button class="small secondary pipeline-up-btn" data-index="${i}" title="Yukarı taşı" ${i === 0 ? "disabled" : ""}>↑</button>
        <button class="small secondary pipeline-down-btn" data-index="${i}" title="Aşağı taşı" ${i === pipelineEditorRows.length - 1 ? "disabled" : ""}>↓</button>
        <button class="small secondary pipeline-delete-btn" data-index="${i}" title="Bu aşamayı sil" ${pipelineEditorRows.length <= 1 ? "disabled" : ""}>🗑️</button>
      </div>
    `
    )
    .join("");

  container.querySelectorAll(".pipeline-label-input").forEach((input) => {
    input.addEventListener("input", () => {
      pipelineEditorRows[Number(input.dataset.index)].label = input.value;
    });
  });
  container.querySelectorAll(".pipeline-up-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.index);
      if (i === 0) return;
      [pipelineEditorRows[i - 1], pipelineEditorRows[i]] = [pipelineEditorRows[i], pipelineEditorRows[i - 1]];
      renderPipelineEditor();
    });
  });
  container.querySelectorAll(".pipeline-down-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.index);
      if (i === pipelineEditorRows.length - 1) return;
      [pipelineEditorRows[i + 1], pipelineEditorRows[i]] = [pipelineEditorRows[i], pipelineEditorRows[i + 1]];
      renderPipelineEditor();
    });
  });
  container.querySelectorAll(".pipeline-delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (pipelineEditorRows.length <= 1) return;
      const i = Number(btn.dataset.index);
      if (!confirm(`"${pipelineEditorRows[i].label}" aşamasını silmek istediğine emin misin? Bu aşamadaki markaların verisi kaybolmaz, sadece listede görünmez.`)) return;
      pipelineEditorRows.splice(i, 1);
      renderPipelineEditor();
    });
  });
}

document.getElementById("editPipelineBtn").addEventListener("click", (e) => {
  e.preventDefault();
  const editor = document.getElementById("pipelineEditor");
  const opening = editor.style.display === "none";
  editor.style.display = opening ? "" : "none";
  if (opening) {
    pipelineEditorRows = pipelineStages.map((s) => ({ ...s }));
    renderPipelineEditor();
  }
});

document.getElementById("addStageBtn").addEventListener("click", () => {
  const input = document.getElementById("newStageLabelInput");
  const label = input.value.trim();
  if (!label) return;
  const key = slugifyStageKey(
    label,
    pipelineEditorRows.map((s) => s.key)
  );
  pipelineEditorRows.push({ key, label });
  input.value = "";
  renderPipelineEditor();
});

document.getElementById("savePipelineBtn").addEventListener("click", async () => {
  const statusEl = document.getElementById("pipelineEditorStatus");
  const cleaned = pipelineEditorRows.map((s) => ({ key: s.key, label: (s.label || "").trim() || s.key }));
  if (cleaned.length === 0) {
    statusEl.textContent = "En az bir aşama olmalı.";
    return;
  }
  const res = await fetch("/api/crm/stages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stages: cleaned }),
  });
  const data = await res.json();
  if (!res.ok) {
    statusEl.textContent = data.error || "Kaydedilemedi.";
    return;
  }
  statusEl.textContent = "✓ Kaydedildi.";
  await loadCrmStages();
  renderBrands();
});

document.getElementById("resetPipelineBtn").addEventListener("click", async () => {
  if (!confirm("Pipeline aşamaları varsayılan 10 aşamaya sıfırlanacak (New Lead...Repeat Orders). Emin misin?")) return;
  await fetch("/api/crm/stages/reset", { method: "POST" });
  await loadCrmStages();
  renderBrands();
  document.getElementById("pipelineEditorStatus").textContent = "✓ Varsayılana sıfırlandı.";
});

// Opportunity Score (0-100): sunucuda Brand Score, tahmini ciro, yorum sayısı,
// kategori, web sitesi güveni ve Amazon rekabetinden hesaplanan tek bir öncelik
// puanı (bkz. src/services/opportunityScore.js). Renk kodu: yeşil (≥70) = güçlü
// fırsat, sarı (40-69) = orta, gri (<40) = düşük öncelik. Kırılımı (hangi
// bileşenden kaç puan geldiği) title (hover) metninde gösterilir.
function opportunityBadge(b) {
  if (b.opportunity_score === null || b.opportunity_score === undefined) return "";
  const score = Math.round(b.opportunity_score);
  const level = score >= 70 ? "high" : score >= 40 ? "medium" : "low";
  let title = `Opportunity Score: ${score}/100`;
  if (b.opportunity_score_breakdown) {
    try {
      const parts = JSON.parse(b.opportunity_score_breakdown).parts;
      if (parts) {
        title +=
          "\nBrand Score: " + parts.brandScore +
          " · Ciro: " + parts.revenue +
          " · Yorum: " + parts.reviews +
          " · Kategori: " + parts.category +
          " · Web sitesi: " + parts.website +
          " · Rekabet: " + parts.competition;
      }
    } catch (e) {
      // Bozuk JSON — sadece skoru göster, kırılımı atla.
    }
  }
  return `<span class="opportunity-badge opportunity-${level}" title="${title.replace(/"/g, "&quot;")}">🎯 ${score}</span>`;
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
  const visibleBrands = brands.filter((b) => matchesAllFilters(b));
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
      <td>${b.name}${opportunityBadge(b)}${categoryChip(b)}</td>
      <td class="muted">${marketSummary(b)}</td>
      <td><input data-field="website" data-id="${b.id}" value="${b.website || ""}" /></td>
      <td>
        <input data-field="email" data-id="${b.id}" value="${b.email || ""}" />
        ${b.email && b.confidence === "low" ? `<div class="confidence-warn">⚠️ düşük güven — bu site markaya ait olmayabilir, kontrol et</div>` : ""}
        ${b.suppressed ? `<div class="confidence-warn">🚫 kalıcı "bir daha yazma" listesinde — gönderim engellendi</div>` : ""}
        ${b.action_badge === "DO_NOT_CONTACT" ? `<div class="confidence-warn">🔴 DO NOT CONTACT — Brand Intelligence Amazon/marketplace satışını yasakladı, gönderim engellendi (Marka Detay -> Brand Intelligence)</div>` : ""}
        ${b.phone ? `<div class="muted" style="font-size:12px;">📞 ${b.phone}</div>` : ""}
        ${contactLine}
        <input data-field="notes" data-id="${b.id}" value="${(b.notes || "").replace(/"/g, "&quot;")}" placeholder="Not ekle (ör. tekrar ara, fiyat bekliyor)" style="margin-top:4px; font-size:12px;" />
      </td>
      <td>${badge(b.status)}${sentViaTag}${crmStageSelect(b)}</td>
      <td>
        <div class="actions-cell">
          <button class="small find-btn" data-id="${b.id}" title="E-mail ara">Ara</button>
          <button class="small send-btn" data-id="${b.id}" title="${b.action_badge === "DO_NOT_CONTACT" ? "DO NOT CONTACT — gönderim engellendi" : "Mail gönder"}" ${!b.email || b.status === "duplicate_blocked" || b.suppressed || b.action_badge === "DO_NOT_CONTACT" ? "disabled" : ""}>Gönder</button>
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
  renderCrmPipelinePanel();
}

function updateSelectedCount() {
  const el = document.getElementById("selectedCount");
  if (el) el.textContent = `${selectedIds.size} marka seçili`;
}

function attachRowEvents() {
  // CRM Pipeline aşamasını elle değiştirme — otomatik ilerlemenin aksine burada
  // kullanıcı geriye de alabilir (bilinçli bir düzeltme olduğu için).
  document.querySelectorAll(".crm-stage-select").forEach((sel) => {
    sel.addEventListener("change", async () => {
      const id = sel.dataset.id;
      const stage = sel.value;
      const res = await fetch(`/api/brands/${id}/crm-stage`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage }),
      });
      if (res.ok) {
        const idx = brands.findIndex((b) => String(b.id) === id);
        if (idx !== -1) brands[idx].crm_stage = stage;
        renderCrmPipelinePanel();
      }
    });
  });

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
      if (brand) openBrandPanel(brand);
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

  // v69: Brand Intelligence araştırma önbelleği süresi (madde 24).
  const intelStaleDaysInput = document.getElementById("intelStaleDaysInput");
  if (intelStaleDaysInput) intelStaleDaysInput.value = s.intel_stale_days || 45;

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
  // "Tüm markalar için ara" ve "Seçilenler için Email Ara" aynı sunucu kuyruğunu
  // paylaştığı için, "Aramayı Durdur" butonu da hangisi başlatmış olursa olsun
  // devam eden aramayı durdurabiliyor.
  const stopFindSelectedBtn = document.getElementById("stopFindSelectedBtn");
  if (stopFindSelectedBtn) stopFindSelectedBtn.disabled = !status.running;
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

// v69: Brand Intelligence + Growth Audit — madde 23, toplu (kademeli) araştırma
// UI'ı. "Tüm markalar için email ara" ile AYNI ruhta: sunucudaki research-bulk*
// uç noktalarını (routes/brandIntelligence.js) 3 saniyede bir yoklar, sayfa
// değişse/tarayıcı kapansa bile sunucu tarafında devam eder.
let intelBulkPollInterval = null;

function updateIntelBulkButtons(status) {
  const selectedBtn = document.getElementById("intelBulkSelectedBtn");
  const topNBtn = document.getElementById("intelBulkTopNBtn");
  const stopBtn = document.getElementById("intelBulkStopBtn");
  const resumeBtn = document.getElementById("intelBulkResumeBtn");
  if (selectedBtn) selectedBtn.disabled = status.running;
  if (topNBtn) topNBtn.disabled = status.running;
  if (stopBtn) stopBtn.disabled = !status.running;
  if (resumeBtn) resumeBtn.disabled = status.running || status.remaining === 0;
}

async function pollIntelBulkStatus() {
  const res = await fetch("/api/brands/intel/research-bulk/status");
  const status = await res.json();
  updateIntelBulkButtons(status);
  const statusEl = document.getElementById("intelBulkStatus");
  const levelLabel = `Level ${status.level}`;
  if (status.total > 0) {
    updateProgressToast(status.processedCount, status.total, status.currentBrandName);
  }
  if (!status.running) {
    clearInterval(intelBulkPollInterval);
    intelBulkPollInterval = null;
    if (statusEl) {
      statusEl.textContent =
        status.remaining > 0
          ? `Duraklatıldı (${levelLabel}). ${status.remaining} marka kaldı — "Devam Et" ile devam edebilirsin.`
          : status.total > 0
          ? `Tamamlandı (${levelLabel}). ${status.processedCount}/${status.total} marka işlendi.${
              status.errors && status.errors.length > 0 ? ` (${status.errors.length} hata — konsolu kontrol et)` : ""
            }`
          : "";
    }
    if (status.total > 0) {
      finishProgressToast(status.processedCount);
      loadBrands();
    }
  } else if (statusEl) {
    statusEl.textContent = `Araştırılıyor (${levelLabel})... (${status.remaining} marka kaldı)`;
  }
}

function startIntelBulkPolling() {
  if (intelBulkPollInterval) clearInterval(intelBulkPollInterval);
  intelBulkPollInterval = setInterval(pollIntelBulkStatus, 3000);
}

async function startIntelBulkResearch(body) {
  const res = await fetch("/api/brands/intel/research-bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || "Başlatılamadı.");
    return;
  }
  const statusEl = document.getElementById("intelBulkStatus");
  if (data.queued === 0) {
    if (statusEl) {
      statusEl.textContent = `Araştırılacak marka yok (${data.skippedFresh || 0} tanesi zaten güncel/STALE olmayan bir araştırmaya sahip — "Güncel olanları da tekrar araştır" ile zorlayabilirsin).`;
    }
    return;
  }
  if (statusEl) statusEl.textContent = `Kuyruğa alındı: ${data.queued} marka.`;
  showProgressToast(`🧠 Brand Intelligence — Level ${body.level} (${data.queued})`);
  updateIntelBulkButtons({ running: true, remaining: data.queued });
  startIntelBulkPolling();
}

document.getElementById("intelBulkSelectedBtn").addEventListener("click", async () => {
  if (selectedIds.size === 0) return alert("Önce en az bir marka seç.");
  const level = Number(document.getElementById("intelBulkLevel").value) || 3;
  const force = document.getElementById("intelBulkForce").checked;
  await startIntelBulkResearch({ ids: Array.from(selectedIds), level, force });
});

document.getElementById("intelBulkTopNBtn").addEventListener("click", async () => {
  const level = Number(document.getElementById("intelBulkLevel").value) || 3;
  const force = document.getElementById("intelBulkForce").checked;
  const limit = Number(document.getElementById("intelBulkTopN").value) || 20;
  await startIntelBulkResearch({ level, force, limit });
});

document.getElementById("intelBulkStopBtn").addEventListener("click", async () => {
  const res = await fetch("/api/brands/intel/research-bulk/stop", { method: "POST" });
  const data = await res.json();
  const statusEl = document.getElementById("intelBulkStatus");
  if (statusEl) statusEl.textContent = `Durduruluyor... (${data.remaining} marka kaldı)`;
});

document.getElementById("intelBulkResumeBtn").addEventListener("click", async () => {
  const res = await fetch("/api/brands/intel/research-bulk/resume", { method: "POST" });
  const data = await res.json();
  if (!res.ok) return alert(data.error);
  const statusEl = document.getElementById("intelBulkStatus");
  if (statusEl) statusEl.textContent = "Devam ediliyor...";
  showProgressToast(`🧠 Brand Intelligence (${data.remaining} kaldı)`);
  updateIntelBulkButtons({ running: true, remaining: data.remaining });
  startIntelBulkPolling();
});

// Sayfa yüklendiğinde arka planda zaten çalışan bir intel araştırması varsa
// (ör. sayfa yenilendi/tekrar açıldı) polling'i otomatik devam ettir.
(async function resumeIntelBulkPollingIfRunning() {
  try {
    const res = await fetch("/api/brands/intel/research-bulk/status");
    const status = await res.json();
    updateIntelBulkButtons(status);
    if (status.running) {
      showProgressToast(`🧠 Brand Intelligence — Level ${status.level} (${status.total})`);
      startIntelBulkPolling();
    }
  } catch (e) {
    // sessizce geç
  }
})();

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

// v52: Gönderim öncesi spam/kalite skoru — checkSpamTriggers'ın bulduğu her
// soruna (kelime/kalıp) ağırlıklı bir puan kaybı atayarak yukarıdaki basit
// "var/yok" listesini 0-100 arası tek bir skora çevirir. Kesin bir spam filtresi
// DEĞİLDİR (Gmail/Outlook'un gerçek algoritmasını bilemeyiz), sadece yaygın
// bilinen kötü kalıpları gösterip göndermeden önce gözden geçirmeyi kolaylaştırır.
function computeQualityScore(subject, body) {
  const issues = checkSpamTriggers(subject, body);
  let score = 100;
  for (const issue of issues) {
    if (/çok fazla ünlem/.test(issue)) score -= 10;
    else if (/büyük harf/.test(issue)) score -= 10;
    else if (/çok fazla link/.test(issue)) score -= 15;
    else if (/link kısaltıcı/.test(issue)) score -= 15;
    else score -= 8; // yasaklı kelime/kalıp eşleşmesi
  }
  const plainSubject = (subject || "").trim();
  const plainBody = (body || "").trim();
  if (!plainSubject) {
    score -= 20;
    issues.push("konu satırı boş");
  } else if (plainSubject.length > 78) {
    score -= 5;
    issues.push("konu satırı çok uzun (78 karakterden fazla — bazı istemcilerde kesilir)");
  }
  if (plainBody.length < 50) {
    score -= 15;
    issues.push("mail içeriği çok kısa (50 karakterden az) — düşük efor/otomasyon gibi algılanabilir");
  }
  if (!/{{\s*marka\s*}}/i.test(subject) && !/{{\s*marka\s*}}/i.test(body)) {
    score -= 5;
    issues.push("kişiselleştirme etiketi ({{marka}}) hiç kullanılmamış — kişiselleştirilmemiş mailler daha düşük yanıt oranına sahip olabilir");
  }
  score = Math.max(0, Math.min(100, score));
  const grade = score >= 80 ? "iyi" : score >= 55 ? "orta" : "düşük";
  return { score, grade, issues };
}

function renderQualityScoreBadge() {
  const el = document.getElementById("qualityScoreBadge");
  if (!el) return;
  const subject = subjectInput.value;
  const body = richTextToPlain(bodyInput.innerHTML);
  if (!subject.trim() && !body.trim()) {
    el.style.display = "none";
    return;
  }
  const { score, grade, issues } = computeQualityScore(subject, body);
  el.style.display = "block";
  el.className = `quality-score-badge quality-${grade}`;
  el.title = issues.length > 0 ? issues.join(" • ") : "Herhangi bir sorun tespit edilmedi.";
  el.textContent = `Kalite Skoru: ${score}/100 (${grade === "iyi" ? "İyi" : grade === "orta" ? "Orta" : "Düşük"})${
    issues.length > 0 ? ` — ${issues.length} uyarı (üzerine gel)` : ""
  }`;
}
if (typeof subjectInput !== "undefined" && subjectInput) {
  subjectInput.addEventListener("input", renderQualityScoreBadge);
}
if (typeof bodyInput !== "undefined" && bodyInput) {
  bodyInput.addEventListener("input", renderQualityScoreBadge);
  bodyInput.addEventListener("blur", renderQualityScoreBadge);
}
renderQualityScoreBadge();

document.getElementById("saveTemplateBtn").addEventListener("click", async () => {
  const { score, issues: triggers } = computeQualityScore(subjectInput.value, richTextToPlain(bodyInput.innerHTML));
  if (triggers.length > 0) {
    const proceed = confirm(
      `Kalite Skoru: ${score}/100\n\nŞablonda spam filtrelerini tetikleyebilecek şu ifadeler var:\n\n- ${triggers.join("\n- ")}\n\nYine de kaydetmek istiyor musun?`
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

// v69: Brand Intelligence araştırma önbelleği süresi (madde 24) — Ayarlar'dan
// değiştirilebilir (bkz. routes/settings.js POST /api/settings, services/
// brandIntelligence.js getStaleDays()).
const saveIntelStaleDaysBtn = document.getElementById("saveIntelStaleDaysBtn");
if (saveIntelStaleDaysBtn) {
  saveIntelStaleDaysBtn.addEventListener("click", async () => {
    const raw = Number(document.getElementById("intelStaleDaysInput").value);
    const statusEl = document.getElementById("intelStaleDaysStatus");
    if (!raw || raw < 7 || raw > 365) {
      if (statusEl) statusEl.textContent = "7-365 arası bir sayı gir.";
      return;
    }
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intel_stale_days: raw }),
    });
    if (statusEl) statusEl.textContent = `Kaydedildi (${raw} gün).`;
  });
}

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

// Sağ üstte sabit kalan ilerleme kartı (showProgressToast/updateProgressToast/
// finishProgressToast) artık TÜM sayfalarda (Marka Keşif, Dashboard, Gönderim
// Takibi) ortak yüklenen public/js/jobStatusToast.js dosyasında tanımlı —
// böylece başka bir sayfaya geçtiğinde de kart görünmeye devam ediyor. Burada
// sadece o global fonksiyonları çağırıyoruz.

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
  const { score, issues: triggers } = computeQualityScore(rawSubject, richTextToPlain(rawBody));
  if (triggers.length > 0) {
    const proceed = confirm(
      `Kalite Skoru: ${score}/100\n\nGöndereceğin mail şablonunda spam filtrelerini tetikleyebilecek şu ifadeler var:\n\n- ${triggers.join("\n- ")}\n\n` +
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

// "Seçilenler için Email Ara" ile "Tüm markalar için ara" aynı sunucu kuyruğunu
// (findAllJob) paylaşıyor, bu yüzden bu buton da aynı /stop uç noktasını çağırır
// — hangisi başlatmış olursa olsun devam eden aramayı durdurur.
document.getElementById("stopFindSelectedBtn").addEventListener("click", async () => {
  const res = await fetch("/api/brands/find-all/stop", { method: "POST" });
  const data = await res.json();
  document.getElementById("findSelectedStatus").textContent = `Durduruluyor... (${data.remaining} marka kaldı)`;
  document.getElementById("findStatus").textContent = `Durduruluyor... (${data.remaining} marka kaldı)`;
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
  const visible = brands.filter((b) => matchesAllFilters(b));
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
      brands.filter((b) => matchesAllFilters(b)).forEach((b) => selectedIds.add(String(b.id)));
    }
    renderBrands();
  });
});

// v50/v51: Arama kutusu ve gelişmiş filtreler — her değişiklikte sadece tabloyu
// (renderBrands) yeniden çizer, seçimlere/sayfalamaya dokunmaz (arama yaparken
// yanlışlıkla seçim kaybolmasın diye).
const brandSearchInputEl = document.getElementById("brandSearchInput");
if (brandSearchInputEl) {
  brandSearchInputEl.addEventListener("input", () => {
    searchQuery = brandSearchInputEl.value.trim().toLowerCase();
    currentPage = 1;
    renderBrands();
  });
}
const filterConfidenceEl = document.getElementById("filterConfidence");
if (filterConfidenceEl) {
  filterConfidenceEl.addEventListener("change", () => {
    advancedFilters.confidence = filterConfidenceEl.value;
    currentPage = 1;
    renderBrands();
  });
}
const filterAiPriorityEl = document.getElementById("filterAiPriority");
if (filterAiPriorityEl) {
  filterAiPriorityEl.addEventListener("change", () => {
    advancedFilters.aiPriority = filterAiPriorityEl.value;
    currentPage = 1;
    renderBrands();
  });
}
const filterWholesaleEl = document.getElementById("filterWholesale");
if (filterWholesaleEl) {
  filterWholesaleEl.addEventListener("change", () => {
    advancedFilters.hasWholesale = filterWholesaleEl.value === "yes";
    currentPage = 1;
    renderBrands();
  });
}
const filterMinScoreEl = document.getElementById("filterMinScore");
if (filterMinScoreEl) {
  filterMinScoreEl.addEventListener("input", () => {
    advancedFilters.minScore = filterMinScoreEl.value === "" ? "" : Number(filterMinScoreEl.value);
    currentPage = 1;
    renderBrands();
  });
}
const clearAdvancedFiltersBtnEl = document.getElementById("clearAdvancedFiltersBtn");
if (clearAdvancedFiltersBtnEl) {
  clearAdvancedFiltersBtnEl.addEventListener("click", () => {
    searchQuery = "";
    advancedFilters = { confidence: "", aiPriority: "", hasWholesale: false, minScore: "" };
    if (brandSearchInputEl) brandSearchInputEl.value = "";
    if (filterConfidenceEl) filterConfidenceEl.value = "";
    if (filterAiPriorityEl) filterAiPriorityEl.value = "";
    if (filterWholesaleEl) filterWholesaleEl.value = "";
    if (filterMinScoreEl) filterMinScoreEl.value = "";
    currentPage = 1;
    renderBrands();
  });
}

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
loadCrmStages();

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

// ============================================================================
// v46 Marka Detay Paneli: eski "Detay" butonunun (sadece arama adımlarını
// alert() ile gösteren) yerini alan kapsamlı panel. Sekmeler: Arama Adımları,
// Timeline (v53), Görevler (v46), Evraklar (v54), AI Analiz (v55/56/57),
// Wholesale Form (v63). Her sekme AÇILDIĞINDA verisi taze çekilir (basit ve
// güvenilir — karmaşık bir cache mekanizması gerektirmez, tek marka için veri
// hacmi zaten küçüktür).
// ============================================================================
let currentPanelBrand = null;
let documentTypesCache = null;

function openBrandPanel(brand) {
  currentPanelBrand = brand;
  document.getElementById("brandPanelTitle").textContent = `${brand.name} — Marka Detayı`;
  // v71 QA fix: DO_NOT_CONTACT durumu artık hangi sekmede olursan ol görünür —
  // sadece AI/Intel sekmesine girince değil, panel açılır açılmaz üstte.
  const existingBanner = document.getElementById("brandPanelDncBanner");
  if (existingBanner) existingBanner.remove();
  if (brand.action_badge === "DO_NOT_CONTACT") {
    const banner = document.createElement("div");
    banner.id = "brandPanelDncBanner";
    banner.className = "warn";
    banner.style.cssText = "margin:8px 16px; padding:10px; border-radius:6px; background:#fdecea; border:1px solid #f5c2c0;";
    banner.innerHTML = `🔴 <b>DO NOT CONTACT</b> — Brand Intelligence bu markanın Amazon/marketplace'te satışının yasak olduğunu ya da kritik bir red flag taşıdığını tespit etti. Email üretimi ve gönderim (tekli/toplu/otomatik) engellendi. Detay için "Brand Intelligence" sekmesine bak.`;
    document.getElementById("brandPanelTitle").insertAdjacentElement("afterend", banner);
  }
  document.querySelectorAll(".brand-panel-tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === "trace"));
  document.querySelectorAll(".brand-panel-section").forEach((s) => (s.style.display = "none"));
  document.getElementById("brandPanelTrace").style.display = "block";
  renderTraceTab(brand);
  document.getElementById("brandPanelOverlay").style.display = "flex";
}

function closeBrandPanel() {
  document.getElementById("brandPanelOverlay").style.display = "none";
  currentPanelBrand = null;
}

document.getElementById("brandPanelCloseBtn").addEventListener("click", closeBrandPanel);
document.getElementById("brandPanelOverlay").addEventListener("click", (e) => {
  if (e.target.id === "brandPanelOverlay") closeBrandPanel();
});

document.querySelectorAll(".brand-panel-tab").forEach((tabBtn) => {
  tabBtn.addEventListener("click", () => {
    if (!currentPanelBrand) return;
    document.querySelectorAll(".brand-panel-tab").forEach((t) => t.classList.toggle("active", t === tabBtn));
    document.querySelectorAll(".brand-panel-section").forEach((s) => (s.style.display = "none"));
    const tab = tabBtn.dataset.tab;
    if (tab === "trace") {
      document.getElementById("brandPanelTrace").style.display = "block";
      renderTraceTab(currentPanelBrand);
    } else if (tab === "intel") {
      document.getElementById("brandPanelIntel").style.display = "block";
      loadIntelTab(currentPanelBrand);
    } else if (tab === "timeline") {
      document.getElementById("brandPanelTimeline").style.display = "block";
      loadTimelineTab(currentPanelBrand);
    } else if (tab === "tasks") {
      document.getElementById("brandPanelTasks").style.display = "block";
      loadTasksTab(currentPanelBrand);
    } else if (tab === "documents") {
      document.getElementById("brandPanelDocuments").style.display = "block";
      loadDocumentsTab(currentPanelBrand);
    } else if (tab === "ai") {
      document.getElementById("brandPanelAi").style.display = "block";
      document.getElementById("aiResultBox").innerHTML = "";
      loadOutreachIntelBox(currentPanelBrand);
    } else if (tab === "wholesale") {
      document.getElementById("brandPanelWholesale").style.display = "block";
      renderWholesaleTab(currentPanelBrand);
    }
  });
});

function renderTraceTab(brand) {
  const steps = (brand.last_error || "Henüz aranmadı.").split(" | ");
  document.getElementById("brandPanelTrace").innerHTML =
    `<ul style="margin:0; padding-left:18px;">${steps.map((s) => `<li>${s}</li>`).join("")}</ul>`;
}

// ============================================================================
// v68: BRAND INTELLIGENCE + GROWTH AUDIT sekmesi. Bkz. routes/brandIntelligence.js
// ve services/brandIntelligence.js. Sadece burada, kullanıcı sekmeyi açtığında
// veri çekilir/render edilir — mevcut hiçbir otomatik akışı etkilemez.
// ============================================================================
function escapeHtmlIntel(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// v69 QA fix: "PHONE_FIRST" (madde 30'daki 5 rozetten biri) eksikti —
// computeActionBadge() bunu artık üretebiliyor (bkz. brandIntelligence.js),
// ama burada bir karşılığı olmadığı için badgeMeta null'a düşüp rozet hiç
// görünmüyordu. Eklendi.
const ACTION_BADGE_META = {
  CONTACT_NOW: { emoji: "🟢", label: "CONTACT NOW", cls: "found" },
  RESEARCH_MORE: { emoji: "🟡", label: "RESEARCH MORE", cls: "pending" },
  DISTRIBUTOR_ROUTE: { emoji: "🔵", label: "DISTRIBUTOR ROUTE", cls: "sent" },
  PHONE_FIRST: { emoji: "📞", label: "PHONE FIRST", cls: "pending" },
  DO_NOT_CONTACT: { emoji: "🔴", label: "DO NOT CONTACT", cls: "not_found" },
};

// v69 QA fix (Listing Audit precision): "NO" (gerçekten yok, kontrol edildi) ile
// "UNKNOWN" (erişilemedi/doğrulanamadı) panelde AYNI görünmemeli — kullanıcı
// testi tam olarak bunu istiyor: "No A+ Content found" (NO) vs "A+ Content
// could not be verified" (UNKNOWN). YES/NO/UNKNOWN dışında bir metin gelirse
// (AI'nın eski/serbest formatlı bir yanıtı ya da başka bir alan) olduğu gibi
// gösterilir, hiçbir şey uydurulmaz.
function presenceLabel(value, itemName) {
  const v = String(value == null ? "" : value).toUpperCase();
  if (v === "YES") return `✅ ${itemName} found`;
  if (v === "NO") return `❌ No ${itemName} found`;
  if (v === "UNKNOWN" || !v) return `<span class="muted">❓ ${itemName} could not be verified</span>`;
  return escapeHtmlIntel(value); // beklenmedik bir değer geldiyse olduğu gibi göster
}

function intelField(obj, key, fallback) {
  const f = obj && obj[key];
  if (!f) return { value: fallback || "UNKNOWN", source: null };
  if (typeof f === "object") {
    return { value: f.value ?? f.status ?? fallback ?? "UNKNOWN", source: f.source || null, note: f.note || null };
  }
  return { value: f, source: null };
}

function renderFieldRow(label, field) {
  const val = escapeHtmlIntel(field.value);
  const isUnknown = String(field.value).toUpperCase() === "UNKNOWN";
  const sourceHtml = field.source
    ? ` <a href="${escapeHtmlIntel(field.source)}" target="_blank" rel="noopener" class="muted" style="font-size:11px;">[kaynak]</a>`
    : "";
  return `<div style="padding:4px 0; ${isUnknown ? "color:var(--text-muted);" : ""}"><b>${label}:</b> ${val}${sourceHtml}${
    field.note ? `<div class="muted" style="font-size:12px;">${escapeHtmlIntel(field.note)}</div>` : ""
  }</div>`;
}

async function loadIntelTab(brand) {
  const el = document.getElementById("brandPanelIntel");
  el.innerHTML = "Yükleniyor...";
  let data;
  try {
    const res = await fetch(`/api/brands/${brand.id}/intel`);
    data = await res.json();
    if (!res.ok) throw new Error(data.error || "Yüklenemedi.");
  } catch (e) {
    el.innerHTML = `<p class="muted">Yüklenirken hata oluştu: ${escapeHtmlIntel(e.message)}</p>`;
    return;
  }

  const intel = data.intel;
  const notResearched = !intel.research_status || intel.research_status === "not_researched";

  if (!data.aiConfigured) {
    el.innerHTML = `<p class="muted">Brand Intelligence araştırması için Ayarlar'da bir Anthropic API anahtarı gerekir (ANTHROPIC_API_KEY, console.anthropic.com). Tanımlanmadan bu sekme çalışmaz.</p>`;
    return;
  }

  const badgeMeta = ACTION_BADGE_META[intel.action_badge] || null;
  const opportunityScore = brand.opportunity_score != null ? Math.round(brand.opportunity_score) : null;

  const researchButtons = `
    <div class="toolbar" style="margin-bottom:14px;">
      <button class="small secondary intel-research-btn" data-level="2">Level 2: Hızlı Tarama</button>
      <button class="small secondary intel-research-btn" data-level="3">Level 3: Derin Araştırma</button>
      <button class="small secondary intel-research-btn" data-level="4">Level 4: Growth Audit</button>
      <span class="muted" id="intelResearchStatus"></span>
    </div>`;

  if (notResearched) {
    el.innerHTML = `
      ${researchButtons}
      <p class="muted">Bu marka için henüz Brand Intelligence araştırması yapılmadı. Yukarıdan bir seviye seç
      (Level 2 hızlı ve ucuz, Level 3 kapsamlı, Level 4 sadece yüksek potansiyelli markalarda önerilir).</p>`;
    wireIntelResearchButtons(brand);
    return;
  }

  const staleNote = data.stale
    ? `<div class="badge pending" style="margin-bottom:10px;">⚠️ Bu araştırma 45+ gün önce yapılmış (STALE) — güncel olmayabilir, tekrar araştırabilirsin.</div>`
    : "";

  const topSummary = `
    <div style="display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-bottom:14px; padding:12px; background:var(--primary-soft, #edeafd); border-radius:10px;">
      ${
        badgeMeta
          ? `<span class="badge ${badgeMeta.cls}" style="font-size:14px; padding:6px 12px;">${badgeMeta.emoji} ${badgeMeta.label}</span>`
          : ""
      }
      <span><b>Neofa Priority:</b> ${intel.neofa_priority != null ? intel.neofa_priority + "/100" : "—"}</span>
      <span class="muted">SmartScout Opportunity: ${opportunityScore != null ? opportunityScore + "/100" : "—"}</span>
      <span class="muted">Brand Accessibility: ${
        intel.accessibility_score != null ? `${Math.round(intel.accessibility_score)}/100 (${intel.accessibility_grade})` : "—"
      }</span>
    </div>
    ${
      intel.next_best_action
        ? `<div style="margin-bottom:14px;"><b>Next Best Action:</b> ${escapeHtmlIntel(intel.next_best_action)}</div>`
        : ""
    }`;

  const companyData = intel.companyData || {};
  const wholesaleData = intel.wholesaleData || {};
  const marketplacePolicy = intel.marketplacePolicy || {};
  const distributorData = intel.distributorData || {};
  const contacts = intel.contacts || [];
  const redFlags = intel.redFlags || [];
  const listingAudit = intel.listingAudit || {};
  const imageAudit = intel.imageAudit || {};
  const topOpportunities = intel.topOpportunities || [];
  const valueProposition = intel.valueProposition || [];

  const companySection = `
    <details open><summary class="category-tree-toggle">🏢 Company</summary>
      ${renderFieldRow("Resmi website", intelField(companyData, "official_website", brand.website))}
      ${renderFieldRow("Şirket adı", intelField(companyData, "company_name"))}
      ${renderFieldRow("Kurucu/Sahibi", intelField(companyData, "founder_owner"))}
      ${renderFieldRow("Şirket büyüklüğü", intelField(companyData, "company_size"))}
      ${renderFieldRow("LinkedIn", intelField(companyData, "linkedin"))}
      ${renderFieldRow("Genel e-mail", intelField(companyData, "general_email"))}
      ${renderFieldRow("Wholesale iletişim", intelField(companyData, "wholesale_contact"))}
      ${renderFieldRow("Telefon", intelField(companyData, "phone"))}
    </details>`;

  // v69 QA fix: her bileşen artık {label, score, weight, pointsEarned, reason}
  // taşıyor — kullanıcı hangi puanın NEDEN verildiğini görebilsin diye
  // ("Wholesale Accessibility: 17/20 — Reason: ..." formatı).
  const accessBreakdown = intel.accessibilityBreakdown;
  const breakdownRows = accessBreakdown
    ? Object.values(accessBreakdown.parts)
        .map(
          (p) =>
            `<div style="padding:4px 0; border-bottom:1px solid #f0f0f0;">
               <div style="display:flex; justify-content:space-between;"><b>${escapeHtmlIntel(p.label)}</b><span>${p.pointsEarned}/${p.weight}</span></div>
               <div class="muted" style="font-size:12px;">${escapeHtmlIntel(p.reason)}</div>
             </div>`
        )
        .join("")
    : `<p class="muted">Henüz hesaplanmadı (Level 3 çalıştır).</p>`;

  const wholesaleSection = `
    <details><summary class="category-tree-toggle">📦 Wholesale Intelligence</summary>
      ${renderFieldRow("Wholesale programı", intelField(wholesaleData, "wholesale_program"))}
      ${renderFieldRow("Direct wholesale", intelField(wholesaleData, "direct_wholesale"))}
      ${renderFieldRow("Distributor gereksinimi", intelField(wholesaleData, "distributor_requirement"))}
      ${renderFieldRow("MOQ", intelField(wholesaleData, "moq"))}
      ${renderFieldRow("Opening order minimum", intelField(wholesaleData, "opening_order_minimum"))}
      ${renderFieldRow("Payment/Net terms", intelField(wholesaleData, "payment_terms"))}
    </details>`;

  const marketplaceSection = `
    <details><summary class="category-tree-toggle">🛒 Marketplace Policy</summary>
      ${renderFieldRow("Amazon izni", intelField(marketplacePolicy, "amazon_allowed"))}
      ${renderFieldRow("MAP policy", intelField(marketplacePolicy, "map_policy"))}
      ${renderFieldRow("Reseller policy", intelField(marketplacePolicy, "reseller_policy"))}
    </details>`;

  const distributorSection = `
    <details><summary class="category-tree-toggle">🚚 Distributor</summary>
      ${
        distributorData.distributors && distributorData.distributors.length > 0
          ? distributorData.distributors
              .map(
                (d) => `<div style="padding:6px 0; border-bottom:1px solid var(--border);">
                  <b>${escapeHtmlIntel(d.name)}</b> ${d.verified ? "✅ verified" : "⚠️ UNVERIFIED DISTRIBUTOR"}<br/>
                  <span class="muted">${escapeHtmlIntel(d.website || "")} — ${escapeHtmlIntel(d.evidence || "")}</span>
                </div>`
              )
              .join("")
          : `<p class="muted">Distribütör bulunamadı / direct wholesale yapıyor olabilir.</p>`
      }
    </details>`;

  const contactSection = `
    <details><summary class="category-tree-toggle">📇 Contact Intelligence (${contacts.length})</summary>
      ${
        contacts.length > 0
          ? contacts
              .map(
                (c) => `<div style="padding:6px 0; border-bottom:1px solid var(--border);">
                  <b>${escapeHtmlIntel(c.title || "")}</b> ${c.name ? `— ${escapeHtmlIntel(c.name)}` : ""}<br/>
                  <span class="muted">${escapeHtmlIntel(c.email || c.phone || "")} · güven: ${escapeHtmlIntel(
                  c.confidence || "?"
                )} · kaynak: ${escapeHtmlIntel(c.source || "?")}</span>
                </div>`
              )
              .join("")
          : `<p class="muted">Henüz kontak listesi oluşturulmadı.</p>`
      }
    </details>`;

  const redFlagsSection = `
    <details ${redFlags.length > 0 ? "open" : ""}><summary class="category-tree-toggle">🚨 Red Flags (${redFlags.length})</summary>
      ${
        redFlags.length > 0
          ? redFlags
              .map(
                (f) => `<div style="padding:4px 0;">🚨 <b>${escapeHtmlIntel(f.flag)}</b>${
                  f.note ? ` — ${escapeHtmlIntel(f.note)}` : ""
                }${f.source ? ` <a href="${escapeHtmlIntel(f.source)}" target="_blank" rel="noopener" class="muted" style="font-size:11px;">[kaynak]</a>` : ""}</div>`
              )
              .join("")
          : `<p class="muted">Tespit edilen bir red flag yok.</p>`
      }
    </details>`;

  const listingSection = `
    <details><summary class="category-tree-toggle">📋 Amazon Listing Audit</summary>
      ${
        listingAudit.available
          ? `
        <div class="muted" style="padding:2px 0;">Title: ${escapeHtmlIntel(listingAudit.title_quality || "UNKNOWN")}${listingAudit.title_length_adequate ? ` (uzunluk yeterli: ${escapeHtmlIntel(listingAudit.title_length_adequate)})` : ""}</div>
        <div class="muted" style="padding:2px 0;">Bullet Points: ${escapeHtmlIntel(listingAudit.bullet_points_quality || "UNKNOWN")}${listingAudit.bullet_points_count_mentioned ? ` (${escapeHtmlIntel(listingAudit.bullet_points_count_mentioned)} adet)` : ""}</div>
        <div class="muted" style="padding:2px 0;">Açıklama: ${escapeHtmlIntel(listingAudit.description_quality || "UNKNOWN")}</div>
        <div class="muted" style="padding:2px 0;">Anahtar Kelime Optimizasyonu: ${escapeHtmlIntel(listingAudit.keywords_optimization || "UNKNOWN")}</div>
        <div class="muted" style="padding:2px 0;">Varyasyonlar (renk/boy): ${presenceLabel(listingAudit.variations_present, "Variations")}</div>
        <div class="muted" style="padding:2px 0;">A+ Content: ${presenceLabel(listingAudit.a_plus_content_present, "A+ Content")}</div>
        <div class="muted" style="padding:2px 0;">Video: ${presenceLabel(listingAudit.video_present, "Video")}</div>
        <div class="muted" style="padding:2px 0;">Brand Store: ${presenceLabel(listingAudit.brand_store_present, "Brand Store")}${listingAudit.brand_store_quality ? ` — ${escapeHtmlIntel(listingAudit.brand_store_quality)}` : ""}</div>
        <div class="muted" style="padding:2px 0;">Yorum/Puan: ${escapeHtmlIntel(listingAudit.review_count_mentioned || "UNKNOWN")} yorum, ${escapeHtmlIntel(listingAudit.rating_mentioned || "UNKNOWN")} puan</div>
        ${
          Array.isArray(listingAudit.review_themes) && listingAudit.review_themes.length > 0
            ? `<div class="muted" style="padding:2px 0;">Yorum Temaları: ${listingAudit.review_themes.map(escapeHtmlIntel).join(", ")}</div>`
            : ""
        }
        <div class="muted" style="padding:2px 0;">Mobil Okunabilirlik: ${escapeHtmlIntel(listingAudit.mobile_readability || "UNKNOWN")}</div>
        ${
          imageAudit.available
            ? `
        <div class="muted" style="padding:2px 0; margin-top:6px;"><b>🖼️ Görsel Analizi (ana görsel)</b></div>
        <div class="muted" style="padding:2px 0;">Profesyonellik: ${escapeHtmlIntel(imageAudit.professional_quality || "UNKNOWN")}</div>
        <div class="muted" style="padding:2px 0;">Çözünürlük/Netlik: ${escapeHtmlIntel(imageAudit.resolution_clarity || "UNKNOWN")}</div>
        <div class="muted" style="padding:2px 0;">Arka Plan: ${escapeHtmlIntel(imageAudit.background_cleanliness || "UNKNOWN")}</div>
        <div class="muted" style="padding:2px 0;">Ürün Görünürlüğü: ${escapeHtmlIntel(imageAudit.product_visibility || "UNKNOWN")}</div>
        <div class="muted" style="padding:2px 0;">Ambalaj Sunumu: ${escapeHtmlIntel(imageAudit.packaging_presentation || "UNKNOWN")}</div>
        <div class="muted" style="padding:2px 0;">Görsel Üzeri Metin Okunabilirliği: ${escapeHtmlIntel(imageAudit.text_readability_on_image || "UNKNOWN")}</div>
        <div class="muted" style="padding:2px 0;">Rekabete Göre Görsel Kalite: ${escapeHtmlIntel(imageAudit.competitive_visual_quality || "UNKNOWN")}</div>
        <div class="muted" style="padding:2px 0; font-size:11px;">ℹ️ Sadece ana görsel değerlendirildi — toplam görsel sayısı/lifestyle görseli varlığı bilinmiyor.</div>`
            : `<div class="muted" style="padding:2px 0;">IMAGE AUDIT UNAVAILABLE (görsele erişilemedi)</div>`
        }`
          : `<p class="muted">${
              listingAudit.reason === "no_storefront_url"
                ? "Bu markada Amazon storefront/ASIN linki yok."
                : "Amazon sayfası erişilemedi/bot korumasına takıldı — Level 4 ile tekrar dene."
            }</p>`
      }
    </details>`;

  const opportunitiesSection = `
    <details open><summary class="category-tree-toggle">🎯 Top Growth Opportunities</summary>
      ${
        topOpportunities.length > 0
          ? `<ol style="margin:0; padding-left:18px;">${topOpportunities.map((o) => `<li>${escapeHtmlIntel(o)}</li>`).join("")}</ol>`
          : `<p class="muted">Henüz belirlenmedi (Level 3/4 çalıştır).</p>`
      }
    </details>`;

  const valuePropSection = `
    <details><summary class="category-tree-toggle">💡 What Neofa Can Offer</summary>
      ${
        valueProposition.length > 0
          ? `<ul style="margin:0; padding-left:18px;">${valueProposition.map((v) => `<li>${escapeHtmlIntel(v)}</li>`).join("")}</ul>`
          : `<p class="muted">Henüz belirlenmedi.</p>`
      }
    </details>`;

  const strategySection = `
    <details open><summary class="category-tree-toggle">📈 Recommended Outreach Strategy</summary>
      <div><b>Pitch Angle:</b> ${escapeHtmlIntel(intel.pitch_angle || "—")}</div>
      ${intel.pitch_angle_reason ? `<div class="muted">${escapeHtmlIntel(intel.pitch_angle_reason)}</div>` : ""}
      <div style="margin-top:8px;"><b>Strateji:</b> ${escapeHtmlIntel(intel.outreach_strategy || "—")}</div>
      ${intel.outreach_strategy_reason ? `<div class="muted">${escapeHtmlIntel(intel.outreach_strategy_reason)}</div>` : ""}
    </details>`;

  const scoreBreakdownSection = `
    <details><summary class="category-tree-toggle">🧮 Brand Accessibility Score — Neden bu puan?</summary>
      ${breakdownRows}
    </details>`;

  const authTrackingSection = `
    <details><summary class="category-tree-toggle">✅ Amazon Authorization Tracking</summary>
      <p class="muted" style="margin-top:0;">Bunlar AI tahmini DEĞİL — süreç ilerledikçe elle güncellediğin gerçek durumlar. Wholesale onayı almak otomatik olarak Amazon yetkilendirmesi anlamına gelmez.</p>
      <label class="muted">Wholesale Başvuru Durumu:
        <select id="intelWholesaleApprovalStatus" style="margin-left:6px;">
          <option value="not_applied">Başvurulmadı</option>
          <option value="applied">Başvuruldu</option>
          <option value="approved">Onaylandı</option>
          <option value="rejected">Reddedildi</option>
        </select>
      </label>
      <div style="margin-top:8px;">
        <label class="muted"><input type="checkbox" id="intelLoaRequested" style="width:auto;" /> LOA istendi</label>
        &nbsp;&nbsp;
        <label class="muted"><input type="checkbox" id="intelLoaReceived" style="width:auto;" /> LOA alındı</label>
      </div>
      <label class="muted" style="display:block; margin-top:8px;">Authorized Reseller Durumu:
        <select id="intelAuthorizedResellerStatus" style="margin-left:6px;">
          <option value="unknown">Bilinmiyor</option>
          <option value="pending">Beklemede</option>
          <option value="confirmed">Doğrulandı</option>
        </select>
      </label>
      <label class="muted" style="display:block; margin-top:8px;">Amazon Approval Durumu:
        <select id="intelAmazonApprovalStatus" style="margin-left:6px;">
          <option value="unknown">Bilinmiyor</option>
          <option value="pending">Beklemede</option>
          <option value="approved">Onaylandı</option>
          <option value="denied">Reddedildi</option>
        </select>
      </label>
      <label class="muted" style="display:block; margin-top:8px;">Amazon Gating Durumu:
        <select id="intelAmazonGatingStatus" style="margin-left:6px;">
          <option value="unknown">Bilinmiyor</option>
          <option value="not_gated">Gated değil</option>
          <option value="gated">Gated</option>
          <option value="ungated">Ungated edildi</option>
        </select>
      </label>
      <div style="margin-top:10px;">
        <input type="number" id="intelFirstPoValue" placeholder="İlk PO değeri ($) — kaydedildiyse bir daha sayılmaz" style="max-width:240px;" />
        <button id="intelSaveAuthBtn" class="small secondary" style="margin-left:6px;">Kaydet</button>
        <span class="muted" id="intelAuthSaveStatus"></span>
      </div>
    </details>`;

  el.innerHTML =
    researchButtons +
    staleNote +
    topSummary +
    companySection +
    wholesaleSection +
    marketplaceSection +
    distributorSection +
    contactSection +
    redFlagsSection +
    scoreBreakdownSection +
    listingSection +
    opportunitiesSection +
    valuePropSection +
    strategySection +
    authTrackingSection;

  // Manuel authorization tracking alanlarını mevcut değerlerle doldur.
  const setSel = (id, val) => {
    const elx = document.getElementById(id);
    if (elx) elx.value = val || elx.value;
  };
  setSel("intelWholesaleApprovalStatus", intel.wholesale_approval_status);
  setSel("intelAuthorizedResellerStatus", intel.authorized_reseller_status);
  setSel("intelAmazonApprovalStatus", intel.amazon_approval_status);
  setSel("intelAmazonGatingStatus", intel.amazon_gating_status);
  const loaReqEl = document.getElementById("intelLoaRequested");
  const loaRecEl = document.getElementById("intelLoaReceived");
  if (loaReqEl) loaReqEl.checked = Boolean(intel.loa_requested);
  if (loaRecEl) loaRecEl.checked = Boolean(intel.loa_received);

  document.getElementById("intelSaveAuthBtn").addEventListener("click", async () => {
    const statusEl = document.getElementById("intelAuthSaveStatus");
    statusEl.textContent = "Kaydediliyor...";
    const body = {
      wholesale_approval_status: document.getElementById("intelWholesaleApprovalStatus").value,
      loa_requested: document.getElementById("intelLoaRequested").checked ? 1 : 0,
      loa_received: document.getElementById("intelLoaReceived").checked ? 1 : 0,
      authorized_reseller_status: document.getElementById("intelAuthorizedResellerStatus").value,
      amazon_approval_status: document.getElementById("intelAmazonApprovalStatus").value,
      amazon_gating_status: document.getElementById("intelAmazonGatingStatus").value,
    };
    const poVal = Number(document.getElementById("intelFirstPoValue").value);
    if (poVal > 0) body.first_po_value = poVal;
    try {
      const res = await fetch(`/api/brands/${brand.id}/intel`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Kaydedilemedi.");
      statusEl.textContent = "Kaydedildi ✓";
    } catch (e) {
      statusEl.textContent = "Hata: " + e.message;
    }
  });

  wireIntelResearchButtons(brand);
}

function wireIntelResearchButtons(brand) {
  document.querySelectorAll(".intel-research-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const statusEl = document.getElementById("intelResearchStatus");
      document.querySelectorAll(".intel-research-btn").forEach((b) => (b.disabled = true));
      if (statusEl) statusEl.textContent = "Araştırılıyor, biraz sürebilir...";
      try {
        const res = await fetch(`/api/brands/${brand.id}/intel/research`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ level: Number(btn.dataset.level) }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Araştırma başarısız.");
        if (statusEl) statusEl.textContent = data.ok ? "Tamamlandı ✓" : `Tamamlanamadı: ${data.reason || ""}`;
        loadIntelTab(brand);
      } catch (e) {
        if (statusEl) statusEl.textContent = "Hata: " + e.message;
        document.querySelectorAll(".intel-research-btn").forEach((b) => (b.disabled = false));
      }
    });
  });
}

async function loadTimelineTab(brand) {
  const el = document.getElementById("brandPanelTimeline");
  el.innerHTML = "Yükleniyor...";
  try {
    const res = await fetch(`/api/brands/${brand.id}/timeline`);
    const data = await res.json();
    if (!data.timeline || data.timeline.length === 0) {
      el.innerHTML = `<p class="muted">Henüz bir olay kaydedilmemiş.</p>`;
      return;
    }
    el.innerHTML = `<ul style="margin:0; padding-left:0; list-style:none;">${data.timeline
      .map(
        (ev) =>
          `<li style="padding:8px 0; border-bottom:1px solid var(--border);">
             <b>${ev.label}</b>${ev.at ? ` <span class="muted">— ${new Date(ev.at).toLocaleString("tr-TR")}</span>` : ""}
             ${ev.detail ? `<div class="muted" style="margin-top:2px;">${String(ev.detail).slice(0, 200)}</div>` : ""}
           </li>`
      )
      .join("")}</ul>`;
  } catch (e) {
    el.innerHTML = `<p class="muted">Yüklenirken hata oluştu.</p>`;
  }
}

async function loadTasksTab(brand) {
  const listEl = document.getElementById("taskList");
  listEl.innerHTML = "Yükleniyor...";
  try {
    const res = await fetch(`/api/brands/${brand.id}/tasks`);
    const data = await res.json();
    if (!data.tasks || data.tasks.length === 0) {
      listEl.innerHTML = `<p class="muted">Henüz görev eklenmemiş.</p>`;
      return;
    }
    listEl.innerHTML = data.tasks
      .map(
        (t) => `
        <div class="today-item-row" style="justify-content:space-between;">
          <label style="display:flex; gap:8px; align-items:flex-start; flex:1;">
            <input type="checkbox" class="task-complete-checkbox" data-task-id="${t.id}" ${t.completed ? "checked" : ""} />
            <span style="${t.completed ? "text-decoration:line-through; color:var(--text-muted);" : ""}">${t.title}${t.due_date ? ` <span class="muted">(${t.due_date})</span>` : ""}</span>
          </label>
          <button class="small secondary task-delete-btn" data-task-id="${t.id}" title="Görevi sil">🗑️</button>
        </div>`
      )
      .join("");
    listEl.querySelectorAll(".task-complete-checkbox").forEach((cb) => {
      cb.addEventListener("change", async () => {
        await fetch(`/api/tasks/${cb.dataset.taskId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ completed: cb.checked }),
        });
        loadTasksTab(brand);
      });
    });
    listEl.querySelectorAll(".task-delete-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await fetch(`/api/tasks/${btn.dataset.taskId}`, { method: "DELETE" });
        loadTasksTab(brand);
      });
    });
  } catch (e) {
    listEl.innerHTML = `<p class="muted">Yüklenirken hata oluştu.</p>`;
  }
}

document.getElementById("addTaskBtn").addEventListener("click", async () => {
  if (!currentPanelBrand) return;
  const titleEl = document.getElementById("newTaskTitle");
  const dueEl = document.getElementById("newTaskDueDate");
  if (!titleEl.value.trim()) return alert("Görev başlığı boş olamaz.");
  const res = await fetch(`/api/brands/${currentPanelBrand.id}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: titleEl.value.trim(), due_date: dueEl.value || null }),
  });
  const data = await res.json();
  if (!res.ok) return alert(data.error || "Görev eklenemedi.");
  titleEl.value = "";
  dueEl.value = "";
  loadTasksTab(currentPanelBrand);
});

async function loadDocumentsTab(brand) {
  const selectEl = document.getElementById("newDocType");
  if (!documentTypesCache) {
    try {
      const res = await fetch("/api/documents/types");
      const data = await res.json();
      documentTypesCache = data.types || [];
    } catch (e) {
      documentTypesCache = ["Diğer"];
    }
    selectEl.innerHTML = documentTypesCache.map((t) => `<option value="${t}">${t}</option>`).join("");
  }

  const listEl = document.getElementById("documentList");
  listEl.innerHTML = "Yükleniyor...";
  try {
    const res = await fetch(`/api/brands/${brand.id}/documents`);
    const data = await res.json();
    if (!data.documents || data.documents.length === 0) {
      listEl.innerHTML = `<p class="muted">Henüz evrak yüklenmemiş.</p>`;
      return;
    }
    listEl.innerHTML = data.documents
      .map(
        (d) => `
        <div class="today-item-row" style="justify-content:space-between;">
          <span>📎 <b>${d.doc_type}</b> — ${d.original_name}</span>
          <span>
            <a href="/api/documents/${d.id}/download" class="small secondary" style="text-decoration:none; padding:4px 8px; border-radius:4px;">İndir</a>
            <button class="small secondary doc-delete-btn" data-doc-id="${d.id}" title="Sil">🗑️</button>
          </span>
        </div>`
      )
      .join("");
    listEl.querySelectorAll(".doc-delete-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Bu evrak silinsin mi?")) return;
        await fetch(`/api/documents/${btn.dataset.docId}`, { method: "DELETE" });
        loadDocumentsTab(brand);
      });
    });
  } catch (e) {
    listEl.innerHTML = `<p class="muted">Yüklenirken hata oluştu.</p>`;
  }
}

document.getElementById("uploadDocBtn").addEventListener("click", async () => {
  if (!currentPanelBrand) return;
  const fileEl = document.getElementById("newDocFile");
  const typeEl = document.getElementById("newDocType");
  if (!fileEl.files || fileEl.files.length === 0) return alert("Önce bir dosya seç.");
  const formData = new FormData();
  formData.append("file", fileEl.files[0]);
  formData.append("doc_type", typeEl.value);
  const res = await fetch(`/api/brands/${currentPanelBrand.id}/documents`, { method: "POST", body: formData });
  const data = await res.json();
  if (!res.ok) return alert(data.error || "Yükleme başarısız.");
  fileEl.value = "";
  loadDocumentsTab(currentPanelBrand);
});

// v71: AI OUTREACH INTELLIGENCE kutusu — AI ÇAĞRISI YAPMAZ (GET, ücretsiz),
// AI sekmesi her açıldığında otomatik yüklenir. "Neden bu markaya yazıyoruz"
// zincirini (Primary Problem / Business Opportunity / Neofa Value / Angle /
// CTA) email üretilmeden önce gösterir — madde 14'ün istediği tam olarak budur.
async function loadOutreachIntelBox(brand) {
  const box = document.getElementById("outreachIntelBox");
  if (!brand) return;
  box.innerHTML = `<p class="muted">Yükleniyor...</p>`;
  try {
    const res = await fetch(`/api/brands/${brand.id}/outreach-intelligence`);
    const data = await res.json();
    if (!res.ok || !data.chain) {
      box.innerHTML = `<p class="muted">Outreach Intelligence hesaplanamadı.</p>`;
      return;
    }
    const c = data.chain;
    if (c.doNotContact) {
      box.innerHTML = `<p class="warn" style="margin:0;"><b>🚫 DO NOT CONTACT</b> — ${escapeHtmlIntel(c.doNotContactReason || "")}</p>`;
      return;
    }
    const row = (label, value) =>
      value ? `<div style="padding:3px 0;"><b>${label}:</b> ${escapeHtmlIntel(value)}</div>` : "";
    box.innerHTML = `
      <div style="font-weight:600; margin-bottom:4px;">🧭 AI OUTREACH INTELLIGENCE</div>
      ${row("Primary Problem", c.primaryProblem ? c.primaryProblem.text : "Doğrulanmış spesifik bir sorun yok — ilişki odaklı yaklaşım")}
      ${row("Business Opportunity", c.businessOpportunity ? c.businessOpportunity.text : null)}
      ${row("Neofa Value", c.neofaValue ? c.neofaValue.text : null)}
      ${row("Recommended Angle", c.primaryAngle + (c.secondaryAngle ? ` (ikincil: ${c.secondaryAngle})` : ""))}
      ${row("Recommended CTA", c.cta)}
      ${c.miniAuditEligible ? `<div class="muted" style="padding:3px 0;">💡 Mini audit teklifi için uygun.</div>` : ""}
      ${c.amazonMentionPolicy === "AVOID" ? `<div class="warn" style="padding:3px 0;">⚠️ Amazon'dan bahsetme — marketplace politikası yasaklıyor.</div>` : ""}
      ${c.amazonMentionPolicy === "SOFT" ? `<div class="muted" style="padding:3px 0;">ℹ️ Amazon izni doğrulanamadı — ilk emailde wholesale/online retail çerçevesi kullanılacak.</div>` : ""}
    `;
  } catch (e) {
    box.innerHTML = `<p class="muted">Outreach Intelligence yüklenemedi.</p>`;
  }
}

// AI sekmesi: 3 buton, her biri /api/brands/ai-* uçlarını TEK marka (ids:[id])
// için çağırır. Sonuç kutusunda gösterilir; kullanıcı isterse metni kopyalayıp
// mail şablonuna kendisi ekler (otomatik hiçbir şeye yapıştırılmaz).
async function callAiAction(url, brand, resultRenderer) {
  const box = document.getElementById("aiResultBox");
  box.innerHTML = "Çalışıyor...";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [brand.id] }),
    });
    const data = await res.json();
    if (!res.ok) {
      box.innerHTML = `<p class="warn">${data.error || "Hata oluştu."}</p>`;
      return;
    }
    box.innerHTML = resultRenderer(data.results[0]);
  } catch (e) {
    box.innerHTML = `<p class="warn">İstek sırasında hata oluştu.</p>`;
  }
}

// v71: Buton artık sadece kısa bir "giriş" değil, PROBLEM->OPPORTUNITY->
// NEOFA VALUE->ANGLE zincirinden üretilmiş TAM bir taslak email (subject+body)
// döndürür. Deterministik guardrail sonucu (checklist) da şeffaflık için
// gösteriliyor — madde 13'ün "email quality check" isteğinin UI karşılığı.
document.getElementById("aiPersonalizeBtn").addEventListener("click", () => {
  if (!currentPanelBrand) return;
  callAiAction("/api/brands/ai-personalize", currentPanelBrand, (r) => {
    if (r.error) return `<p class="warn">${escapeHtmlIntel(r.error)}</p>`;
    const meta = r.meta || {};
    const checklist = meta.guardrailChecklist || {};
    const checklistRows = Object.entries(checklist)
      .map(([k, v]) => `<span style="display:inline-block; margin:2px 6px 2px 0; font-size:12px;">${v ? "✅" : "❌"} ${escapeHtmlIntel(k)}</span>`)
      .join("");
    return `
      <p><b>Subject:</b> ${escapeHtmlIntel(r.subject || "")}</p>
      <p style="white-space:pre-wrap; border:1px solid #eee; border-radius:6px; padding:10px; background:#fff;">${escapeHtmlIntel(r.body || r.intro || "")}</p>
      <details style="margin-top:6px;">
        <summary class="category-tree-toggle">Email Quality Check (guardrail sonucu)</summary>
        <div style="margin-top:6px;">${checklistRows || "—"}</div>
        <div class="muted" style="margin-top:6px; font-size:12px;">Angle: ${escapeHtmlIntel(meta.angleUsed || "—")} · Kullanılan bulgu sayısı: ${(meta.findingsUsed || []).length} · Deneme: ${meta.attempt || 1}</div>
      </details>
      <p class="muted" style="font-size:12px; margin-top:6px;">Bu bir TASLAK'tır — göndermeden önce oku ve gerekirse düzenle. Otomatik gönderime karışmaz.</p>
    `;
  });
});

document.getElementById("aiPriorityBtn").addEventListener("click", () => {
  if (!currentPanelBrand) return;
  callAiAction("/api/brands/ai-priority", currentPanelBrand, (r) =>
    r.error
      ? `<p class="warn">${r.error}</p>`
      : `<p><b>Öncelik:</b> ${r.priority} — <b>Etiketler:</b> ${(r.tags || []).join(", ") || "yok"}</p>`
  );
});

document.getElementById("aiClassifyReplyBtn").addEventListener("click", () => {
  if (!currentPanelBrand) return;
  callAiAction("/api/brands/ai-classify-replies", currentPanelBrand, (r) =>
    r.error
      ? `<p class="warn">${r.error}</p>`
      : `<p><b>Kategori:</b> ${r.category}</p><p><b>Taslak yanıt:</b></p><p>${r.draft_reply}</p>`
  );
});

// Wholesale Form sekmesi (v63): opsiyonel Playwright entegrasyonu. Kurulu
// değilse (varsayılan) net bir hata gösterilir, sistemin geri kalanı etkilenmez.
function renderWholesaleTab(brand) {
  const infoEl = document.getElementById("wholesaleInfoText");
  const resultBox = document.getElementById("wholesaleResultBox");
  resultBox.innerHTML = "";
  if (brand.wholesale_page_url) {
    infoEl.innerHTML = `Tespit edilen sayfa: <a href="${brand.wholesale_page_url}" target="_blank" rel="noopener">${brand.wholesale_page_url} ↗</a>`;
  } else {
    infoEl.textContent = "Bu marka için otomatik tespit edilmiş bir wholesale/distributor sayfası yok. Formu doldurmak istersen önce siteyi kontrol et.";
  }
}

document.getElementById("fillWholesaleFormBtn").addEventListener("click", async () => {
  if (!currentPanelBrand) return;
  if (!currentPanelBrand.wholesale_page_url) {
    return alert("Bu marka için bir wholesale sayfası tespit edilmemiş.");
  }
  const resultBox = document.getElementById("wholesaleResultBox");
  resultBox.innerHTML = "Form dolduruluyor (bu biraz zaman alabilir)...";
  try {
    const res = await fetch(`/api/brands/${currentPanelBrand.id}/fill-wholesale-form`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      resultBox.innerHTML = `<p class="warn">${data.error}</p>`;
      return;
    }
    resultBox.innerHTML = `
      <p><b>${data.filledFields.length}</b> alan dolduruldu: ${data.filledFields.map((f) => f.field).join(", ") || "yok"}</p>
      ${data.warning ? `<p class="warn">${data.warning}</p>` : ""}
      <img src="data:image/png;base64,${data.screenshotBase64}" style="max-width:100%; border:1px solid var(--border); border-radius:8px; margin-top:8px;" />
      <p class="muted" style="margin-top:8px;">Bu ekran görüntüsü sadece önizlemedir — formu göndermek için siteyi kendin açıp kontrol ederek göndermelisin.</p>
    `;
  } catch (e) {
    resultBox.innerHTML = `<p class="warn">İstek sırasında hata oluştu.</p>`;
  }
});
