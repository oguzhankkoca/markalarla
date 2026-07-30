let batch = null;
let brands = [];
let previewBrandId = null;
const selectedIds = new Set();

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

function renderBrands() {
  brandsBody.innerHTML = "";
  for (const b of brands) {
    const tr = document.createElement("tr");
    const contactLine =
      !b.email && b.contact_page_url
        ? `<div class="muted" style="margin-top:4px;">📩 <a href="${b.contact_page_url}" target="_blank" rel="noopener">İletişim formu bulundu ↗</a></div>`
        : "";
    const checked = selectedIds.has(String(b.id)) ? "checked" : "";
    const sentViaTag = b.status === "sent" && b.sent_via === "contact_form" ? " (form ile)" : "";
    tr.innerHTML = `
      <td><input type="checkbox" class="row-checkbox" data-id="${b.id}" ${checked} /></td>
      <td>${b.name}</td>
      <td class="muted">${marketSummary(b)}</td>
      <td><input data-field="website" data-id="${b.id}" value="${b.website || ""}" /></td>
      <td>
        <input data-field="email" data-id="${b.id}" value="${b.email || ""}" />
        ${contactLine}
      </td>
      <td>${badge(b.status)}${sentViaTag}</td>
      <td>
        <button class="small find-btn" data-id="${b.id}">Ara</button>
        <button class="small send-btn" data-id="${b.id}" ${!b.email || b.status === "duplicate_blocked" ? "disabled" : ""}>Gönder</button>
        ${
          !b.email && b.contact_page_url
            ? `<button class="small secondary contact-btn" data-id="${b.id}">Form Aç</button>
               <button class="small secondary mark-sent-btn" data-id="${b.id}" ${b.status === "sent" ? "disabled" : ""}>Gönderildi İşaretle</button>`
            : ""
        }
        ${hasMarketData(b) ? `<button class="small secondary market-btn" data-id="${b.id}">Piyasa Verisi</button>` : ""}
        <button class="small secondary detail-btn" data-id="${b.id}">Detay</button>
      </td>
    `;
    brandsBody.appendChild(tr);
  }
  attachRowEvents();
}

function attachRowEvents() {
  document.querySelectorAll(".row-checkbox").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) selectedIds.add(cb.dataset.id);
      else selectedIds.delete(cb.dataset.id);
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
        body: JSON.stringify({ email: brand.email, website: brand.website }),
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
      const body = fillTemplate(bodyInput.value, brand.name);
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
  if (!subjectInput.value || !bodyInput.value) return alert("Önce 4. adımdaki mail şablonunu doldur.");

  previewBrandId = id;
  previewTitle.textContent = `${brand.name} için mail önizleme`;
  previewTo.value = brand.email;
  previewSubject.value = fillTemplate(subjectInput.value, brand.name);
  previewBody.value = fillTemplate(bodyInput.value, brand.name);
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
  const body = overrideBody !== undefined ? overrideBody : fillTemplate(bodyInput.value, brand.name);
  if (!subject || !body) return alert("Önce mail şablonunu doldur.");

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

  if (data.emailConfigured) {
    emailStatusEl.innerHTML = `<span class="ok">Gönderim hesabı: ${data.emailAddress}</span>`;
  } else {
    emailStatusEl.innerHTML = `<span class="warn">E-mail hesabı ayarlanmamış (.env dosyasına bak)</span>`;
  }

  // Mail şablonu artık sunucuda (settings tablosunda) tutuluyor — böylece otomatik
  // günlük gönderim (server tarafındaki cron) da aynı şablona erişebiliyor. Eskiden
  // sadece tarayıcıda (localStorage) tutuluyordu, cron bunu göremiyordu.
  subjectInput.value = s.main_subject || `{{marka}} ile iş birliği teklifi`;
  bodyInput.value =
    s.main_body ||
    `Sayın {{marka}} Yetkilisi,\n\n${s.company || "Şirketimiz"} olarak Amazon üzerinde ${s.offer_text || "iş birliği"} konusunda sizinle görüşmek isteriz.\n\n${s.signature || ""}`;

  document.getElementById("dailyLimitInput").value = s.daily_send_limit || 0;
}

async function loadBrands() {
  const res = await fetch("/api/brands");
  const data = await res.json();
  brands = data.brands || [];
  batch = data.batch;
  renderBrands();
}

