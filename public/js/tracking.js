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

// v75: Toplu follow-up gönderimi için seçili marka id'leri (string olarak tutulur,
// dataset.id her zaman string döner). Sadece follow-up'a UYGUN (bkz.
// isFollowUpEligible) markalar seçilebilir — bounce/DNC/tamamlanmış/olumlu-yanıt
// verenler zaten checkbox'ı disabled geliyor, seçime hiç girmiyor.
let selectedFollowupIds = new Set();
let followupBatchPollTimer = null;

// v76: Takip Listesi sayfalandırması — her sayfada 20 marka, numaralı sayfa
// butonları (1,2,3,4...). Filtre sekmesi değiştiğinde 1. sayfaya dönülür (bkz.
// filtre tıklama handler'ı, aşağıda); toplu follow-up/checkbox gibi işlemler
// sayfayı DEĞİŞTİRMEZ (kullanıcı hangi sayfadaysa orada kalır).
const TRACKING_PAGE_SIZE = 20;
let trackingCurrentPage = 1;

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
// v75: Bir markanın follow-up gönderimi için GERÇEKTEN uygun olup olmadığını
// belirler — backend'deki sendFollowUpForBrand() ile AYNI kurallar (DO_NOT_CONTACT,
// suppression client-side bilinmiyor ama diğerleri biliniyor, kesin kontrol zaten
// backend'de tekrar yapılıyor). En kritik ayrım (kullanıcı talebi): ilk mail
// bounce olduysa (b.bounced) bu marka KESİNLİKLE uygun değildir — "ilk mail
// ulaşmadıysa ikincisi nasıl ulaşsın" mantığı.
function isFollowUpEligibleBase(b) {
  return b.status === "sent" && !b.bounced && b.action_badge !== "DO_NOT_CONTACT" && (!b.replied || b.reply_sentiment === "negative");
}

function isFollowUpEligible(b) {
  const stage = b.follow_up_stage || 0;
  return isFollowUpEligibleBase(b) && stage < 3;
}

// v76: "Sırada bekleyen" 3 kategori — otomatik cron'un (runFullCheck,
// src/routes/tracking.js FOLLOW_UP_SCHEDULE) kullandığı AYNI eşikler: 7/14/30
// gün, AYNI alana göre hesaplanıyor (sent_at'tan bugüne — b.days_since_sent,
// backend zaten hesaplayıp gönderiyor). Kullanıcının açıkça istediği kural:
// "ilk follow-up atılmayanlar 2./3. kategoriye GEÇEMEZ" — bu yüzden her kategori
// SADECE tam olarak o aşamadaki (follow_up_stage === beklenen önceki aşama)
// markaları gösterir, bir öncekini atlayan/erken giren hiçbir marka görünmez.
function isDueStage(b, stage, afterDays) {
  const currentStage = b.follow_up_stage || 0;
  return isFollowUpEligibleBase(b) && currentStage === stage - 1 && b.days_since_sent != null && b.days_since_sent >= afterDays;
}
const isDueStage1 = (b) => isDueStage(b, 1, 7);
const isDueStage2 = (b) => isDueStage(b, 2, 14);
const isDueStage3 = (b) => isDueStage(b, 3, 30);

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
    case "followup_eligible":
      return isFollowUpEligible(b);
    case "due_stage1":
      return isDueStage1(b);
    case "due_stage2":
      return isDueStage2(b);
    case "due_stage3":
      return isDueStage3(b);
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
    followup_eligible: list.filter(isFollowUpEligible).length,
    due_stage1: list.filter(isDueStage1).length,
    due_stage2: list.filter(isDueStage2).length,
    due_stage3: list.filter(isDueStage3).length,
  };
  const idMap = {
    all: "trackCountAll",
    waiting: "trackCountWaiting",
    positive: "trackCountPositive",
    negative: "trackCountNegative",
    neutral: "trackCountNeutral",
    document: "trackCountDocument",
    followup_eligible: "trackCountFollowupEligible",
    due_stage1: "trackCountDueStage1",
    due_stage2: "trackCountDueStage2",
    due_stage3: "trackCountDueStage3",
  };
  Object.entries(counts).forEach(([key, val]) => {
    const el = document.getElementById(idMap[key]);
    if (el) el.textContent = val;
  });
}

