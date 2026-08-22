// v77: Manuel Marka Ekle sayfası — Excel/otomatik e-mail arama akışından TAMAMEN
// AYRI, kullanıcının marka adı + e-posta bilgisini doğrudan elle girip ekleyebildiği
// bir sistem. Marka eklenir eklenmez Ayarlar'daki ANA mail şablonu (settings.main_subject
// /main_body — Marka Listesi sayfasındaki AYNI şablon) {{marka}} yerine marka adı
// konularak otomatik dolduruluyor ve düzenlenebilir bir önizleme penceresinde açılıyor.
// Gönderim, backend'de zaten var olan /api/brands/:id/send route'unu kullanır — yani
// suppression/DO_NOT_CONTACT/duplicate-email gibi TÜM güvenlik kontrolleri buraya da
// aynen uygulanır, ayrı bir "manuel gönderim" mantığı icat edilmedi.

let manualBrands = [];
let manualMainSubjectTemplate = "";
let manualMainBodyTemplate = "";
let manualPreviewBrandId = null;

const manualBody = document.getElementById("manualBody");
const manualCountEl = document.getElementById("manualCount");
const manualEmptyState = document.getElementById("manualEmptyState");

const manualPreviewOverlay = document.getElementById("manualPreviewOverlay");
const manualPreviewTitle = document.getElementById("manualPreviewTitle");
const manualPreviewTo = document.getElementById("manualPreviewTo");
const manualPreviewSubject = document.getElementById("manualPreviewSubject");
const manualPreviewBody = document.getElementById("manualPreviewBody");

function fillTemplate(text, brandName) {
  return (text || "").replace(/{{\s*marka\s*}}/gi, brandName);
}

// Gönderim öncesi "boş mu" kontrolü için — gerçek gönderim (mailer.js) zaten
// HTML'i kendi dönüştürüyor, burada sadece kullanıcı hiçbir şey yazmadan
// göndermeye çalışmasın diye basit bir düz-metin kontrolü yeterli.
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

function wireRichTextToolbars() {
  document.querySelectorAll(".rte-toolbar").forEach((toolbar) => {
    const editor = document.getElementById(toolbar.dataset.target);
    if (!editor) return;
    toolbar.querySelectorAll(".rte-btn").forEach((btn) => {
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        editor.focus();
        document.execCommand(btn.dataset.cmd, false, null);
      });
    });
  });
}

async function loadMainTemplate() {
  const res = await fetch("/api/settings");
  const data = await res.json();
  const s = data.settings || {};
  // Marka Listesi sayfasındaki (index.html/app.js) AYNI varsayılan şablon —
  // kullanıcı orada bir ana şablon ayarladıysa manuel eklenen markalar da
  // otomatik olarak o şablonu kullanır, tutarlılık için ayrı bir şablon
  // tutulmuyor.
  manualMainSubjectTemplate = s.main_subject || `{{marka}} ile iş birliği teklifi`;
  manualMainBodyTemplate =
    s.main_body ||
    `Sayın {{marka}} Yetkilisi,<br><br>${s.company || "Şirketimiz"} olarak Amazon üzerinde ${s.offer_text || "iş birliği"} konusunda sizinle görüşmek isteriz.<br><br>${s.signature || ""}`;
}

async function loadManualBrands() {
  const res = await fetch("/api/brands/manual");
  const data = await res.json();
  manualBrands = data.brands || [];
  renderManualBrands();
}

function statusLabel(b) {
  if (b.status === "sent") return `<span class="badge sent">✓ Gönderildi</span>`;
  if (b.status === "bounced") return `<span class="badge bounced">📪 Geri Döndü</span>`;
  return `<span class="badge pending">Taslak — henüz gönderilmedi</span>`;
}

