const trackingBody = document.getElementById("trackingBody");

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
    const sentAtText = b.sent_at
      ? `${new Date(b.sent_at).toLocaleDateString("tr-TR")} (${b.days_since_sent} gün önce)`
      : "-";
    const stage = b.follow_up_stage || 0;
    const stageText = stage > 0 ? `${stage}. aşama gönderildi` : "Henüz gönderilmedi";

    tr.innerHTML = `
      <td>${b.name}<br><span class="muted">${b.email || ""}</span></td>
      <td>${sentAtText}</td>
      <td>
        ${sentimentBadge(b.reply_sentiment, b.replied, b.bounced)}
        <div>${sentimentSelect(b.id)}</div>
      </td>
      <td class="muted">${stageText}</td>
      <td>${dealStageSelect(b.id, b.deal_stage || "new")}</td>
      <td class="muted">${b.reply_snippet ? b.reply_snippet.slice(0, 120) + "..." : ""}</td>
    `;
    trackingBody.appendChild(tr);
  }

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

async function loadTracking() {
  const res = await fetch("/api/tracking");
  const data = await res.json();
  renderTracking(data.brands || []);
}

async function loadFollowupTemplate() {
  const res = await fetch("/api/tracking/followup-template");
  const data = await res.json();
  const s = data.settings || {};

  document.getElementById("followupSubject1").value =
    s.followup_subject || "Re: {{marka}} ile iş birliği teklifi";
  document.getElementById("followupBody1").value =
    s.followup_body ||
    "Merhaba {{marka}} ekibi,\n\nGeçen hafta ilettiğim iş birliği teklifiyle ilgili görüşünüzü almak isterim. Uygun bir zamanda kısa bir görüşme ayarlayabilir miyiz?\n\nSaygılarımla";

  document.getElementById("followupSubject2").value =
    s.followup2_subject || "{{marka}} - kısa bir hatırlatma";
  document.getElementById("followupBody2").value =
    s.followup2_body ||
    "Merhaba {{marka}} ekibi,\n\nDaha önce gönderdiğim teklifle ilgili bir güncelleme var mı diye kısaca sormak istedim.\n\nSaygılarımla";

  document.getElementById("followupSubject3").value =
    s.followup3_subject || "{{marka}} - son bir kez yazıyorum";
  document.getElementById("followupBody3").value =
    s.followup3_body ||
    "Merhaba {{marka}} ekibi,\n\nBu konuda son kez yazıyorum; şu an için uygun değilse anlayışla karşılarım.\n\nSaygılarımla";
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
      body: document.getElementById("followupBody1").value,
    },
    stage2: {
      subject: document.getElementById("followupSubject2").value,
      body: document.getElementById("followupBody2").value,
    },
    stage3: {
      subject: document.getElementById("followupSubject3").value,
      body: document.getElementById("followupBody3").value,
    },
  };

  const allText = [payload.stage1, payload.stage2, payload.stage3]
    .map((s) => `${s.subject} ${s.body}`)
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
    statusEl.textContent = `Kontrol edildi: ${data.checked} marka, ${data.repliesFound} yanıt bulundu, ${data.followUpsSent} takip maili gönderildi, ${data.notificationsSent} bildirim gönderildi.`;
    loadTracking();
  } catch (e) {
    statusEl.textContent = "Hata: " + e.message;
  }
});

document.getElementById("exportBtn").addEventListener("click", () => {
  window.location.href = "/api/tracking/export";
});

loadFollowupTemplate();
loadTracking();