// lastRestList'i mevcut filtreye göre süzüp tabloyu ve sekme sayaçlarını günceller.
// NOT: burada trackingCurrentPage SIFIRLANMAZ — filtre sekmesine tıklandığında
// zaten ayrıca 1. sayfaya dönülüyor (bkz. .track-filter-tab click handler);
// checkbox/not/aşama gibi küçük güncellemeler sonrası çağrıldığında kullanıcı
// hangi sayfadaysa orada kalsın diye.
function applyTrackingFilter() {
  renderTrackingFilterTabs(lastRestList);
  const filtered = lastRestList.filter((b) => matchesTrackingFilter(b, currentTrackingFilter));
  renderTracking(filtered);
}

function renderTracking(brands) {
  // v76: Sayfalandırma — filtrelenmiş listenin tamamı yerine sadece o sayfaya
  // ait 20 marka render edilir; sayfa numarası listenin boyutuna göre sınırlanır
  // (örn. filtre değişip liste kısalınca eski sayfa numarasında kalınmasın).
  const totalPages = Math.max(1, Math.ceil(brands.length / TRACKING_PAGE_SIZE));
  if (trackingCurrentPage > totalPages) trackingCurrentPage = totalPages;
  if (trackingCurrentPage < 1) trackingCurrentPage = 1;
  const pageStart = (trackingCurrentPage - 1) * TRACKING_PAGE_SIZE;
  const pageItems = brands.slice(pageStart, pageStart + TRACKING_PAGE_SIZE);

  trackingBody.innerHTML = "";
  for (const b of pageItems) {
    const tr = document.createElement("tr");
    const viaText = b.sent_via === "contact_form" ? " (form ile)" : "";
    const sentAtText = b.sent_at
      ? `${new Date(b.sent_at).toLocaleDateString("tr-TR")} (${b.days_since_sent} gün önce)${viaText}`
      : "-";
    const stage = b.follow_up_stage || 0;
    const stageText = stage > 0 ? `${stage}/3 gönderildi` : "Henüz gönderilmedi";

    // Manuel "Follow-up Gönder" butonu: sadece gerçekten uygunsa gösterilir —
    // otomatik akışın (runFullCheck) kullandığı AYNI kurallar (bkz. isFollowUpEligible,
    // yukarıda) — özellikle: ilk mail bounce olduysa (b.bounced) BU MARKA follow-up'a
    // KESİNLİKLE uygun değildir, çünkü ilk mail zaten ulaşmadı.
    const dncBadge = b.action_badge === "DO_NOT_CONTACT";
    const canFollowUp = isFollowUpEligible(b);
    let followUpBtnHtml;
    if (dncBadge) {
      followUpBtnHtml = `<button class="small secondary" disabled title="DO_NOT_CONTACT — Brand Intelligence bu markaya satış/marketplace outreach'ini yasaklıyor.">🚫 Follow-up Engelli</button>`;
    } else if (b.bounced) {
      followUpBtnHtml = `<span class="muted" title="İlk mail geri döndü (bounce) — bu adrese ulaşılamadı, follow-up gönderilmez.">📪 İlk mail ulaşmadı</span>`;
    } else if (stage >= 3) {
      followUpBtnHtml = `<span class="muted" style="display:block;margin-top:4px;">3 aşama tamamlandı</span>`;
    } else if (canFollowUp) {
      followUpBtnHtml = `<button class="small followup-btn" data-id="${b.id}" data-name="${escapeHtml(b.name)}" data-next-stage="${stage + 1}">✉️ ${stage + 1}. Aşama Follow-up Gönder</button>`;
    } else {
      followUpBtnHtml = "";
    }
    const checkboxHtml = canFollowUp
      ? `<input type="checkbox" class="followup-row-checkbox" data-id="${b.id}" ${selectedFollowupIds.has(String(b.id)) ? "checked" : ""} />`
      : `<input type="checkbox" disabled title="Follow-up'a uygun değil" />`;

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
      <td>${checkboxHtml}</td>
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

  document.querySelectorAll(".followup-row-checkbox").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) selectedFollowupIds.add(cb.dataset.id);
      else selectedFollowupIds.delete(cb.dataset.id);
      updateFollowupSelectionUI();
    });
  });
  updateFollowupSelectionUI();

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

  renderTrackingPaginationBar(brands.length, totalPages);
}