function renderManualBrands() {
  manualBody.innerHTML = "";
  manualCountEl.textContent = manualBrands.length;
  manualEmptyState.style.display = manualBrands.length === 0 ? "" : "none";

  manualBrands.forEach((b) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(b.name)}</td>
      <td>${escapeHtml(b.email || "")}</td>
      <td>${b.website ? `<a href="${/^https?:\/\//i.test(b.website) ? b.website : "https://" + b.website}" target="_blank" rel="noopener">${escapeHtml(b.website)}</a>` : "-"}</td>
      <td class="muted">${escapeHtml(b.notes || "")}</td>
      <td>${statusLabel(b)}</td>
      <td class="actions-cell">
        <button class="small manual-send-btn" data-id="${b.id}" ${b.suppressed || b.action_badge === "DO_NOT_CONTACT" ? "disabled" : ""} title="${b.action_badge === "DO_NOT_CONTACT" ? "DO NOT CONTACT — gönderim engellendi" : "Mail gönder"}">${b.status === "sent" ? "Tekrar Gönder" : "Gönder"}</button>
        <button class="small secondary manual-delete-btn" data-id="${b.id}" data-name="${escapeHtml(b.name)}">🗑 Sil</button>
      </td>
    `;
    manualBody.appendChild(tr);
  });

  attachManualRowEvents();
}

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function attachManualRowEvents() {
  document.querySelectorAll(".manual-send-btn").forEach((btn) => {
    btn.addEventListener("click", () => openManualPreview(btn.dataset.id));
  });

  document.querySelectorAll(".manual-delete-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(`"${btn.dataset.name}" markasını kalıcı olarak silmek istediğine emin misin? Bu işlem geri alınamaz.`)) return;
      const res = await fetch(`/api/brands/${btn.dataset.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) return alert(data.error || "Silinemedi.");
      manualBrands = manualBrands.filter((b) => String(b.id) !== String(btn.dataset.id));
      renderManualBrands();
    });
  });
}

function openManualPreview(id) {
  const brand = manualBrands.find((b) => String(b.id) === String(id));
  if (!brand || !brand.email) return alert("Bu markanın e-mail adresi yok.");
  manualPreviewBrandId = id;
  manualPreviewTitle.textContent = `${brand.name} için mail önizleme`;
  manualPreviewTo.value = brand.email;
  manualPreviewSubject.value = fillTemplate(manualMainSubjectTemplate, brand.name);
  manualPreviewBody.innerHTML = fillTemplate(manualMainBodyTemplate, brand.name);
  manualPreviewOverlay.style.display = "flex";
}

function closeManualPreview() {
  manualPreviewOverlay.style.display = "none";
  manualPreviewBrandId = null;
}

async function sendManualBrand(id, subject, body) {
  const brand = manualBrands.find((b) => String(b.id) === String(id));
  if (!brand) return;
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
  const idx = manualBrands.findIndex((b) => String(b.id) === String(id));
  if (idx !== -1) manualBrands[idx].status = "sent";
  renderManualBrands();
}

document.getElementById("manualAddBtn").addEventListener("click", async () => {
  const errBox = document.getElementById("manualAddError");
  errBox.style.display = "none";

  const name = document.getElementById("manualNameInput").value.trim();
  const email = document.getElementById("manualEmailInput").value.trim();
  const website = document.getElementById("manualWebsiteInput").value.trim();
  const notes = document.getElementById("manualNotesInput").value.trim();

  const btn = document.getElementById("manualAddBtn");
  btn.disabled = true;
  try {
    const res = await fetch("/api/brands/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, website, notes }),
    });
    const data = await res.json();
    if (!res.ok) {
      errBox.textContent = data.error || "Eklenemedi.";
      errBox.style.display = "";
      return;
    }
    manualBrands.unshift(data.brand);
    renderManualBrands();

    // Alanları temizle, bir sonraki markayı eklemeye hazır olsun.
    document.getElementById("manualNameInput").value = "";
    document.getElementById("manualEmailInput").value = "";
    document.getElementById("manualWebsiteInput").value = "";
    document.getElementById("manualNotesInput").value = "";

    if (data.suppressedWarning) {
      alert(
        `Marka eklendi ama dikkat: ${email} adresi kalıcı "bir daha yazma" listesinde — bu markaya gönderim yapılamayacak.`
      );
    }

    // İstenen davranış: marka adı+e-posta girilir girilmez otomatik mail
    // şablonu oluşup gönderime hazır şekilde açılsın — kullanıcı isterse
    // düzenleyip hemen gönderir, isterse "İptal" deyip tablodan sonra gönderir.
    openManualPreview(data.brand.id);
  } catch (e) {
    errBox.textContent = "Hata: " + e.message;
    errBox.style.display = "";
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("manualPreviewSendBtn").addEventListener("click", async () => {
  if (!manualPreviewBrandId) return;
  await sendManualBrand(manualPreviewBrandId, manualPreviewSubject.value, manualPreviewBody.innerHTML);
  closeManualPreview();
});

document.getElementById("manualPreviewCancelBtn").addEventListener("click", closeManualPreview);

manualPreviewOverlay.addEventListener("click", (e) => {
  if (e.target === manualPreviewOverlay) closeManualPreview();
});

wireRichTextToolbars();
loadMainTemplate();
loadManualBrands();
