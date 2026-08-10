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

// v68: Brand Intelligence + Growth Audit — madde 29 basit sayaçlar. emailsSent/
// replies/positiveReplies zaten brands tablosundan anlık hesaplanıyor;
// wholesaleApplications/approvedBrands/firstOrders ise Marka Detay panelindeki
// "Amazon Authorization Tracking" alanlarından elle işaretlendiğinde birikiyor
// (bkz. routes/brandIntelligence.js). Karmaşık bir tahmin/ML sistemi YOK.
async function loadGrowthMetrics() {
  try {
    const res = await fetch("/api/growth-metrics");
    const data = await res.json();
    if (!data.ok) return;
    const m = data.metrics;
    document.getElementById("growthMetricsStats").innerHTML = [
      statCard(m.emailsSent, "Gönderilen Mail"),
      statCard(m.replies, "Yanıt"),
      statCard(m.positiveReplies, "Olumlu Yanıt"),
      statCard(m.wholesaleApplications, "Wholesale Başvurusu"),
      statCard(m.approvedBrands, "Onaylanan Marka"),
      statCard(m.firstOrders, "İlk Sipariş"),
      statCard("$" + Math.round(m.firstPoTotalValue).toLocaleString("en-US"), "İlk PO Toplam Değeri"),
    ].join("");
  } catch (e) {
    // sessizce yut — dashboard'un geri kalanını etkilemesin
  }
}

// v47: "Bugün Yapılacaklar" akıllı paneli — /api/dashboard/today'nin döndürdüğü
// dağınık öğeleri (görevler, yanıt bekleyenler, belge istekleri, yüksek öncelikli
// markalar, otomatik gönderim durumu) tek bir listede birleştirip gösterir.
function todayItemRow(icon, text, href) {
  const inner = `<span class="today-item-icon">${icon}</span><span>${text}</span>`;
  return href
    ? `<a href="${href}" class="today-item-row">${inner}</a>`
    : `<div class="today-item-row">${inner}</div>`;
}

async function loadTodayPanel() {
  const el = document.getElementById("todayPanel");
  try {
    const res = await fetch("/api/dashboard/today");
    const data = await res.json();
    const sections = [];

    if (data.tasksDue.length > 0) {
      sections.push(
        `<div class="today-section-title">📌 Görevler (${data.tasksDue.length})</div>` +
          data.tasksDue
            .slice(0, 8)
            .map((t) =>
              todayItemRow(
                t.due_date && t.due_date < data.date ? "⏰" : "📅",
                `<b>${t.brand_name}</b> — ${t.title}${t.due_date ? ` (${t.due_date})` : ""}`,
                "/index.html"
              )
            )
            .join("")
      );
    }

    if (data.pendingReplies.length > 0) {
      sections.push(
        `<div class="today-section-title">💬 Değerlendirilmemiş Yanıtlar (${data.pendingReplies.length})</div>` +
          data.pendingReplies
            .slice(0, 8)
            .map((b) =>
              todayItemRow(
                b.reply_sentiment === "positive" ? "🟢" : "🟡",
                `<b>${b.name}</b>${b.reply_snippet ? " — " + b.reply_snippet.slice(0, 80) : ""}`,
                "/tracking.html"
              )
            )
            .join("")
      );
    }

    if (data.documentRequests.length > 0) {
      sections.push(
        `<div class="today-section-title">📄 Belge İsteyenler (${data.documentRequests.length})</div>` +
          data.documentRequests
            .slice(0, 8)
            .map((b) => todayItemRow("📎", `<b>${b.name}</b>`, "/tracking.html"))
            .join("")
      );
    }

    if (data.highPriorityUnsent.length > 0) {
      sections.push(
        `<div class="today-section-title">🔥 Yüksek Öncelikli, Henüz Gönderilmemiş (${data.highPriorityUnsent.length})</div>` +
          data.highPriorityUnsent
            .slice(0, 8)
            .map((b) => todayItemRow("🔥", `<b>${b.name}</b> — Opportunity Score: ${Math.round(b.opportunity_score || 0)}`, "/index.html"))
            .join("")
      );
    }

    if (data.fuzzyDuplicateGroupCount > 0) {
      sections.push(
        todayItemRow(
          "🔁",
          `${data.fuzzyDuplicateGroupCount} olası tekrar (duplicate) grubu incelemeni bekliyor.`,
          "/index.html"
        )
      );
    }

    if (data.autoSend.circuitBreakerActive) {
      sections.push(todayItemRow("🛑", "Bounce oranı güvenlik freni AKTİF — otomatik gönderim durduruldu, incele.", "/index.html"));
    } else if (data.autoSend.enabled) {
      sections.push(
        todayItemRow(
          "📤",
          `Otomatik gönderim: bugün ${data.autoSend.sentToday}/${data.autoSend.limit} mail gönderildi.`
        )
      );
    }

    el.innerHTML =
      sections.length > 0
        ? sections.join("")
        : `<div class="today-empty">🎉 Şu an bekleyen bir işlem yok — her şey güncel!</div>`;
  } catch (e) {
    el.textContent = "Yüklenirken hata oluştu.";
  }
}