// v76: Numaralı sayfa butonları (Önceki, 1, 2, 3, 4... Sonraki). Çok sayfa
// varsa (>7) aradaki numaraları "..." ile kısaltır, ilk/son sayfa ve aktif
// sayfanın etrafındaki 1'er sayfayı her zaman gösterir.
function renderTrackingPaginationBar(totalItems, totalPages) {
  const bar = document.getElementById("trackingPaginationBar");
  if (!bar) return;
  if (totalItems === 0 || totalPages <= 1) {
    bar.innerHTML = "";
    return;
  }

  function pageBtn(label, page, opts = {}) {
    const active = opts.active ? " active" : "";
    const disabled = opts.disabled ? "disabled" : "";
    return `<button class="page-btn${active}" data-page="${page}" ${disabled}>${label}</button>`;
  }

  const cur = trackingCurrentPage;
  const pages = [];
  pages.push(pageBtn("‹ Önceki", cur - 1, { disabled: cur <= 1 }));

  const numbers = [];
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || Math.abs(p - cur) <= 1) numbers.push(p);
  }
  let lastShown = 0;
  numbers.forEach((p) => {
    if (lastShown && p - lastShown > 1) pages.push(`<span class="page-ellipsis">...</span>`);
    pages.push(pageBtn(String(p), p, { active: p === cur }));
    lastShown = p;
  });

  pages.push(pageBtn("Sonraki ›", cur + 1, { disabled: cur >= totalPages }));

  bar.innerHTML = `<div class="pagination-info muted">${totalItems} marka — Sayfa ${cur}/${totalPages}</div><div class="pagination-buttons">${pages.join("")}</div>`;

  bar.querySelectorAll(".page-btn:not([disabled])").forEach((btn) => {
    btn.addEventListener("click", () => {
      trackingCurrentPage = parseInt(btn.dataset.page, 10);
      applyTrackingFilter();
    });
  });
}

// v75: Seçili sayısını + "Seçilenlere Follow-up Gönder" butonunun durumunu +
// başlıktaki "tümünü seç" kutucuğunun tri-state (hepsi/bazısı/hiçbiri) görünümünü
// günceller. Her renderTracking() çağrısından sonra çalışır (filtre değişince de).
function updateFollowupSelectionUI() {
  const countEl = document.getElementById("followupSelectedCount");
  const sendBtn = document.getElementById("sendFollowupBatchBtn");
  const headerCb = document.getElementById("trackHeaderCheckbox");
  if (countEl) countEl.textContent = `${selectedFollowupIds.size} marka seçili`;
  if (sendBtn) sendBtn.disabled = selectedFollowupIds.size === 0;
  if (headerCb) {
    const visibleEligible = Array.from(document.querySelectorAll(".followup-row-checkbox"));
    if (visibleEligible.length === 0) {
      headerCb.checked = false;
      headerCb.indeterminate = false;
    } else {
      const allChecked = visibleEligible.every((cb) => cb.checked);
      const someChecked = visibleEligible.some((cb) => cb.checked);
      headerCb.checked = allChecked;
      headerCb.indeterminate = someChecked && !allChecked;
    }
  }
}

