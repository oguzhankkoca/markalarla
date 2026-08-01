// v48: Gelişmiş fuzzy duplicate tespiti. Mevcut tam-eşleşme dedup (name_normalized
// = LOWER(TRIM(name))) sadece BİREBİR aynı adları yakalar; "Nike Inc.", "NIKE, LLC"
// ve "Nike" gibi aynı markanın farklı yazımlarını KAÇIRIR. Bu modül, şirket
// eklerini (Inc/LLC/Ltd/Co vs.), noktalama işaretlerini ve fazla boşlukları
// ayıklayan bir "fuzzy anahtar" üretir; aynı fuzzy anahtara sahip ama tam adı
// FARKLI olan markaları birer "olası duplicate" grubu olarak işaretler.
//
// Performans notu (v65 ile uyumlu): gruplama tek geçişte bir Map ile yapılır
// (O(n)), yani 100.000+ marka için bile pratikte anında çalışır — pahalı
// ikili (all-pairs) karşılaştırma YAPILMAZ.

const LEGAL_SUFFIXES = [
  "incorporated",
  "corporation",
  "company",
  "limited",
  "group",
  "brands",
  "brand",
  "holdings",
  "international",
  "usa",
  "us",
  "llc",
  "l l c",
  "ltd",
  "inc",
  "co",
  "corp",
  "gmbh",
  "plc",
];

// "Nike, Inc." -> "nike" ; "Nike LLC" -> "nike" ; "Nike Golf Co." -> "nike golf"
function normalizeFuzzyName(name) {
  if (!name) return "";
  let s = String(name).toLowerCase();
  s = s.replace(/&/g, " and ");
  s = s.replace(/[^a-z0-9\s]/g, " "); // noktalama/özel karakterleri boşluğa çevir
  s = s.replace(/\s+/g, " ").trim();
  const words = s.split(" ").filter(Boolean);
  while (words.length > 1 && LEGAL_SUFFIXES.includes(words[words.length - 1])) {
    words.pop();
  }
  return words.join(" ");
}

// Basit Levenshtein mesafesi (küçük string'ler için, ör. yazım hatalarını
// yakalamak amacıyla — sadece aynı grup İÇİNDE, çok az sayıda karşılaştırma
// için kullanılır, tüm veri setinde ikili karşılaştırma YAPILMAZ).
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prevDiag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        prevDiag + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      prevDiag = temp;
    }
  }
  return prev[b.length];
}

function similarity(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

// brands: [{ id, name }] -> olası duplicate grupları döndürür. Her grup en az
// 2 FARKLI tam ad (name) içerir (aksi halde zaten mevcut tam-eşleşme dedup
// yakalar, burası fuzzy'nin katkısı sadece farklı yazımlar içindir).
function findFuzzyDuplicateGroups(brands, { similarityThreshold = 0.82 } = {}) {
  const byKey = new Map();
  for (const b of brands) {
    const key = normalizeFuzzyName(b.name);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(b);
  }

  const groups = [];
  for (const [key, items] of byKey.entries()) {
    const distinctNames = new Set(items.map((i) => String(i.name || "").trim().toLowerCase()));
    if (distinctNames.size > 1) {
      groups.push({ key, reason: "suffix_normalized", brands: items });
    }
  }

  // İkinci geçiş: aynı ilk kelimeyi paylaşan (ör. "nike" ile başlayan) ama
  // fuzzy anahtarları TAM eşleşmeyen, yalnızca yakın yazım hatası olabilecek
  // markalar için — sadece küçük gruplar içinde (performans için sınırlı).
  const byFirstWord = new Map();
  for (const [key] of byKey.entries()) {
    const firstWord = key.split(" ")[0];
    if (!firstWord) continue;
    if (!byFirstWord.has(firstWord)) byFirstWord.set(firstWord, []);
    byFirstWord.get(firstWord).push(key);
  }
  const alreadyGrouped = new Set(groups.map((g) => g.key));
  for (const [, keys] of byFirstWord.entries()) {
    if (keys.length < 2 || keys.length > 50) continue; // büyük gruplarda ikili karşılaştırmadan kaçın
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const k1 = keys[i];
        const k2 = keys[j];
        if (k1 === k2) continue;
        if (similarity(k1, k2) >= similarityThreshold) {
          const combinedKey = [k1, k2].sort().join(" ~ ");
          if (alreadyGrouped.has(k1) || alreadyGrouped.has(k2)) continue;
          const items = [...byKey.get(k1), ...byKey.get(k2)];
          groups.push({ key: combinedKey, reason: "similar_spelling", brands: items });
          alreadyGrouped.add(k1);
          alreadyGrouped.add(k2);
        }
      }
    }
  }

  return groups;
}

module.exports = { normalizeFuzzyName, levenshtein, similarity, findFuzzyDuplicateGroups };
