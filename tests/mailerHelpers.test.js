const { check, summaryAndExit } = require("./_helpers");
const {
  sortAccountsByLeastSent,
  pickVariant,
  safeParseArray,
  resolvePublicBaseUrl,
} = require("../src/services/mailerHelpers");

async function main() {
  await check("sortAccountsByLeastSent puts account with 0 sends first", () => {
    const accounts = [{ email: "a@x.com" }, { email: "b@x.com" }, { email: "c@x.com" }];
    const countMap = new Map([
      ["a@x.com", 5],
      ["b@x.com", 0],
      ["c@x.com", 2],
    ]);
    const sorted = sortAccountsByLeastSent(accounts, countMap);
    if (sorted[0].email !== "b@x.com") throw new Error("expected b@x.com first, got " + sorted[0].email);
    if (sorted[2].email !== "a@x.com") throw new Error("expected a@x.com last");
  });

  await check("sortAccountsByLeastSent treats missing counts as 0", () => {
    const accounts = [{ email: "a@x.com" }, { email: "never-sent@x.com" }];
    const countMap = new Map([["a@x.com", 3]]);
    const sorted = sortAccountsByLeastSent(accounts, countMap);
    if (sorted[0].email !== "never-sent@x.com") throw new Error("expected never-sent@x.com first");
  });

  await check("sortAccountsByLeastSent does not mutate original array", () => {
    const accounts = [{ email: "a@x.com" }, { email: "b@x.com" }];
    const original = [...accounts];
    sortAccountsByLeastSent(accounts, new Map([["b@x.com", 0], ["a@x.com", 9]]));
    if (accounts[0] !== original[0]) throw new Error("original array was mutated");
  });

  await check("pickVariant returns fallback when list is empty", () => {
    if (pickVariant([], "fallback subject") !== "fallback subject") throw new Error("should return fallback");
    if (pickVariant(null, "fallback subject") !== "fallback subject") throw new Error("should return fallback for null");
    if (pickVariant(undefined, "fallback subject") !== "fallback subject") throw new Error("should return fallback for undefined");
  });

  await check("pickVariant returns one of the provided variants", () => {
    const variants = ["Subject A", "Subject B", "Subject C"];
    for (let i = 0; i < 20; i++) {
      const picked = pickVariant(variants, "fallback");
      if (!variants.includes(picked)) throw new Error("picked value not in variants list: " + picked);
    }
  });

  await check("safeParseArray handles valid JSON array", () => {
    const result = safeParseArray('["a", "b"]');
    if (result.length !== 2 || result[0] !== "a") throw new Error("parse failed");
  });

  await check("safeParseArray returns [] for invalid/missing JSON", () => {
    if (safeParseArray(null).length !== 0) throw new Error("null should give []");
    if (safeParseArray("").length !== 0) throw new Error("empty string should give []");
    if (safeParseArray("not json").length !== 0) throw new Error("invalid json should give []");
    if (safeParseArray('{"a":1}').length !== 0) throw new Error("non-array JSON should give []");
  });

  await check("resolvePublicBaseUrl prefers PUBLIC_URL over RENDER_EXTERNAL_URL", () => {
    const url = resolvePublicBaseUrl({
      PUBLIC_URL: "https://custom.example.com/",
      RENDER_EXTERNAL_URL: "https://render.example.com",
    });
    if (url !== "https://custom.example.com") throw new Error("got: " + url);
  });

  await check("resolvePublicBaseUrl falls back to RENDER_EXTERNAL_URL", () => {
    const url = resolvePublicBaseUrl({ RENDER_EXTERNAL_URL: "https://render.example.com/" });
    if (url !== "https://render.example.com") throw new Error("got: " + url);
  });

  await check("resolvePublicBaseUrl returns empty string when neither is set", () => {
    const url = resolvePublicBaseUrl({});
    if (url !== "") throw new Error("expected empty string, got: " + url);
  });
}

main().then(() => summaryAndExit(null));
