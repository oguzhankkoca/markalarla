const trackingBody = document.getElementById("trackingBody");
const bouncedBody = document.getElementById("bouncedBody");
const docRequestedBody = document.getElementById("docRequestedBody");

const DEAL_STAGE_LABELS = {
  new: "Yeni",
  meeting_scheduled: "Görüşme Planlandı",
  sample_sent: "Numune Gönderildi",
  deal_closed: "Anlaşma Yapıldı",
  rejected: "Reddedildi",
};

function sentimentBadge(sentiment, replied, bounced) {
  if (bounced) return `<span class="badge bounced">Ulaşmadı (Geri Döndü)</span>`;
  if (!replied) return `<span class="badge pending">Bekleniyor</span>`;
  const map = {
    positive: `<span class="badge found">Olumlu</span>`,
    negative: `<span class="badge not_found">Olumsuz</span>`,
    neutral: `<span class="badge pending">Belirsiz (kontrol et)</span>`,
  };
  return map[sentiment] || map.neutral;
}

function dealStageSelect(brandId, current) {
  const options = Object.entries(DEAL_STAGE_LABELS)
    .map(
      ([value, label]) =>
        `<option value="${value}" ${current === value ? "selected" : ""}>${label}</option>`
    )
    .join("");
  return `<select data-id="${brandId}" class="deal-stage-select">${options}</select>`;
}

function sentimentSelect(brandId) {
  return `
    <select data-id="${brandId}" class="sentiment-select">
      <option value="">Elle işaretle...</option>
      <option value="positive">Olumlu</option>
      <option value="negative">Olumsuz</option>
      <option value="neutral">Belirsiz</option>
    </select>`;
}

function renderTracking(brands) {
  trackingBody.innerHTML = "";
  for (const b of brands) {
    const tr = document.createElement("tr");
    const viaText = b.sent_via === "contact_form" ? " (form ile)" : "";
    const sentAtText = b.sent_at
      ? `${new Date(b.sent_at).toLocaleDateString("tr-TR")} (${b.days_since_sent} gün önce)${viaText}`
      : "-";
    const stage = b.follow_up_stage || 0;
    const stageText = stage > 0 ? `${stage}/3 gönderildi` : "Henüz gönderilmedi";

    tr.innerHTML = `
      <td>${b.name}<br><span class="muted">${b.email || ""}</span></td>
      <td>${sentAtText}</td>
      <td>
        ${sentimentBadge(b.reply_sentiment, b.replied, b.bounced)}
        ${b.document_requested ? `<div><span class="badge pending">📎 Belge isteniyor</span></div>` : ""}
        <div>${sentimentSelect(b.id)}</div>
      </td>
      <td class="muted">${stageText}</td>
      <td>${dealStageSelect(b.id, b.deal_stage || "new")}</td>
      <td class="muted">${b.reply_snippet ? b.reply_snippet.slice(0, 120) + "..." : ""}</td>
      <td><button class="small secondary history-btn" data-id="${b.id}" data-name="${b.name}">Geçmiş</button></td>
    `;
    trackingBody.appendChild(tr);
  }

  document.querySelectorAll(".history-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const res = await fetch(`/api/tracking/${btn.dataset.id}/history`);
      const data = await res.json();
      if (!res.ok) return alert(data.error || "Geçmiş alınamadı.");
      if (!data.logs || data.logs.length === 0) {
        return alert(`${btn.dataset.name} için henüz kayıtlı bir gönderim geçmişi yok.`);
      }
      const lines = data.logs.map((l) => {
        const date = new Date(l.created_at).toLocaleString("tr-TR");
        return `${date} — [${l.status}] ${l.message || ""}`;
      });
      alert(`${btn.dataset.name} gönderim geçmişi:\n\n${lines.join("\n")}`);
    });
  });

  document.querySelectorAll(".sentiment-select").forEach((sel) => {
    sel.addEventListener("change", async () => {
      if (!sel.value) return;
      await fetch(`/api/tracking/${sel.dataset.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reply_sentiment: sel.value }),
      });
      loadTracking();
    });
  });

  document.querySelectorAll(".deal-stage-select").forEach((sel) => {
    sel.addEventListener("change", async () => {
      await fetch(`/api/tracking/${sel.dataset.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deal_stage: sel.value }),
      });
    });
  });
}

