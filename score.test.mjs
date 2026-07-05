import { test } from "node:test";
import assert from "node:assert/strict";
import { band, median, aggregate, scoreNiche, selectAndRank, buildNiche, main } from "./score.mjs";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join as joinPath } from "node:path";

test("band: knots, interpolation, clamps, null", () => {
  assert.equal(band(5000, [[0,0],[5000,40],[15000,70],[30000,100]]), 40);
  assert.equal(band(10000, [[0,0],[5000,40],[15000,70],[30000,100]]), 55);
  assert.equal(band(0, [[0,0],[5000,40],[15000,70]]), 0);
  assert.equal(band(99999, [[0,0],[5000,40],[15000,70]]), 70);
  assert.equal(band(null, [[0,0],[5000,40]]), null);
});

test("band: descending-y (CPR) still interpolates", () => {
  assert.equal(band(20, [[30,100],[60,70],[120,40],[300,0]]), 100);
  assert.equal(band(350, [[30,100],[60,70],[120,40],[300,0]]), 0);
  assert.ok(Math.abs(band(81, [[30,100],[60,70],[120,40],[300,0]]) - 59.5) < 1e-9);
});

test("median: odd, even, null-skip, empty", () => {
  assert.equal(median([1,2,3]), 2);
  assert.equal(median([1,2,3,4]), 2.5);
  assert.equal(median([null, 2, null, 4]), 3);
  assert.equal(median([]), null);
});

test("aggregate: medians, min/max, mean, null-safe", () => {
  const a = aggregate([
    { revenue30d: 7687, reviewCount: null, rating: null, price: 25, weightLb: null },
    { revenue30d: 14729, reviewCount: null, rating: null, price: 29, weightLb: null },
    { revenue30d: 8570, reviewCount: null, rating: null, price: 34, weightLb: null },
  ]);
  assert.equal(a.medRevenue30d, 8570);
  assert.equal(a.medReviews, null);
  assert.equal(a.priceLow, 25);
  assert.equal(a.priceHigh, 34);
  assert.equal(a.avgWeightLb, null);
});

test("scoreNiche: beeswax reference → 76 Strong", () => {
  const agg = { medRevenue30d: 8570, medReviews: null, medRating: null, priceLow: 25, priceHigh: 34, avgWeightLb: null };
  const r = scoreNiche(agg, { searchVolume: 45418, iqScore: 45418, cpr: 81 });
  assert.equal(r.score, 76);
  assert.equal(r.label, "Strong");
});

test("scoreNiche: keyword-null falls back to revenue-only demand", () => {
  const agg = { medRevenue30d: 8000, medReviews: null, medRating: null, priceLow: 25, priceHigh: 34, avgWeightLb: null };
  const r = scoreNiche(agg, {});
  assert.equal(r.score, 54);
  assert.equal(r.label, "Worth-testing");
});

test("buildNiche: aggregates from candMap + picks top-revenue example + nextSteps", () => {
  const candMap = new Map([
    ["B1", { asin: "B1", title: "T1", price: 29, revenue30d: 14729, reviewCount: null, rating: null, source: "blackbox" }],
    ["B2", { asin: "B2", title: "T2", price: 25, revenue30d: 7687, reviewCount: null, rating: null, source: "blackbox" }],
  ]);
  const b = buildNiche({ niche: "Beeswax", why: "w", asins: ["B2", "B1"], keyword: "beeswax bread bag", searchVolume: 45418, iqScore: 45418, cpr: 81 }, candMap);
  assert.equal(b.score, 77); // 2-product median revenue (11,208), null weight → neutral margin
  assert.equal(b.exampleProducts[0].asin, "B1");
  assert.equal(b.nextSteps.costSkillAsin, "B1");
  assert.equal(b.nextSteps.reviewSkillKeyword, "beeswax bread bag");
  assert.equal(b.metrics.searchVolume, 45418);
});

test("selectAndRank: Top-3 shortlist + runners-up, sorted with tie-break", () => {
  const mk = (niche, score, rev) => ({ niche, score, label: "x", metrics: { medRevenue30d: rev } });
  const { shortlist, runnersUp } = selectAndRank([mk("A",60,100), mk("B",80,50), mk("C",80,900), mk("D",45,10), mk("E",30,10)]);
  assert.deepEqual(shortlist.map((s) => s.niche), ["C", "B", "A"]);
  assert.deepEqual(runnersUp.map((r) => r.niche), ["D", "E"]);
  assert.deepEqual(runnersUp[0], { niche: "D", score: 45, label: "x" });
});

test("main: writes opportunities.js from the two files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "opp-"));
  await writeFile(join(dir, "candidates.json"), JSON.stringify([
    { asin: "B1", title: "T1", price: 29, revenue30d: 14729, reviewCount: null, rating: null, source: "blackbox" },
    { asin: "B2", title: "T2", price: 26, revenue30d: 12133, reviewCount: null, rating: null, source: "blackbox" },
  ]));
  await writeFile(join(dir, "niche-map.json"), JSON.stringify({
    category: "Home & Kitchen", date: "2026-07-02", criteria: { minPrice: 20 },
    totals: { candidatesFound: 2, blackBox: true, blackBoxSource: "cache" }, h10LookupsUsed: 1,
    niches: [
      { niche: "Beeswax", why: "w", asins: ["B1"], keyword: "beeswax bread bag", searchVolume: 45418, iqScore: 45418, cpr: 81 },
      { niche: "Bento", why: "w2", asins: ["B2"], keyword: "bento box", searchVolume: 11225, iqScore: 5613, cpr: 42 },
    ],
  }));
  const data = await main(dir);
  const written = await readFile(join(dir, "opportunities.js"), "utf8");
  assert.ok(written.startsWith("window.__DISCOVERY_DATA__ = "));
  assert.equal(data.shortlist.length, 2);
  assert.equal(data.totals.nichesEvaluated, 2);
  assert.equal(data.totals.blackBoxSource, "cache");
  assert.equal(data.h10LookupsUsed, 1);
  assert.ok(data.shortlist[0].score >= data.shortlist[1].score);
  await rm(dir, { recursive: true, force: true });
});

test("CLI guard fires with no args (usage + exit 1)", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const r = spawnSync(process.execPath, [joinPath(here, "score.mjs")], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Usage: node score\.mjs/);
});
