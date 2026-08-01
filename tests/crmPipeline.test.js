// CRM Pipeline yardımcı fonksiyonları da saf mantık (DB/ağ kullanmaz) — gerçek
// üretim kodunu doğrudan test edebiliyoruz.
const { check, summaryAndExit } = require("./_helpers");
const { getPipelineStages, advanceStage, DEFAULT_PIPELINE_STAGES } = require("../src/services/crmPipeline");

console.log("crmPipeline.test.js — CRM Pipeline aşama yönetimi");

async function run() {
  await check("ayar yoksa (crm_pipeline_stages null) varsayılan 10 aşama dönmeli", () => {
    const stages = getPipelineStages({ crm_pipeline_stages: null });
    if (stages.length !== 10) throw new Error(`Beklenen 10 aşama, gelen: ${stages.length}`);
    if (stages[0].key !== "new_lead") throw new Error(`İlk aşama new_lead olmalı, gelen: ${stages[0].key}`);
    if (stages[stages.length - 1].key !== "repeat_orders") {
      throw new Error(`Son aşama repeat_orders olmalı, gelen: ${stages[stages.length - 1].key}`);
    }
  });

  await check("bozuk JSON varsa hata fırlatmadan varsayılana dönmeli", () => {
    const stages = getPipelineStages({ crm_pipeline_stages: "{bozuk json" });
    if (stages.length !== DEFAULT_PIPELINE_STAGES.length) {
      throw new Error("Bozuk JSON'da varsayılan listeye dönmedi");
    }
  });

  await check("kullanıcının özelleştirdiği liste doğru okunmalı", () => {
    const custom = JSON.stringify([
      { key: "a", label: "A" },
      { key: "b", label: "B" },
    ]);
    const stages = getPipelineStages({ crm_pipeline_stages: custom });
    if (stages.length !== 2 || stages[0].key !== "a" || stages[1].label !== "B") {
      throw new Error(`Özel liste doğru okunmadı: ${JSON.stringify(stages)}`);
    }
  });

  await check("eksik/geçersiz özel liste (key veya label eksik) varsayılana düşmeli", () => {
    const invalid = JSON.stringify([{ key: "a" }]); // label eksik
    const stages = getPipelineStages({ crm_pipeline_stages: invalid });
    if (stages.length !== DEFAULT_PIPELINE_STAGES.length) {
      throw new Error("Geçersiz liste varsayılana düşmedi");
    }
  });

  await check("advanceStage ileri taşımalı", () => {
    const next = advanceStage("new_lead", "email_sent", DEFAULT_PIPELINE_STAGES);
    if (next !== "email_sent") throw new Error(`Beklenen email_sent, gelen: ${next}`);
  });

  await check("advanceStage ASLA geriye almamalı", () => {
    const next = advanceStage("positive_reply", "email_found", DEFAULT_PIPELINE_STAGES);
    if (next !== "positive_reply") throw new Error(`Geriye alındı! Beklenen positive_reply, gelen: ${next}`);
  });

  await check("advanceStage, pipeline'da olmayan bir hedefe taşımamalı", () => {
    const next = advanceStage("new_lead", "hic_yok_boyle_asama", DEFAULT_PIPELINE_STAGES);
    if (next !== "new_lead") throw new Error(`Beklenen new_lead (değişmemeli), gelen: ${next}`);
  });

  await check("advanceStage aynı aşamaya taşınmayı no-op olarak ele almalı", () => {
    const next = advanceStage("email_sent", "email_sent", DEFAULT_PIPELINE_STAGES);
    if (next !== "email_sent") throw new Error(`Beklenen email_sent, gelen: ${next}`);
  });

  summaryAndExit();
}

run();