// "Ulaşmayanlar" kartı: mail geri dönen (bounce) markaları ayrı ve öne çıkan bir
// listede gösterir, her satırda sistemin o marka için yeni bir e-mail aramasını
// tetikleyebileceğin bir buton olur. Bulunursa marka otomatik olarak bu listeden
// kalkar (bounced sıfırlanır) ve Panel sayfasından tekrar gönderilebilir olur.
function renderBouncedTable(bouncedBrands) {
  bouncedBody.innerHTML = "";
  const countEl = document.getElementById("bouncedCount");
  const emptyMsg = document.getElementById("bouncedEmptyMsg");
  const table = document.getElementById("bouncedTable");
  if (countEl) countEl.textContent = bouncedBrands.length;

  if (bouncedBrands.length === 0) {
    if (table) table.style.display = "none";
    if (emptyMsg) emptyMsg.style.display = "block";
    return;
  }
  if (table) table.style.display = "";
  if (emptyMsg) emptyMsg.style.display = "none";

  for (const b of bouncedBrands) {
    const tr = document.createElement("tr");
    const sentAtText = b.sent_at
      ? `${new Date(b.sent_at).toLocaleDateString("tr-TR")} (${b.days_since_sent} gün önce)`
      : "-";
    tr.innerHTML = `
      <td>${b.name}</td>
      <td class="muted">${b.email || ""}</td>
      <td class="muted">${sentAtText}</td>
      <td><button class="small research-btn" data-id="${b.id}" data-name="${b.name}">Tekrar E-mail Ara</button></td>
    `;
    bouncedBody.appendChild(tr);
  }

  document.querySelectorAll(".research-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Aranıyor...";
      try {
        const res = await fetch(`/api/brands/${btn.dataset.id}/find-email`, { method: "POST" });
        const data = await res.json();
        if (!res.ok) {
          alert(data.error || "Aranamadı.");
          return;
        }
        if (data.brand && data.brand.email) {
          alert(`${btn.dataset.name} için yeni e-mail bulundu: ${data.brand.email}\n\nPanel sayfasından bu markaya tekrar gönderim yapabilirsin.`);
        } else {
          alert(`${btn.dataset.name} için yeni bir e-mail bulunamadı. Panel sayfasından elle düzenleyebilirsin.`);
        }
        loadTracking();
      } catch (e) {
        alert("Hata: " + e.message);
        btn.disabled = false;
        btn.textContent = "Tekrar E-mail Ara";
      }
    });
  });
}

// "Belge/Onay İsteyen Markalar" kartı: yanıtında bir belge/evrak talep eden markaları
// ayrı listede öne çıkarır (bu markalar aynı zamanda aşağıdaki "Takip Listesi"nde de
// görünmeye devam eder — burası sadece hızlı erişim için bir vitrin). "Belge Gönderildi"
// butonu document_requested bayrağını sıfırlar, listeden kalkar.
function renderDocRequestedTable(docBrands) {
  docRequestedBody.innerHTML = "";
  const countEl = document.getElementById("docRequestedCount");
  const emptyMsg = document.getElementById("docRequestedEmptyMsg");
  const table = document.getElementById("docRequestedTable");
  if (countEl) countEl.textContent = docBrands.length;

  if (docBrands.length === 0) {
    if (table) table.style.display = "none";
    if (emptyMsg) emptyMsg.style.display = "block";
    return;
  }
  if (table) table.style.display = "";
  if (emptyMsg) emptyMsg.style.display = "none";

  for (const b of docBrands) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${b.name}</td>
      <td class="muted">${b.reply_from || b.email || ""}</td>
      <td class="muted">${(b.document_request_snippet || b.reply_snippet || "").slice(0, 160)}${(b.document_request_snippet || b.reply_snippet || "").length > 160 ? "..." : ""}</td>
      <td><button class="small secondary doc-done-btn" data-id="${b.id}" data-name="${b.name}">Belge Gönderildi, İşaretle</button></td>
    `;
    docRequestedBody.appendChild(tr);
  }

  document.querySelectorAll(".doc-done-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await fetch(`/api/tracking/${btn.dataset.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ document_requested: false }),
        });
        loadTracking();
      } catch (e) {
        alert("Hata: " + e.message);
        btn.disabled = false;
      }
    });
  });
}

async function loadTracking() {
  const res = await fetch("/api/tracking");
  const data = await res.json();
  const all = data.brands || [];
  const bounced = all.filter((b) => b.bounced || b.status === "bounced");
  const rest = all.filter((b) => !(b.bounced || b.status === "bounced"));
  const docRequested = rest.filter((b) => b.document_requested);
  renderBouncedTable(bounced);
  renderDocRequestedTable(docRequested);
  renderTracking(rest);
}

