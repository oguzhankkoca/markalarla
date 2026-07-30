let batch = null;
let brands = [];

const emailStatusEl = document.getElementById("emailStatus");
const brandsBody = document.getElementById("brandsBody");
const subjectInput = document.getElementById("subjectInput");
const bodyInput = document.getElementById("bodyInput");

function badge(status) {
  const map = {
    pending: "Bekliyor",
    found: "Bulundu",
    not_found: "Bulunamadı",
    sent: "Gönderildi",
    error: "Hata",
  };
  return `<span class="badge ${status}">${map[status] || status}</span>`;
}

function renderBrands() {
  brandsBody.innerHTML = "";
  for (const b of brands) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${b.name}</td>
      <td><input data-field="website" data-id="${b.id}" value="${b.website || ""}" /></td>
      <td><input data-field="email" data-id="${b.id}" value="${b.email || ""}" /></td>
      <td>${badge(b.status)}</td>
      <td>
        <button class="small find-btn" data-id="${b.id}">Ara</button>
        <button class="small send-btn" data-id="${b.id}" ${!b.email ? "disabled" : ""}>Gönder</button>
      </td>
    `;
    brandsBody.appendChild(tr);
  }
  attachRowEvents();
}

function attachRowEvents() {
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
    btn.addEventListener("click", () => sendToBrand(btn.dataset.id));
  });
}

function fillTemplate(text, brandName) {
  return (text || "").replace(/{{\s*marka\s*}}/gi, brandName);
}

async function sendToBrand(id) {
  const brand = brands.find((b) => String(b.id) === String(id));
  if (!brand || !brand.email) return alert("Bu markanın e-mail adresi yok.");
  const subject = fillTemplate(subjectInput.value, brand.name);
  const body = fillTemplate(bodyInput.value, brand.name);
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

  const savedSubject = localStorage.getItem("template_subject");
  const savedBody = localStorage.getItem("template_body");
  subjectInput.value = savedSubject || `{{marka}} ile iş birliği teklifi`;
  bodyInput.value =
    savedBody ||
    `Merhaba {{marka}} ekibi,\n\n${s.company || "Şirketimiz"} olarak Amazon üzerinde ${s.offer_text || "iş birliği"} konusunda sizinle görüşmek isteriz.\n\n${s.signature || ""}`;
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
  document.getElementById("uploadStatus").textContent = `${data.count} marka yüklendi.`;
  brands = data.brands;
  batch = data.batch;
  renderBrands();
});

document.getElementById("findAllBtn").addEventListener("click", async () => {
  if (!batch) return alert("Önce bir liste yükle.");
  document.getElementById("findStatus").textContent = "Arama başladı, arka planda çalışıyor...";
  await fetch("/api/brands/find-all", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ batch }),
  });
  let tries = 0;
  const interval = setInterval(async () => {
    await loadBrands();
    tries++;
    const stillPending = brands.some((b) => b.status === "pending");
    if (!stillPending || tries > 60) {
      clearInterval(interval);
      document.getElementById("findStatus").textContent = "Tamamlandı.";
    }
  }, 3000);
});

document.getElementById("saveTemplateBtn").addEventListener("click", () => {
  localStorage.setItem("template_subject", subjectInput.value);
  localStorage.setItem("template_body", bodyInput.value);
  alert("Şablon kaydedildi.");
});

document.getElementById("sendAllBtn").addEventListener("click", async () => {
  const targets = brands.filter((b) => b.email && b.status !== "sent");
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
});

loadSettings();
loadBrands();
