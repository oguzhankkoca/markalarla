const express = require("express");
const { getCreditsStatus } = require("../services/creditsService");

const router = express.Router();

// Panelin sağ üstündeki "API kredileri" kutusu bu uç noktayı çağırır.
router.get("/api/credits", async (req, res) => {
  try {
    const status = await getCreditsStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
