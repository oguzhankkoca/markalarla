const express = require("express");
const db = require("../db");

const router = express.Router();

function pct(part, whole) {
  if (!whole) return 0;
  return Math.round((part / whole) * 1000) / 10; // bir ondalık basamak
}

router.get("/api/analytics", (req, res) => {
  const totalBrands = db.prepare("SELECT COUNT(*) c FROM brands").get().c;
  const foundEmails = db
    .prepare("SELECT COUNT(*) c FROM brands WHERE status IN ('found','sent','bounced') OR replied = 1")
    .get().c;
  const notFound = db.prepare("SELECT COUNT(*) c FROM brands WHERE status = 'not_found'").get().c;
  const sent = db.prepare("SELECT COUNT(*) c FROM brands WHERE status = 'sent' OR replied = 1 OR status = 'bounced'").get().c;
  const bounced = db.prepare("SELECT COUNT(*) c FROM brands WHERE bounced = 1").get().c;
  const replied = db.prepare("SELECT COUNT(*) c FROM brands WHERE replied = 1").get().c;
  const positive = db.prepare("SELECT COUNT(*) c FROM brands WHERE reply_sentiment = 'positive'").get().c;
  const negative = db.prepare("SELECT COUNT(*) c FROM brands WHERE reply_sentiment = 'negative'").get().c;
  const duplicateBlocked = db.prepare("SELECT COUNT(*) c FROM brands WHERE status = 'duplicate_blocked'").get().c;

  const dealStages = db
    .prepare(
      `SELECT deal_stage, COUNT(*) c FROM brands WHERE status = 'sent' OR replied = 1
       GROUP BY deal_stage`
    )
    .all();
  const dealStageCounts = { new: 0, meeting_scheduled: 0, sample_sent: 0, deal_closed: 0, rejected: 0 };
  dealStages.forEach((row) => {
    if (row.deal_stage && dealStageCounts.hasOwnProperty(row.deal_stage)) {
      dealStageCounts[row.deal_stage] = row.c;
    }
  });

  res.json({
    totalBrands,
    foundEmails,
    notFound,
    sent,
    bounced,
    replied,
    positive,
    negative,
    duplicateBlocked,
    dealStageCounts,
    rates: {
      emailFoundRate: pct(foundEmails, totalBrands),
      replyRate: pct(replied, sent),
      positiveRate: pct(positive, replied),
      dealClosedRate: pct(dealStageCounts.deal_closed, sent),
    },
  });
});

module.exports = router;
