require("dotenv").config();
const path = require("path");
const express = require("express");

const settingsRoutes = require("./routes/settings");
const brandRoutes = require("./routes/brands");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(settingsRoutes);
app.use(brandRoutes);
app.use(express.static(path.join(__dirname, "..", "public")));

app.listen(PORT, () => {
  console.log("");
  console.log("=================================================");
  console.log(`  Uygulama çalışıyor -> http://localhost:${PORT}`);
  console.log("  Tarayıcında bu adresi aç.");
  console.log("  Kapatmak için bu pencereyi kapatabilir ya da");
  console.log("  Ctrl+C tuşlayabilirsin.");
  console.log("=================================================");
  console.log("");
});
