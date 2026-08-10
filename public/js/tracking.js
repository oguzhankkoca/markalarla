const trackingBody = document.getElementById("trackingBody");
const bouncedBody = document.getElementById("bouncedBody");
const docRequestedBody = document.getElementById("docRequestedBody");

function escapeHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const DEAL_STAGE_LABELS = {
  new: "Yeni",
  meeting_scheduled: "Görüşme Planlandı",
  sample_sent: "Numune Gönderildi",
  deal_closed: "Anlaşma Yapıldı",
  rejected: "Reddedildi",
};

// Panel sayfasındaki ana mail şablonu — "Ulaşmayanlar" listesinde yeni bir
// e-mail bulunduğunda, Panel sayfasına gitmeden direkt buradan gönderebilmek
// için sayfa açılışında bir kez yükleyip burada tutuyoruz.
let mainTemplate = null;

// Takip Listesi'ndeki filtre sekmesi durumu + son yüklenen (bounce olmayan) liste.
let currentTrackingFilter = "all";
let lastRestList = [];

function fillTemplateTracking(text, brandName) {
  return (text || "").replace(/{{\s*marka\s*}}/gi, brandName);
}

async function loadMainTemplate() {
  try {
    const res = await fetch("/api/settings");
    const data = await res.json();
    const s = data.settings || {};
    mainTemplate = { subject: s.main_subject || "", body: s.main_body || "" };
  } catch (e) {
    mainTemplate = null;
  }
}

