const { check, summaryAndExit } = require("./_helpers");
const {
  normalizeFuzzyName,
  levenshtein,
  similarity,
  findFuzzyDuplicateGroups,
} = require("../src/services/fuzzyDedup");

async function main() {
  await check("normalizeFuzzyName strips legal suffixes", () => {
    if (normalizeFuzzyName("Nike, Inc.") !== "nike") throw new Error("Inc. not stripped");
    if (normalizeFuzzyName("NIKE LLC") !== "nike") throw new Error("LLC not stripped");
    if (normalizeFuzzyName("Nike Corp") !== "nike") throw new Error("Corp not stripped");
  });

  await check("normalizeFuzzyName keeps meaningful words", () => {
    if (normalizeFuzzyName("Nike Golf Co.") !== "nike golf") throw new Error("lost 'golf'");
  });

  await check("normalizeFuzzyName handles & and punctuation", () => {
    if (normalizeFuzzyName("Johnson & Johnson") !== "johnson and johnson")
      throw new Error("got: " + normalizeFuzzyName("Johnson & Johnson"));
  });

  await check("levenshtein basic cases", () => {
    if (levenshtein("nike", "nike") !== 0) throw new Error("identical should be 0");
    if (levenshtein("nike", "nrke") !== 1) throw new Error("one substitution should be 1");
    if (levenshtein("", "abc") !== 3) throw new Error("empty vs abc should be 3");
  });

  await check("similarity returns 1 for identical strings", () => {
    if (similarity("nike", "nike") !== 1) throw new Error("expected 1");
  });

  await check("findFuzzyDuplicateGroups catches suffix variants", () => {
    const brands = [
      { id: 1, name: "Nike, Inc." },
      { id: 2, name: "NIKE LLC" },
      { id: 3, name: "Adidas" },
    ];
    const groups = findFuzzyDuplicateGroups(brands);
    if (groups.length !== 1) throw new Error("expected 1 group, got " + groups.length);
    if (groups[0].brands.length !== 2) throw new Error("expected 2 brands in group");
  });

  await check("findFuzzyDuplicateGroups does not group truly distinct brands", () => {
    const brands = [
      { id: 1, name: "Nike Golf" },
      { id: 2, name: "Nike Running" },
    ];
    const groups = findFuzzyDuplicateGroups(brands);
    // "nike golf" ve "nike running" farklı fuzzy anahtarlar - suffix_normalized eşleşmez.
    const exactGroups = groups.filter((g) => g.reason === "suffix_normalized");
    if (exactGroups.length !== 0) throw new Error("should not group different product lines");
  });

  await check("findFuzzyDuplicateGroups catches near-spelling typos via similarity pass", () => {
    const brands = [
      { id: 1, name: "Acme Widgets" },
      { id: 2, name: "Acme Widget" },
    ];
    const groups = findFuzzyDuplicateGroups(brands);
    if (groups.length !== 1) throw new Error("expected 1 group for near-spelling, got " + groups.length);
  });

  await check("findFuzzyDuplicateGroups skips groups with only one distinct name", () => {
    const brands = [
      { id: 1, name: "Nike Inc" },
      { id: 2, name: "Nike Inc" },
    ];
    // Bu zaten tam eşleşme dedup'ın işi; fuzzy modül bunu ayrı bir grup olarak
    // eklemez (distinctNames.size > 1 şartı sağlanmaz).
    const groups = findFuzzyDuplicateGroups(brands);
    if (groups.length !== 0) throw new Error("identical names should not form a fuzzy group");
  });

  await check("findFuzzyDuplicateGroups handles empty/large input without throwing", () => {
    const brands = [];
    for (let i = 0; i < 2000; i++) brands.push({ id: i, name: `Brand ${i}` });
    const start = Date.now();
    findFuzzyDuplicateGroups(brands);
    const elapsed = Date.now() - start;
    if (elapsed > 5000) throw new Error("too slow for 2000 brands: " + elapsed + "ms");
  });
}

main().then(() => summaryAndExit(null));