async function loadFollowupTemplate() {
  const res = await fetch("/api/tracking/followup-template");
  const data = await res.json();
  const s = data.settings || {};

  document.getElementById("followupSubject1").value =
    s.followup_subject || "Re: {{marka}} ile iş birliği teklifi";
  document.getElementById("followupBody1").innerHTML =
    s.followup_body ||
    "Merhaba {{marka}} ekibi,<br><br>Geçen hafta ilettiğim iş birliği teklifiyle ilgili görüşünüzü almak isterim. Uygun bir zamanda kısa bir görüşme ayarlayabilir miyiz?<br><br>Saygılarımla";

  document.getElementById("followupSubject2").value =
    s.followup2_subject || "{{marka}} - kısa bir hatırlatma";
  document.getElementById("followupBody2").innerHTML =
    s.followup2_body ||
    "Merhaba {{marka}} ekibi,<br><br>Daha önce gönderdiğim teklifle ilgili bir güncelleme var mı diye kısaca sormak istedim.<br><br>Saygılarımla";

  document.getElementById("followupSubject3").value =
    s.followup3_subject || "{{marka}} - son bir kez yazıyorum";
  document.getElementById("followupBody3").innerHTML =
    s.followup3_body ||
    "Merhaba {{marka}} ekibi,<br><br>Bu konuda son kez yazıyorum; şu an için uygun değilse anlayışla karşılarım.<br><br>Saygılarımla";
}

// bodyInput'lar artık contenteditable "rich text" kutuları — toolbar butonları için.
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

function richTextToPlain(html) {
  const tmp = document.createElement("div");
  tmp.innerHTML = html || "";
  return tmp.textContent || tmp.innerText || "";
}

const SPAM_TRIGGER_WORDS = [
  "free", "ücretsiz", "act now", "hemen ara", "limited time", "sınırlı süre",
  "guarantee", "garanti", "click here", "buraya tıkla", "$$$", "risk free",
  "winner", "kazandınız", "100% free", "no obligation",
];

function checkSpamTriggers(subject, body) {
  const text = `${subject} ${body}`.toLowerCase();
  const found = SPAM_TRIGGER_WORDS.filter((w) => text.includes(w));
  const exclamations = (text.match(/!/g) || []).length;
  if (exclamations >= 3) found.push(`çok fazla ünlem işareti (${exclamations} adet)`);
  return found;
}

document.getElementById("saveFollowupBtn").addEventListener("click", async () => {
  const payload = {
    stage1: {
      subject: document.getElementById("followupSubject1").value,
      body: document.getElementById("followupBody1").innerHTML,
    },
    stage2: {
      subject: document.getElementById("followupSubject2").value,
      body: document.getElementById("followupBody2").innerHTML,
    },
    stage3: {
      subject: document.getElementById("followupSubject3").value,
      body: document.getElementById("followupBody3").innerHTML,
    },
  };

  const allText = [payload.stage1, payload.stage2, payload.stage3]
    .map((s) => `${s.subject} ${richTextToPlain(s.body)}`)
    .join(" ");
  const triggers = checkSpamTriggers("", allText);
  if (triggers.length > 0) {
    const proceed = confirm(
      `Takip şablonlarında spam filtrelerini tetikleyebilecek şu ifadeler var:\n\n- ${triggers.join("\n- ")}\n\nBu mailler otomatik gönderileceği için özellikle dikkat et. Yine de kaydetmek istiyor musun?`
    );
    if (!proceed) return;
  }

  await fetch("/api/tracking/followup-template", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  alert("Takip şablonları kaydedildi.");
});

document.getElementById("checkRepliesBtn").addEventListener("click", async () => {
  const statusEl = document.getElementById("checkStatus");
  statusEl.textContent = "Kontrol ediliyor, biraz sürebilir...";
  try {
    const res = await fetch("/api/tracking/check-replies", { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      statusEl.textContent = "Hata: " + data.error;
      return;
    }
    statusEl.textContent = `Kontrol edildi: ${data.checked} marka, ${data.repliesFound} yanıt bulundu, ${data.bouncesFound || 0} mail geri döndü, ${data.documentsRequested || 0} belge istendi, ${data.followUpsSent} takip maili gönderildi, ${data.notificationsSent} bildirim gönderildi.`;
    loadTracking();
  } catch (e) {
    statusEl.textContent = "Hata: " + e.message;
  }
});

document.getElementById("exportBtn").addEventListener("click", () => {
  window.location.href = "/api/tracking/export";
});

wireRichTextToolbars();
loadFollowupTemplate();
loadTracking();