// "Ulaşmayanlar" listesinde yeni bir e-mail bulunduktan sonra, Panel sayfasına
// gitmeye gerek kalmadan buradan direkt gönderim yapmak için.
async function sendBrandNow(id, name, buttonEl) {
  if (!mainTemplate || !mainTemplate.subject || !richTextToPlain(mainTemplate.body).trim()) {
    alert(
      "Önce Panel sayfasındaki '4️⃣ Mail şablonu' bölümünü doldurup kaydet — sonra buradan tek tıkla gönderebilirsin."
    );
    return;
  }
  if (buttonEl) {
    buttonEl.disabled = true;
    buttonEl.textContent = "Gönderiliyor...";
  }
  try {
    const subject = fillTemplateTracking(mainTemplate.subject, name);
    const body = fillTemplateTracking(mainTemplate.body, name);
    const res = await fetch(`/api/brands/${id}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject, body }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert("Gönderim hatası: " + data.error);
      if (buttonEl) {
        buttonEl.disabled = false;
        buttonEl.textContent = "Şimdi Gönder";
      }
      return;
    }
    alert(`${name} markasına mail gönderildi.`);
    loadTracking();
  } catch (e) {
    alert("Hata: " + e.message);
    if (buttonEl) {
      buttonEl.disabled = false;
      buttonEl.textContent = "Şimdi Gönder";
    }
  }
}

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

// Takip Listesi filtre sekmeleri: bir markanın hangi kategoriye girdiğini belirler.
function matchesTrackingFilter(b, filter) {
  switch (filter) {
    case "all":
      return true;
    case "waiting":
      return !b.replied;
    case "positive":
      return b.reply_sentiment === "positive";
    case "negative":
      return b.reply_sentiment === "negative";
    case "neutral":
      return Boolean(b.replied) && (!b.reply_sentiment || b.reply_sentiment === "neutral");
    case "document":
      return Boolean(b.document_requested);
    default:
      return true;
  }
}

function renderTrackingFilterTabs(list) {
  const counts = {
    all: list.length,
    waiting: list.filter((b) => !b.replied).length,
    positive: list.filter((b) => b.reply_sentiment === "positive").length,
    negative: list.filter((b) => b.reply_sentiment === "negative").length,
    neutral: list.filter((b) => b.replied && (!b.reply_sentiment || b.reply_sentiment === "neutral")).length,
    document: list.filter((b) => b.document_requested).length,
  };
  const idMap = {
    all: "trackCountAll",
    waiting: "trackCountWaiting",
    positive: "trackCountPositive",
    negative: "trackCountNegative",
    neutral: "trackCountNeutral",
    document: "trackCountDocument",
  };
  Object.entries(counts).forEach(([key, val]) => {
    const el = document.getElementById(idMap[key]);
    if (el) el.textContent = val;
  });
}

// lastRestList'i mevcut filtreye göre süzüp tabloyu ve sekme sayaçlarını günceller.
function applyTrackingFilter() {
  renderTrackingFilterTabs(lastRestList);
  const filtered = lastRestList.filter((b) => matchesTrackingFilter(b, currentTrackingFilter));
  renderTracking(filtered);
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

    // Manuel "Follow-up Gönder" butonu: sadece gerçekten uygunsa gösterilir —
    // otomatik akışın (runFullCheck) kullandığı AYNI kurallar: ilk mail gönderilmiş
    // olmalı, bounce olmamalı, olumlu/nötr yanıt gelmemiş olmalı (olumsuz yanıtta
    // otomatik sistem de follow-up'a devam ediyor), 3 aşama tamamlanmamış olmalı,
    // ve DO_NOT_CONTACT olmamalı.
    const dncBadge = b.action_badge === "DO_NOT_CONTACT";
    const canFollowUp =
      b.status === "sent" &&
      !b.bounced &&
      !dncBadge &&
      stage < 3 &&
      (!b.replied || b.reply_sentiment === "negative");
    let followUpBtnHtml;
    if (dncBadge) {
      followUpBtnHtml = `<button class="small secondary" disabled title="DO_NOT_CONTACT — Brand Intelligence bu markaya satış/marketplace outreach'ini yasaklıyor.">🚫 Follow-up Engelli</button>`;
    } else if (stage >= 3) {
      followUpBtnHtml = `<span class="muted" style="display:block;margin-top:4px;">3 aşama tamamlandı</span>`;
    } else if (canFollowUp) {
      followUpBtnHtml = `<button class="small followup-btn" data-id="${b.id}" data-name="${escapeHtml(b.name)}" data-next-stage="${stage + 1}">✉️ ${stage + 1}. Aşama Follow-up Gönder</button>`;
    } else {
      followUpBtnHtml = "";
    }

    // Bug fix (görünürlük): bu marka aynı e-posta/domain'i başka bir markayla
    // paylaşıyor olabileceği için gelen bir yanıt burada belirsiz kaldıysa,
    // otomatik not "notes" alanına "[Otomatik uyarı]" ile eklenir (bkz.
    // tracking.js route'undaki sharedEmail işleme bloğu). Kullanıcı hangi markadan
    // geldiğini tam olarak anlayamadığını bildirdiği için bunu tabloda AÇIKÇA
    // gösteriyoruz — artık sessizce notlara gömülü kalmıyor.
    const sharedWarning =
      b.notes && b.notes.includes("[Otomatik uyarı]")
        ? `<div class="badge pending" title="${escapeHtml(b.notes)}" style="margin-top:4px;">⚠️ Paylaşılan e-posta/domain — belirsiz eşleşme, kontrol et</div>`
        : "";
    const replyFromText = b.reply_from ? `<div class="muted" style="margin-top:2px;">Gönderen: ${escapeHtml(b.reply_from)}</div>` : "";

    tr.innerHTML = `
      <td>${b.name}<br><span class="muted">${b.email || ""}</span></td>
      <td>${sentAtText}</td>
      <td>
        ${sentimentBadge(b.reply_sentiment, b.replied, b.bounced)}
        ${b.document_requested ? `<div><span class="badge pending">📎 Belge isteniyor</span></div>` : ""}
        ${sharedWarning}
        <div>${sentimentSelect(b.id)}</div>
      </td>
      <td class="muted">${stageText}<br>${followUpBtnHtml}</td>
      <td>${dealStageSelect(b.id, b.deal_stage || "new")}</td>
      <td class="muted">${replyFromText}${b.reply_snippet ? b.reply_snippet.slice(0, 120) + "..." : ""}</td>
      <td class="actions-cell">
        <button class="small secondary history-btn" data-id="${b.id}" data-name="${b.name}">Geçmiş</button>
        ${b.document_requested ? `<button class="small doc-done-btn-row" data-id="${b.id}" data-name="${b.name}">Belge Gönderildi</button>` : ""}
      </td>
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

  document.querySelectorAll(".followup-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const stage = btn.dataset.nextStage;
      const stageLabel = stage === "1" ? "7 günlük kısa hatırlatma" : stage === "2" ? "15 günlük değer odaklı takip" : "30 günlük son/kapanış maili";
      if (!confirm(`${btn.dataset.name} markasına ${stage}. aşama follow-up (${stageLabel}) gönderilsin mi?`)) return;
      btn.disabled = true;
      btn.textContent = "Gönderiliyor...";
      try {
        const res = await fetch(`/api/tracking/${btn.dataset.id}/send-followup`, { method: "POST" });
        const data = await res.json();
        if (!res.ok) {
          alert("Follow-up gönderilemedi: " + (data.error || "Bilinmeyen hata"));
          btn.disabled = false;
          btn.textContent = `✉️ ${stage}. Aşama Follow-up Gönder`;
          return;
        }
        alert(`${btn.dataset.name} markasına ${data.stage}. aşama follow-up gönderildi.\n\nKonu: ${data.subject}`);
        loadTracking();
      } catch (e) {
        alert("Hata: " + e.message);
        btn.disabled = false;
        btn.textContent = `✉️ ${stage}. Aşama Follow-up Gönder`;
      }
    });
  });

  document.querySelectorAll(".doc-done-btn-row").forEach((btn) => {
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
// tetikleyebileceğin bir buton olur. Bulunursa (bounced sıfırlanır) satır içinde
// hemen bir "Şimdi Gönder" seçeneği açılır — Panel sayfasına gitmeye gerek kalmaz.
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
      <td class="muted" style="max-width:280px;">${(b.last_error || "").slice(0, 300)}</td>
      <td class="bounce-actions"><button class="small research-btn" data-id="${b.id}" data-name="${b.name}">Tekrar E-mail Ara</button></td>
    `;
    bouncedBody.appendChild(tr);
  }

  document.querySelectorAll(".research-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const row = btn.closest("tr");
      const actionsCell = row ? row.querySelector(".bounce-actions") : null;
      btn.disabled = true;
      btn.textContent = "Aranıyor...";
      try {
        const res = await fetch(`/api/brands/${btn.dataset.id}/find-email`, { method: "POST" });
        const data = await res.json();
        if (!res.ok) {
          alert(data.error || "Aranamadı.");
          btn.disabled = false;
          btn.textContent = "Tekrar E-mail Ara";
          return;
        }
        if (data.brand && data.brand.email && actionsCell) {
          // Yeni e-mail bulundu — sayfadan ayrılmadan direkt gönderme seçeneği sun.
          actionsCell.innerHTML = `
            <div class="muted" style="margin-bottom:4px;">Yeni e-mail: <b>${data.brand.email}</b></div>
            <button class="small send-now-btn" data-id="${btn.dataset.id}" data-name="${btn.dataset.name}">Şimdi Gönder</button>
            <button class="small secondary dismiss-btn">Kapat</button>
          `;
          actionsCell.querySelector(".send-now-btn").addEventListener("click", (e) => {
            sendBrandNow(btn.dataset.id, btn.dataset.name, e.target);
          });
          actionsCell.querySelector(".dismiss-btn").addEventListener("click", () => loadTracking());
        } else {
          alert(`${btn.dataset.name} için yeni bir e-mail bulunamadı. Panel sayfasından elle düzenleyebilirsin.`);
          loadTracking();
        }
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
      <td><button class="small secondary doc-done-btn-card" data-id="${b.id}" data-name="${b.name}">Belge Gönderildi, İşaretle</button></td>
    `;
    docRequestedBody.appendChild(tr);
  }

  document.querySelectorAll(".doc-done-btn-card").forEach((btn) => {
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
  lastRestList = rest;
  applyTrackingFilter();
}

document.querySelectorAll(".track-filter-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    currentTrackingFilter = btn.dataset.filter;
    document.querySelectorAll(".track-filter-tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    applyTrackingFilter();
  });
});

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

