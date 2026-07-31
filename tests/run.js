#!/usr/bin/env node
// Kalıcı otomatik test seti — ana çalıştırıcı.
//
// Gerçek ağ/API erişimi ya da harici bir test framework'ü (jest/mocha vb.)
// GEREKTİRMEZ; sadece Node'un yerleşik modülleriyle çalışır. Her test dosyası
// (tests/*.test.js) ayrı bir Node alt sürecinde çalıştırılır — böylece her biri
// kendi izole geçici SQLite veritabanını (DATA_DIR) kullanır ve birbirini etkilemez.
//
// Çalıştırmak için: npm test   (ya da doğrudan: node tests/run.js)
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const testsDir = __dirname;
const files = fs
  .readdirSync(testsDir)
  .filter((f) => f.endsWith(".test.js"))
  .sort();

console.log(`\nbrand-outreach-single-user — otomatik test seti`);
console.log(`${files.length} test dosyası bulundu.\n`);

let passedFiles = 0;
let failedFiles = 0;
const failures = [];

for (const file of files) {
  const full = path.join(testsDir, file);
  try {
    const output = execFileSync(process.execPath, [full], {
      encoding: "utf8",
      stdio: "pipe",
      timeout: 30000,
    });
    process.stdout.write(output);
    passedFiles++;
  } catch (err) {
    failedFiles++;
    failures.push(file);
    if (err.stdout) process.stdout.write(err.stdout);
    if (err.stderr) process.stderr.write(err.stderr);
    console.log(`✗ ${file} BAŞARISIZ\n`);
  }
}

console.log("----------------------------------------");
console.log(`Toplam: ${files.length} dosya — ${passedFiles} başarılı, ${failedFiles} başarısız`);
if (failedFiles > 0) {
  console.log(`Başarısız dosyalar: ${failures.join(", ")}`);
  process.exit(1);
} else {
  console.log("Tüm testler geçti. ✓");
}