document.getElementById("saveSettingsBtn").addEventListener("click", async () => {
  const payload = {
    name: document.getElementById("settingsName").value,
    company: document.getElementById("settingsCompany").value,
    offer_text: document.getElementById("settingsOffer").value,
    signature: document.getElementById("settingsSignature").value,
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
  let msg = `${data.count} marka yüklendi.`;
  if (data.duplicateBlockedCount) msg += ` ${data.duplicateBlockedCount} tanesi daha önce gönderilmiş/olumsuzdu, otomatik işlemlerden hariç tutuldu.`;
  if (data.reusedEmailCount) msg += ` ${data.reusedEmailCount} tanesi için önceden bulunan e-mail kullanıldı.`;
  if (data.enrichmentFieldsFound && data.enrichmentFieldsFound.length > 0) {
    msg += ` Ek marka verisi algılandı (${data.enrichmentFieldsFound.length} sütun) — satırlardaki "Piyasa Verisi" butonundan görebilirsin.`;
  }
  document.getElementById("uploadStatus").textContent = msg;
  brands = data.brands;
  batch = data.batch;
  renderBrands();
});

// Toplu email arama artık durdurulup kaldığı yerden devam ettirilebiliyor. Sunucu
// tarafında bir kuyruk tutuluyor; burada sadece o kuyruğun durumunu 3 saniyede bir
// kontrol edip ekrandaki butonları/metni güncelliyoruz.
let findAllPollInterval = null;

function updateFindAllButtons(status) {
  document.getElementById("findAllBtn").disabled = status.running;
  document.getElementById("stopFindAllBtn").disabled = !status.running;
  document.getElementById("resumeFindAllBtn").disabled = status.running || status.remaining === 0;
}

async function pollFindAllStatus() {
  await loadBrands();
  const res = await fetch("/api/brands/find-all/status");
  const status = await res.json();
  updateFindAllButtons(status);
  if (!status.running) {
    clearInterval(findAllPollInterval);
    findAllPollInterval = null;
    document.getElementById("findStatus").textContent =
      status.remaining > 0
        ? `Duraklatıldı. ${status.remaining} marka kaldı — "Devam Et" ile devam edebilirsin.`
        : "Tamamlandı.";
  } else {
    document.getElementById("findStatus").textContent = `Aranıyor... (${status.remaining} marka kaldı)`;
  }
}

function startFindAllPolling() {
  if (findAllPollInterval) clearInterval(findAllPollInterval);
  findAllPollInterval = setInterval(pollFindAllStatus, 3000);
}

document.getElementById("findAllBtn").addEventListener("click", async () => {
  if (!batch) return alert("Önce bir liste yükle.");
  const res = await fetch("/api/brands/find-all", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ batch }),
  });
  const data = await res.json();
  if (!res.ok) return alert(data.error || "Başlatılamadı.");
  document.getElementById("findStatus").textContent = "Arama başladı, arka planda çalışıyor...";
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
];

function checkSpamTriggers(subject, body) {
  const text = `${subject} ${body}`.toLowerCase();
  const found = SPAM_TRIGGER_WORDS.filter((w) => text.includes(w));
  const exclamations = (text.match(/!/g) || []).length;
  if (exclamations >= 3) found.push(`çok fazla ünlem işareti (${exclamations} adet)`);
  const capsWords = (subject.match(/\b[A-ZÇĞİÖŞÜ]{4,}\b/g) || []).length;
  if (capsWords >= 1) found.push("konu satırında tamamı büyük harf kelime");
  return found;
}

document.getElementById("saveTemplateBtn").addEventListener("click", async () => {
  const triggers = checkSpamTriggers(subjectInput.value, bodyInput.value);
  if (triggers.length > 0) {
    const proceed = confirm(
      `Şablonda spam filtrelerini tetikleyebilecek şu ifadeler var:\n\n- ${triggers.join("\n- ")}\n\nYine de kaydetmek istiyor musun?`
    );
    if (!proceed) return;
  }
  await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ main_subject: subjectInput.value, main_body: bodyInput.value }),
  });
  alert("Şablon kaydedildi.");
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

async function sendBatch(targets) {
  if (targets.length === 0) return alert("Gönderilecek e-mail yok.");
  if (!confirm(`${targets.length} markaya mail gönderilecek. Onaylıyor musun?`)) return;
  document.getElementById("sendStatus").textContent = `0/${targets.length}`;
  let done = 0;
  for (const b of targets) {
    await sendToBrand(b.id);
    done++;
    document.getElementById("sendStatus").textContent = `${done}/${targets.length}`;
    await new Promise((r) => setTimeout(r, 1500));
  }
  document.getElementById("sendStatus").textContent = "Tamamlandı.";
}

document.getElementById("sendAllBtn").addEventListener("click", () => {
  const targets = brands.filter(
    (b) => b.email && !["sent", "duplicate_blocked", "bounced"].includes(b.status)
  );
  sendBatch(targets);
});

// Sadece işaretlediğin (checkbox) markalara gönderir — 400 marka gibi büyük bir
// listenin tamamını tek seferde göndermek yerine, istediğin kadarını seçip
// göndermek için.
document.getElementById("sendSelectedBtn").addEventListener("click", () => {
  const targets = brands.filter(
    (b) =>
      selectedIds.has(String(b.id)) &&
      b.email &&
      !["sent", "duplicate_blocked", "bounced"].includes(b.status)
  );
  if (targets.length === 0) return alert("Önce tablodan en az bir marka seç (checkbox).");
  sendBatch(targets);
});

selectAllCheckbox.addEventListener("change", () => {
  if (selectAllCheckbox.checked) {
    brands.forEach((b) => selectedIds.add(String(b.id)));
  } else {
    selectedIds.clear();
  }
  renderBrands();
});

document.getElementById("previewSendBtn").addEventListener("click", async () => {
  if (!previewBrandId) return;
  await sendToBrand(previewBrandId, previewSubject.value, previewBody.value);
  closePreview();
});

document.getElementById("previewCancelBtn").addEventListener("click", closePreview);

previewOverlay.addEventListener("click", (e) => {
  if (e.target === previewOverlay) closePreview();
});

loadSettings();
loadBrands();

// Sayfa yenilenirse (arama devam ederken ya da duraklatılmışken), butonların ve
// durumun doğru görünmesi için mevcut arama durumunu kontrol et.
(async () => {
  try {
    const res = await fetch("/api/brands/find-all/status");
    const status = await res.json();
    updateFindAllButtons(status);
    if (status.running) {
      document.getElementById("findStatus").textContent = `Aranıyor... (${status.remaining} marka kaldı)`;
      startFindAllPolling();
    } else if (status.remaining > 0) {
      document.getElementById("findStatus").textContent = `Duraklatıldı. ${status.remaining} marka kaldı — "Devam Et" ile devam edebilirsin.`;
    }
  } catch (e) {
    // sessizce geç, kritik değil
  }
})();