// Bug fix: app.js'teki AYNI fonksiyonla senkron — eskiden textContent/innerText
// kullanılıyordu, bu da <p>/<div>/<br>/<li> gibi blok etiketleri arasına satır
// sonu eklemediği için paragrafların birbirine girmesine (ör. İletişim Formu'na
// kopyalanan mail metninin karışık görünmesine) neden oluyordu. Artık gerçek
// mail gönderiminde kullanılan AYNI etiket-bazlı dönüşüm (mailer.js ->
// htmlToPlainText) burada da kullanılıyor.
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

const SPAM_TRIGGER_WORDS = [
  "free", "ücretsiz", "act now", "hemen ara", "limited time", "sınırlı süre",
  "guarantee", "garanti", "click here", "buraya tıkla", "$$$", "risk free",
  "winner", "kazandınız", "100% free", "no obligation", "congratulations",
  "tebrikler", "cash bonus", "nakit bonus", "urgent", "acil", "money back",
  "para iade",
];

const URL_SHORTENERS = ["bit.ly", "tinyurl.com", "goo.gl", "t.co", "ow.ly", "is.gd", "buff.ly"];

function checkSpamTriggers(subject, body) {
  const text = `${subject} ${body}`.toLowerCase();
  const found = SPAM_TRIGGER_WORDS.filter((w) => text.includes(w));
  const exclamations = (text.match(/!/g) || []).length;
  if (exclamations >= 3) found.push(`çok fazla ünlem işareti (${exclamations} adet)`);
  const linkCount = (text.match(/https?:\/\//g) || []).length;
  if (linkCount >= 4) found.push(`çok fazla link (${linkCount} adet) — soğuk mailde 1-2 link idealdir`);
  const shortenerHit = URL_SHORTENERS.find((s) => text.includes(s));
  if (shortenerHit) found.push(`link kısaltıcı kullanılmış (${shortenerHit}) — spam filtreleri bunlara şüpheyle bakar`);
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

function renderCheckErrors(errors) {
  const box = document.getElementById("checkErrorsBox");
  if (!box) return;
  if (!errors || errors.length === 0) {
    box.style.display = "none";
    box.textContent = "";
    return;
  }
  box.style.display = "block";
  box.textContent = `⚠️ Kontrol sırasında ${errors.length} hata oluştu (bunlar "0 bulundu" sonucunun asıl sebebi olabilir):\n\n` + errors.map((e) => `• ${e}`).join("\n");
}

document.getElementById("checkRepliesBtn").addEventListener("click", async () => {
  const statusEl = document.getElementById("checkStatus");
  statusEl.textContent = "Kontrol ediliyor, biraz sürebilir...";
  renderCheckErrors(null);
  try {
    const res = await fetch("/api/tracking/check-replies", { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      statusEl.textContent = "Hata: " + data.error;
      return;
    }
    statusEl.textContent = `Kontrol edildi: ${data.checked} marka, ${data.repliesFound} yanıt bulundu, ${data.bouncesFound || 0} mail geri döndü, ${data.documentsRequested || 0} belge istendi, ${data.followUpsSent} takip maili gönderildi, ${data.notificationsSent} bildirim gönderildi.`;
    renderCheckErrors(data.errors);
    loadTracking();
  } catch (e) {
    statusEl.textContent = "Hata: " + e.message;
  }
});

document.getElementById("imapTestBtn").addEventListener("click", async () => {
  const statusEl = document.getElementById("checkStatus");
  statusEl.textContent = "IMAP bağlantısı test ediliyor...";
  renderCheckErrors(null);
  try {
    const res = await fetch("/api/tracking/imap-test");
    const data = await res.json();
    if (!res.ok || !data.ok) {
      statusEl.textContent = "IMAP bağlantı hatası.";
      renderCheckErrors([data.error || "Bilinmeyen hata."]);
      return;
    }
    statusEl.textContent = `✅ IMAP bağlantısı başarılı — ${data.user} hesabında gelen kutusunda ${data.totalMessages} mesaj, ${data.unseen} okunmamış. Bağlantı çalışıyorsa ama "Yanıtları Kontrol Et" hâlâ 0 buluyorsa, sorun muhtemelen arama kriterleriyle ilgilidir (bu durumda bana haber ver).`;
  } catch (e) {
    statusEl.textContent = "IMAP test hatası.";
    renderCheckErrors([e.message]);
  }
});

document.getElementById("exportBtn").addEventListener("click", () => {
  window.location.href = "/api/tracking/export";
});

document.getElementById("weeklySummaryBtn").addEventListener("click", async () => {
  const statusEl = document.getElementById("checkStatus");
  statusEl.textContent = "Haftalık özet gönderiliyor...";
  try {
    const res = await fetch("/api/tracking/weekly-summary/send-now", { method: "POST" });
    const data = await res.json();
    if (data.sent) {
      statusEl.textContent = `✅ Haftalık özet gönderildi (${data.sentThisWeek} mail, ${data.repliedThisWeek} yanıt, ${data.positiveThisWeek} olumlu).`;
    } else if (data.reason === "already_sent_this_week") {
      statusEl.textContent = "Bu hafta zaten bir özet gönderilmiş — spam gibi tekrar tekrar gitmesin diye engellendi.";
    } else {
      statusEl.textContent = "Haftalık özet gönderilemedi: " + (data.error || data.reason || "bilinmeyen hata");
    }
  } catch (e) {
    statusEl.textContent = "Haftalık özet gönderilemedi: " + e.message;
  }
});

wireRichTextToolbars();
loadFollowupTemplate();
loadMainTemplate();
loadTracking();
