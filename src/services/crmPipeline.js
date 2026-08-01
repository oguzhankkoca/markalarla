// Kullanıcının kendi ayarlarından yeniden adlandırıp sıralayabildiği CRM
// pipeline (satış hunisi) aşamaları. Varsayılan 10 aşama, kullanıcının istediği
// sırayla: Yeni Aday → E-mail Bulundu → Mail Gönderildi → Takip Ediliyor →
// Olumlu Yanıt → Evrak İstendi → Başvuru Yapıldı → Onaylandı → İlk Sipariş →
// Tekrar Sipariş. Ayarlardan (settings.crm_pipeline_stages, JSON) kullanıcı bu
// listeyi ekleyip çıkarabilir, yeniden adlandırabilir ve sırasını değiştirebilir
// — "key" alanı stabil kalmalı (brands.crm_stage bu key'e referans verir), ama
// "label" (görünen isim) serbestçe değiştirilebilir.
const DEFAULT_PIPELINE_STAGES = [
  { key: "new_lead", label: "Yeni Aday" },
  { key: "email_found", label: "E-mail Bulundu" },
  { key: "email_sent", label: "Mail Gönderildi" },
  { key: "follow_up", label: "Takip Ediliyor" },
  { key: "positive_reply", label: "Olumlu Yanıt" },
  { key: "documents_requested", label: "Evrak İstendi" },
  { key: "application_submitted", label: "Başvuru Yapıldı" },
  { key: "approved", label: "Onaylandı" },
  { key: "first_order", label: "İlk Sipariş" },
  { key: "repeat_orders", label: "Tekrar Sipariş" },
];

function getPipelineStages(settings) {
  const raw = settings && settings.crm_pipeline_stages;
  if (!raw) return DEFAULT_PIPELINE_STAGES;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((s) => s && s.key && s.label)) {
      return parsed;
    }
  } catch (e) {
    // Bozuk JSON — varsayılana geri dön, sessizce.
  }
  return DEFAULT_PIPELINE_STAGES;
}

function stageIndex(stages, key) {
  const idx = stages.findIndex((s) => s.key === key);
  return idx === -1 ? 0 : idx;
}

// Bir markayı pipeline'da SADECE İLERİ taşır — asla geriye almaz (kullanıcı
// elle geri almak isterse panelden manuel yapabilir). Otomatik durum
// değişikliklerinde (e-mail bulundu, gönderildi, olumlu yanıt geldi, evrak
// istendi vb.) bu fonksiyon çağrılır; "targetKey" pipeline'da mevcut değilse
// (kullanıcı o aşamayı silmişse) hiçbir şey yapmaz.
function advanceStage(currentKey, targetKey, stages) {
  const list = stages || DEFAULT_PIPELINE_STAGES;
  const targetIdx = list.findIndex((s) => s.key === targetKey);
  if (targetIdx === -1) return currentKey;
  const currentIdx = stageIndex(list, currentKey);
  return targetIdx > currentIdx ? targetKey : currentKey;
}

module.exports = { DEFAULT_PIPELINE_STAGES, getPipelineStages, stageIndex, advanceStage };
