function statCard(number, label) {
  return `<div class="stat-card"><div class="stat-number">${number}</div><div class="stat-label">${label}</div></div>`;
}

const DEAL_STAGE_LABELS = {
  new: "Yeni",
  meeting_scheduled: "Görüşme Planlandı",
  sample_sent: "Numune Gönderildi",
  deal_closed: "Anlaşma Yapıldı",
  rejected: "Reddedildi",
};

async function loadAnalytics() {
  const res = await fetch("/api/analytics");
  const data = await res.json();

  document.getElementById("mainStats").innerHTML = [
    statCard(data.totalBrands, "Toplam Marka"),
    statCard(data.foundEmails, "E-mail Bulunan"),
    statCard(data.notFound, "Bulunamayan"),
    statCard(data.duplicateBlocked, "Tekrar (Engellenen)"),
    statCard(data.sent, "Gönderilen"),
    statCard(data.bounced, "Geri Dönen (Bounce)"),
    statCard(data.replied, "Yanıt Gelen"),
    statCard(data.positive, "Olumlu"),
    statCard(data.negative, "Olumsuz"),
  ].join("");

  document.getElementById("rateStats").innerHTML = [
    statCard(data.rates.emailFoundRate + "%", "E-mail Bulma Oranı"),
    statCard(data.rates.replyRate + "%", "Yanıt Oranı"),
    statCard(data.rates.positiveRate + "%", "Olumlu Yanıt Oranı"),
    statCard(data.rates.dealClosedRate + "%", "Anlaşma Kapanma Oranı"),
  ].join("");

  document.getElementById("dealStats").innerHTML = Object.entries(data.dealStageCounts)
    .map(([key, count]) => statCard(count, DEAL_STAGE_LABELS[key] || key))
    .join("");
}

loadAnalytics();