const trackHeaderCheckboxEl = document.getElementById("trackHeaderCheckbox");
if (trackHeaderCheckboxEl) {
  trackHeaderCheckboxEl.addEventListener("change", () => {
    // Sadece o an TABLODA GÖRÜNEN (mevcut filtreye uyan), follow-up'a uygun
    // markaları seçer/kaldırır — görünmeyen (başka filtredeki) seçimlere dokunmaz.
    document.querySelectorAll(".followup-row-checkbox").forEach((cb) => {
      cb.checked = trackHeaderCheckboxEl.checked;
      if (trackHeaderCheckboxEl.checked) selectedFollowupIds.add(cb.dataset.id);
      else selectedFollowupIds.delete(cb.dataset.id);
    });
    updateFollowupSelectionUI();
  });
}

async function pollFollowupBatchStatus() {
  const sendBtn = document.getElementById("sendFollowupBatchBtn");
  const stopBtn = document.getElementById("stopFollowupBatchBtn");
  try {
    const res = await fetch("/api/tracking/send-followup-batch/status");
    const data = await res.json();
    if (!data.running) {
      clearInterval(followupBatchPollTimer);
      followupBatchPollTimer = null;
      if (stopBtn) stopBtn.style.display = "none";
      if (sendBtn) {
        sendBtn.disabled = selectedFollowupIds.size === 0;
        sendBtn.textContent = "✉️ Seçilenlere Follow-up Gönder";
      }
      if (data.total > 0) {
        const skippedText =
          data.skipped && data.skipped.length > 0
            ? `\n\nAtlanan/engellenen ${data.skipped.length} marka:\n` +
              data.skipped.map((s) => `- ${s.name}: ${s.reason}`).join("\n")
            : "";
        alert(`Toplu follow-up tamamlandı: ${data.sentCount} gönderildi, ${data.failedCount} atlandı/başarısız.${skippedText}`);
      }
      selectedFollowupIds.clear();
      loadTracking();
    }
  } catch (e) {
    // sessizce geç, jobStatusToast.js zaten genel ilerleme kartını gösteriyor
  }
}

const sendFollowupBatchBtnEl = document.getElementById("sendFollowupBatchBtn");
if (sendFollowupBatchBtnEl) {
  sendFollowupBatchBtnEl.addEventListener("click", async () => {
    const ids = Array.from(selectedFollowupIds);
    if (ids.length === 0) return;
    if (!confirm(`${ids.length} markaya sırada bekleyen bir sonraki follow-up aşaması gönderilsin mi? Gönderimler arasında (spam görünmemesi için) birkaç saniye ara olacak.`)) {
      return;
    }
    sendFollowupBatchBtnEl.disabled = true;
    sendFollowupBatchBtnEl.textContent = "Gönderiliyor...";
    const stopBtn = document.getElementById("stopFollowupBatchBtn");
    if (stopBtn) stopBtn.style.display = "";
    try {
      const res = await fetch("/api/tracking/send-followup-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert("Toplu follow-up başlatılamadı: " + (data.error || "Bilinmeyen hata"));
        sendFollowupBatchBtnEl.disabled = false;
        sendFollowupBatchBtnEl.textContent = "✉️ Seçilenlere Follow-up Gönder";
        if (stopBtn) stopBtn.style.display = "none";
        return;
      }
      if (!followupBatchPollTimer) {
        followupBatchPollTimer = setInterval(pollFollowupBatchStatus, 3000);
      }
    } catch (e) {
      alert("Hata: " + e.message);
      sendFollowupBatchBtnEl.disabled = false;
      sendFollowupBatchBtnEl.textContent = "✉️ Seçilenlere Follow-up Gönder";
      if (stopBtn) stopBtn.style.display = "none";
    }
  });
}

const stopFollowupBatchBtnEl = document.getElementById("stopFollowupBatchBtn");
if (stopFollowupBatchBtnEl) {
  stopFollowupBatchBtnEl.addEventListener("click", async () => {
    await fetch("/api/tracking/send-followup-batch/stop", { method: "POST" });
    stopFollowupBatchBtnEl.textContent = "Durduruluyor...";
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
    trackingCurrentPage = 1; // v76: filtre değişince sayfalandırma 1'e döner
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
