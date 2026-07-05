// score.mjs — deterministic niche scorer for product-opportunity-finder
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const WEIGHTS = { demand: 0.4, rankability: 0.4, margin: 0.2 };
const BANDS = {
  revenue: [[0,0],[5000,40],[15000,70],[30000,100]],
  sv:      [[0,0],[2000,40],[10000,70],[30000,100]],
  iq:      [[0,0],[500,40],[3000,70],[10000,85],[30000,95],[50000,100]],
  cpr:     [[30,100],[60,70],[120,40],[300,0]],   // lower CPR → higher score
  reviews: [[0,100],[200,70],[500,40],[1500,0]],  // fewer reviews → higher score
  price:   [[0,40],[20,60],[30,80],[50,100]],
  weight:  [[0.5,100],[1,80],[2,50],[3,20]],       // lighter → higher score
};

export function band(value, points) {
  if (value == null || Number.isNaN(Number(value))) return null;
  const v = Number(value);
  if (v <= points[0][0]) return points[0][1];
  if (v >= points[points.length - 1][0]) return points[points.length - 1][1];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1], [x1, y1] = points[i];
    if (v <= x1) return y0 + (y1 - y0) * ((v - x0) / (x1 - x0));
  }
  return points[points.length - 1][1];
}

export function median(nums) {
  const a = (nums || []).filter((n) => n != null).map(Number).filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function mean(arr) { const a = (arr || []).filter((n) => n != null); return a.length ? a.reduce((s, n) => s + n, 0) / a.length : null; }

export function aggregate(products) {
  const p = products || [];
  const prices = p.map((x) => x.price).filter((n) => n != null && Number.isFinite(Number(n))).map(Number);
  const weights = p.map((x) => x.weightLb).filter((n) => n != null && Number.isFinite(Number(n))).map(Number);
  return {
    medRevenue30d: median(p.map((x) => x.revenue30d)),
    medReviews: median(p.map((x) => x.reviewCount)),
    medRating: median(p.map((x) => x.rating)),
    priceLow: prices.length ? Math.min(...prices) : null,
    priceHigh: prices.length ? Math.max(...prices) : null,
    avgWeightLb: weights.length ? +(weights.reduce((s, n) => s + n, 0) / weights.length).toFixed(2) : null,
  };
}

export function scoreNiche(agg, kw = {}) {
  const rev = band(agg.medRevenue30d, BANDS.revenue) ?? 0;
  const svS = band(kw.searchVolume, BANDS.sv);
  const demand = svS == null ? rev : 0.5 * rev + 0.5 * svS;
  const rankability = mean([band(kw.iqScore, BANDS.iq), band(kw.cpr, BANDS.cpr), band(agg.medReviews, BANDS.reviews)]) ?? 50;
  const priceS = band(agg.priceLow, BANDS.price) ?? 40;
  const weightS = agg.avgWeightLb == null ? 70 : (band(agg.avgWeightLb, BANDS.weight) ?? 70);
  const margin = 0.6 * priceS + 0.4 * weightS;
  const raw = WEIGHTS.demand * demand + WEIGHTS.rankability * rankability + WEIGHTS.margin * margin;
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  const label = score >= 70 ? "Strong" : score >= 45 ? "Worth-testing" : "Pass";
  return { score, label };
}

export function buildNiche(n, candMap) {
  const products = (n.asins || []).map((a) => candMap.get(a)).filter(Boolean);
  const agg = aggregate(products);
  const kw = { searchVolume: n.searchVolume ?? null, iqScore: n.iqScore ?? null, cpr: n.cpr ?? null };
  const { score, label } = scoreNiche(agg, kw);
  const ex = [...products].sort((a, b) => (Number(b.revenue30d) || 0) - (Number(a.revenue30d) || 0)).slice(0, 3)
    .map((p) => ({ asin: p.asin, title: p.title, price: p.price, revenue30d: p.revenue30d, reviewCount: p.reviewCount, rating: p.rating, source: p.source || "blackbox" }));
  return {
    niche: n.niche, score, label, why: n.why || "",
    metrics: { medRevenue30d: agg.medRevenue30d, medReviews: agg.medReviews, medRating: agg.medRating, priceLow: agg.priceLow, priceHigh: agg.priceHigh, searchVolume: kw.searchVolume, iqScore: kw.iqScore, cpr: kw.cpr, avgWeightLb: agg.avgWeightLb },
    exampleProducts: ex,
    nextSteps: { costSkillAsin: ex[0] ? ex[0].asin : null, reviewSkillKeyword: n.keyword || n.niche },
  };
}

export function selectAndRank(built) {
  const sorted = [...built].sort((a, b) => (b.score !== a.score ? b.score - a.score : (b.metrics.medRevenue30d || 0) - (a.metrics.medRevenue30d || 0)));
  return { shortlist: sorted.slice(0, 3), runnersUp: sorted.slice(3).map((o) => ({ niche: o.niche, score: o.score, label: o.label })) };
}

export async function main(runDir) {
  const candidates = JSON.parse(await readFile(join(runDir, "candidates.json"), "utf8"));
  const map = JSON.parse(await readFile(join(runDir, "niche-map.json"), "utf8"));
  if (!Array.isArray(candidates)) throw new Error("candidates.json must be an array");
  if (!map || !Array.isArray(map.niches)) throw new Error("niche-map.json must have a niches[] array");
  const candMap = new Map(candidates.map((c) => [c.asin, c]));
  const built = map.niches.map((n) => buildNiche(n, candMap));
  const { shortlist, runnersUp } = selectAndRank(built);
  const totals = Object.assign({}, map.totals || {}, { nichesEvaluated: map.niches.length });
  const data = { category: map.category, date: map.date, criteria: map.criteria || {}, totals, shortlist, runnersUp, h10LookupsUsed: map.h10LookupsUsed ?? 0 };
  await writeFile(join(runDir, "opportunities.js"), "window.__DISCOVERY_DATA__ = " + JSON.stringify(data, null, 2) + ";");
  return data;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const runDir = process.argv[2];
  if (!runDir) { console.error("Usage: node score.mjs <run-dir>"); process.exit(1); }
  main(runDir)
    .then((d) => console.log(`Wrote opportunities.js — ${d.shortlist.length} shortlist, ${d.runnersUp.length} runners-up.`))
    .catch((e) => { console.error(e.message); process.exit(1); });
}