// v60: Gelişmiş analiz paneli (grafikler). Chart.js CDN'den yüklenir; herhangi
// bir sebeple (offline, ağ engeli) yüklenemezse grafikler sessizce atlanır —
// sayfanın geri kalanı (istatistik kutuları, bugün paneli) etkilenmez.
function fillDayGaps(rows, days) {
  const map = new Map(rows.map((r) => [r.day, r.c]));
  const out = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push({ day: key, c: map.get(key) || 0 });
  }
  return out;
}

async function loadTimeseriesChart() {
  if (typeof Chart === "undefined") return;
  try {
    const res = await fetch("/api/analytics/timeseries?days=30");
    const data = await res.json();
    const sent = fillDayGaps(data.sent, data.days);
    const replied = fillDayGaps(data.replied, data.days);
    const positive = fillDayGaps(data.positive, data.days);
    const ctx = document.getElementById("timeseriesChart");
    if (!ctx) return;
    new Chart(ctx, {
      type: "line",
      data: {
        labels: sent.map((r) => r.day.slice(5)),
        datasets: [
          { label: "Gönderilen", data: sent.map((r) => r.c), borderColor: "#3d6bff", tension: 0.3 },
          { label: "Yanıt", data: replied.map((r) => r.c), borderColor: "#f2a300", tension: 0.3 },
          { label: "Olumlu", data: positive.map((r) => r.c), borderColor: "#1a7d3f", tension: 0.3 },
        ],
      },
      options: { responsive: true, plugins: { legend: { position: "bottom" } } },
    });
  } catch (e) {
    // grafik yüklenemezse sessizce geç
  }
}

async function loadPipelineFunnelChart() {
  if (typeof Chart === "undefined") return;
  try {
    const res = await fetch("/api/crm/stages");
    const data = await res.json();
    const ctx = document.getElementById("pipelineFunnelChart");
    if (!ctx) return;
    new Chart(ctx, {
      type: "bar",
      data: {
        labels: data.stages.map((s) => s.label),
        datasets: [{ label: "Marka sayısı", data: data.stages.map((s) => s.count), backgroundColor: "#3d6bff" }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        plugins: { legend: { display: false } },
      },
    });
  } catch (e) {
    // grafik yüklenemezse sessizce geç
  }
}

async function loadAbTestChart() {
  if (typeof Chart === "undefined") return;
  try {
    const res = await fetch("/api/analytics/ab-test");
    const data = await res.json();
    if (!data.variants || data.variants.length === 0) return;
    document.getElementById("abTestCard").style.display = "block";
    const ctx = document.getElementById("abTestChart");
    if (!ctx) return;
    new Chart(ctx, {
      type: "bar",
      data: {
        labels: data.variants.map((v) => (v.variant.length > 40 ? v.variant.slice(0, 40) + "…" : v.variant)),
        datasets: [
          { label: "Gönderilen", data: data.variants.map((v) => v.sentCount), backgroundColor: "#3d6bff" },
          { label: "Yanıt", data: data.variants.map((v) => v.repliedCount), backgroundColor: "#f2a300" },
          { label: "Olumlu", data: data.variants.map((v) => v.positiveCount), backgroundColor: "#1a7d3f" },
        ],
      },
      options: { responsive: true, plugins: { legend: { position: "bottom" } } },
    });
  } catch (e) {
    // grafik yüklenemezse sessizce geç
  }
}

// v61: Amazon analiz modülü — portföy genelinde ciro/rekabet/kategori özeti.
function formatMoney(n) {
  return "$" + Math.round(n || 0).toLocaleString("en-US");
}

async function loadAmazonInsights() {
  try {
    const res = await fetch("/api/analytics/amazon-insights");
    const data = await res.json();
    const c = data.competitionBuckets || {};
    document.getElementById("amazonStats").innerHTML = [
      statCard(data.brandsWithRevenueData + "/" + data.totalBrands, "Ciro Verisi Olan Marka"),
      statCard(formatMoney(data.avgMonthlyRevenue), "Ort. Tahmini Aylık Ciro"),
      statCard("$" + data.avgPrice, "Ort. Fiyat"),
      statCard(data.avgReviews, "Ort. Yorum Sayısı"),
      statCard(data.avgRating, "Ort. Puan"),
      statCard(data.storefrontCoverage + "%", "Mağaza Linki Olan"),
      statCard(c.low || 0, "Düşük Rekabet (≤3 satıcı)"),
      statCard(c.medium || 0, "Orta Rekabet (4-10 satıcı)"),
      statCard(c.high || 0, "Yüksek Rekabet (10+ satıcı)"),
    ].join("");

    const tbody = document.querySelector("#amazonCategoryTable tbody");
    tbody.innerHTML = data.topCategories
      .map((cat) => `<tr><td>${cat.category}</td><td>${cat.brandCount}</td><td>${formatMoney(cat.totalRevenue)}</td></tr>`)
      .join("");
  } catch (e) {
    // veri yüklenemezse kart boş kalır, sayfanın geri kalanı etkilenmez
  }
}

loadAnalytics();
loadGrowthMetrics();
loadTodayPanel();
loadTimeseriesChart();
loadPipelineFunnelChart();
loadAbTestChart();
loadAmazonInsights();
