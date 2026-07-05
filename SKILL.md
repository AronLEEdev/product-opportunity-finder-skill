---
name: product-opportunity-finder-skill
description: Amazon product-discovery / niche finder for FBA sellers. Given a broad category (e.g. Home & Kitchen, Pet Supplies), drive the user's logged-in Chrome via the Claude-in-Chrome MCP to discover REAL products with Helium 10 Black Box (filtered by price/revenue/reviews/weight) enriched by an Amazon Best-Sellers scrape, cluster them into niches, keyword-validate demand with Magnet, score each 0-100 (Strong/Worth-testing/Pass), and render a Top-3 opportunity-shortlist HTML report. Front of the funnel that feeds the cost-analyze and review-analyze skills.
---

# Product Opportunity Finder Procedure

Given a broad Amazon **category**, this skill finds **real** product niches worth
pursuing and returns a ranked **Top-3 opportunity shortlist** as a static HTML report.

**Core principle — data-driven, never invented.** Do NOT brainstorm random products.
Candidates come only from real Amazon data: **Helium 10 Black Box** (a filterable
database of Amazon's catalog) as the primary lane, enriched by scraping Amazon's own
**Best Sellers / Movers & Shakers / New Releases** pages. The LLM only (a) turns the
category into good filter/seed terms, (b) clusters raw results into niches, (c) applies
starter-friendly judgment, and (d) scores/ranks. **Never fabricate products or metrics.**

This is **Phase 1** (discovery). Each shortlisted niche ends with a manual hand-off to
the companion skills — `product-cost-analyze-skill` (is it profitable?) and
`product-review-analyze-skill` (what do buyers want?). Auto-running them is future work.

Packaging mirrors those skills: a user installs `SKILL.md`; `report-template.html` is
fetched from this repo at run time; the report renders `window.__DISCOVERY_DATA__` and
is served over http.

## Output files (per run)

Run dir e.g. `~/Documents/product-research/<category-slug>-opportunities/`:

| File | Written by | Description |
|---|---|---|
| `candidates.json` | Phase 1B | raw discovered products (Black Box + Best Sellers), `source`-tagged |
| `niche-map.json` | Phase 1E | LLM niche assignments + `why` + Magnet metrics (judgment; **no math**) |
| `opportunities.js` | Phase 1E (`score.mjs`) | `window.__DISCOVERY_DATA__ = {...}` — computed by the helper, loaded by the template |
| `report.html` | one-time copy | the fetched template (copy, don't regenerate) |

## Preconditions

| Requirement | Needed for | Required? |
|---|---|---|
| Chrome + **Claude-in-Chrome MCP**, connected | whole workflow | **Required** |
| **Amazon** account, logged in (same profile) | Best-Sellers scrape, Xray | **Required** |
| **Helium 10 with Black Box** (Platinum+) | Lane A discovery + Magnet validation | **Recommended** (degrades to Best-Sellers-only) |
| **Python 3** (or any static server) | serve the report over http | **Required** |

No automated login or CAPTCHA solving — on a login wall / verification slider, stop and
ask the user to resolve it in Chrome, then continue.

**Token discipline (browser-heavy):** batch predictable sequences with `browser_batch`;
evals return only counts/trimmed rows, never raw page dumps or URLs; verify with DOM
**count** probes, not screenshots (≤1 screenshot — the finished report).

> **Helium 10 usage cap — at most 3 metered actions per run.** Black Box and
> Magnet/Cerebro lookups consume monthly plan usage and ARE counted; scraping Amazon
> Best Sellers and an already-open Xray overlay do **not**. Maintain a counter; before a
> metered action, if the counter is already 3, skip it and note `H10 usage cap reached`.
> The default flow spends **2** (1 Black Box + 1 Magnet). Record the final count as
> `h10LookupsUsed` in `opportunities.js`.

## Phase 1A — Seed the category (0 metered)

From the category, produce:
1. **5–10 Black Box seed terms / sub-niches** (concrete product types, not the broad
   category) to guide filtering, e.g. for Home & Kitchen: "silicone lids", "spice
   organizer", "dish rack", "cat window perch" (for Pet Supplies).
2. The Amazon **Best Sellers / Movers & Shakers / New Releases** URLs for the category
   and 2–3 relevant sub-categories:
   ```
   https://www.amazon.com/Best-Sellers/zgbs/kitchen
   https://www.amazon.com/gp/movers-and-shakers/kitchen
   https://www.amazon.com/gp/new-releases/kitchen
   ```
   (Swap `kitchen` for `pet-supplies`, `home-garden`, or a sub-category node.)

## Phase 1B — Discover candidates (two lanes)

### Black Box cache — check before spending a lookup

Black Box results are cached so re-running the same **category + filters** within
**14 days** costs **0 lookups**. Cache file:

`~/Documents/product-research/_cache/h10/blackbox__<category-slug>__<filterhash>.json`

- `category-slug` — lowercase the category, non-alphanumerics → `-`:
  `slug=$(echo "<category>" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-|-$//g')`
- `filterhash` — 8 hex of a hash of the **normalized** filters (fixed key order):
  `fh=$(printf '%s' '{"minPrice":20,"minRevenue":5000,"maxReviews":500,"maxWeightLb":2,"category":"<category>"}' | shasum | cut -c1-8)`
- File shape: `{ "capturedAt": <ISO>, "category", "filters": {…}, "count", "rows": [ {asin,title,price,units30d,revenue30d,reviewCount,rating,bsr,weightLb,brand,source:"blackbox"} ] }`

**1B.0 — Cache check (before any lookup).** `mkdir -p ~/Documents/product-research/_cache/h10`
first. If the cache file exists, parses as JSON, and `capturedAt` is **< 14 days** old
(`find "<file>" -mtime -14` finds it, or compare the timestamp): **load `rows` from it,
set `totals.blackBoxSource="cache"` and `totals.blackBoxCapturedAt=<capturedAt>`, spend
0 metered lookups**, and skip straight to Lane C + Phase 1C. Miss / older than 14 days /
corrupt / the user says "refresh" → **cache miss → run Lane A / 1B.1 below**.

### Lane A / 1B.1 — Fresh Black Box pull + capture-all (on cache miss, 1 metered)

In the logged-in Chrome, `navigate` to `https://members.helium10.com/black-box`
(Products tab, **Advanced** mode). Fill the numeric filters by `left_click` + `type`
on each field, then set the category:
- **Price** → Min = `20` (the Sales-column "Price" field)
- **ASIN Revenue** → Min = `5000` (per-product monthly revenue; NOT "Parent Level Revenue")
- **Review Count** → Max = `500` (low barrier to entry)
- **Weight (lb)** → Max = `2`

- **Category — pick a SPECIFIC SUBCATEGORY, not the top level.** The top-level
  "Home & Kitchen" is dominated by **Furniture** (bed frames, sofas, closet systems)
  whose listings often carry **no weight data**, so `Weight ≤ 2` does NOT exclude them.
  Instead select a starter-friendly subcategory — for Home & Kitchen use
  **Kitchen & Dining** (or Storage & Organization); for Pet Supplies pick a specific
  pet subcategory. Open the Category dropdown, type the subcategory name, and check the
  child under the right parent (e.g. *Home & Kitchen › Kitchen & Dining*).

**Run the search once** (the **Search** / **Apply Filters** button) — this is the
**1 metered action** (increment the counter). Results load into a **virtualized custom
grid** (not a `<table>`; `role=row` is empty). Extract with these validated selectors —
each row is `[class*="datacy-row"]`, cells are `[class*="datacy-tdcell<field>"]`, and
the **ASIN is the `/dp/` href inside the title cell**:

```js
(function(){
  function txt(el){ return (el&&el.textContent||'').replace(/\s+/g,' ').trim(); }
  function money(t){ const m=String(t||'').replace(/[$,]/g,'').match(/([\d.]+)/); return m?Math.round(parseFloat(m[1])):null; }
  function intg(t){ const m=String(t||'').replace(/,/g,'').match(/(\d+)/); return m?parseInt(m[1],10):null; }
  const out=[];
  document.querySelectorAll('[class*="datacy-row"]').forEach(row=>{
    const tc=row.querySelector('[class*="datacy-tdcelltitle"]');
    const a=tc&&tc.querySelector('a[href*="/dp/"]');
    const asin=a?((a.href.match(/\/dp\/([A-Z0-9]{10})/)||[])[1]):null;
    if(!asin) return;
    const cell=n=>row.querySelector('[class*="datacy-tdcell'+n+'"]');
    out.push({ asin, title:txt(tc).slice(0,70), price:money(txt(cell('price'))),
      units30d:intg(txt(cell('childMonthlySales'))),        // ASIN (child) units, NOT parent
      revenue30d:money(txt(cell('childMonthlyRevenue'))),    // ASIN revenue
      bsr:intg((txt(cell('salesRank')).match(/#([\d,]+)/)||[])[1]),
      brand:txt(cell('brand')).slice(0,24), source:'blackbox' });
  });
  window.__BB=out; return JSON.stringify({n:out.length});
})()
```
Then stash `window.__S = window.__BB.map(...).join('\n')` and read it back in ~1500-char
slices (the JSON is ~4-5 KB for 50 rows). `reviewCount`/`rating`/`weightLb` cells may
render empty in the grid — leave them `null` (the price/revenue/units/BSR are the
reliable signals; the `≤500` review filter already bounds competition).

**Capture ALL rows — not just page 1.** The search already cost the lookup, so grab the
whole result set:
- **Primary — API JSON.** Call `read_network_requests`, find the Black Box results
  request (the XHR/GraphQL call whose JSON response holds the row data; it fires on
  search and on page change), and parse **all** rows into the same fields as above. If
  the response is paginated (e.g. 50/page), page through the grid to trigger each page's
  request and merge until `count` rows are collected.
- **Fallback — paginate the grid.** If the network JSON is not cleanly readable, click
  through grid pages 1→N and run the `datacy-tdcell` extractor on each, merging + de-
  duping by ASIN.

**Write the cache.** Save the merged rows to the 1B.0 cache path with
`capturedAt=$(date -u +%FT%TZ)`, `count`, the `filters` object, and `category`; set
`totals.blackBoxSource="fresh"`, `totals.blackBoxCapturedAt=<now>`. Either path (cache
or fresh) yields the full `rows` for `candidates.json`.

If Black Box is not available / not on the plan, set `totals.blackBox = false` and skip
to **Best-Sellers-only** mode (Lane C provides the candidates; rank on scrape + Magnet
SV).

### Lane C — Amazon Best Sellers scrape (0 metered)

For each 1A URL, `navigate` and run this eval (validate selectors live — the
Best-Sellers DOM varies; adjust and stash+slice if the payload is large):

```js
(function(){
  function txt(el){ return (el&&el.textContent||'').replace(/\s+/g,' ').trim(); }
  function n(t){ const m=String(t||'').replace(/[$,]/g,'').match(/([\d.]+)/); return m?parseFloat(m[1]):null; }
  function rc(t){ const m=String(t||'').replace(/[(),]/g,'').match(/([\d.]+)\s*([KM])?/i); if(!m)return null; return Math.round(parseFloat(m[1])*(m[2]?(m[2].toUpperCase()==='K'?1e3:1e6):1)); }
  const out=[]; const seen=new Set();
  for(const el of document.querySelectorAll('[id^="gridItemRoot"], .zg-grid-general-faceout, [data-asin]')){
    const a=(el.getAttribute&&el.getAttribute('data-asin'))||(((el.querySelector('a[href*="/dp/"]')||{}).href||'').match(/\/dp\/([A-Z0-9]{10})/)||[])[1];
    if(!a||seen.has(a))continue; seen.add(a);
    const title=txt(el.querySelector('.p13n-sc-truncate, ._cDEzb_p13n-sc-css-line-clamp-3_g3dy1, a[href*="/dp/"] span'));
    if(!title)continue;
    const priceEl=el.querySelector('.a-price .a-offscreen, ._cDEzb_p13n-sc-price_3mJ9Z');
    const ratingEl=el.querySelector('.a-icon-alt');
    const rcEl=el.querySelector('.a-size-small, a[href*="#customerReviews"] span');
    out.push({ asin:a, title:title.slice(0,80), price:n(priceEl&&priceEl.textContent), rating:n(ratingEl&&ratingEl.textContent), reviewCount:rc(rcEl&&rcEl.textContent), source:'bsr' });
    if(out.length>=30)break;
  }
  return JSON.stringify(out);
})()
```

### Write candidates.json

Merge Black Box + Best-Sellers rows, **de-duplicate by ASIN** (prefer the Black Box
row's richer metrics), tag each `source:"blackbox"|"bsr"`, nullable metrics. Write to
`<run-dir>/candidates.json`.

## Phase 1C — Cluster & prune (0 metered)

Cluster **all** captured/cached rows (e.g. all ~200 — not just page 1), so
`totals.candidatesFound` = the real captured `count`. Group candidates into **niches**
at product-type granularity (e.g. "silicone stretch lids", not "kitchen"). Dedupe.
**Drop starter-unfriendly niches:**
- gated / restricted categories,
- brand- or IP-dominated (licensed characters; one brand owning the SERP),
- oversized / heavy (> ~2–3 lb),
- strongly seasonal,
- hazmat / electrical with warranty risk.

Keep the ~5–8 most promising niches for scoring.

## Phase 1D — Validate top niches with Magnet (≤ 2 metered)

For the top niches by preliminary score, confirm demand + rankability in **one batched
lookup**. `https://members.helium10.com/magnet` redirects to the shared Cerebro/Magnet
UI; click the **"Analyze Keywords"** tab (it accepts up to 200 keywords) and paste one
head term per niche (type each + `Return` to chip them, then click **Analyze Keywords** —
dismiss the autocomplete popup first, it covers the button; a page-level `.click()` on
the button is the reliable trigger). This one run = **1 metered action** (increment the
counter). Extract per keyword from the `[class*="datacy-row"]` grid using these
`[class*="datacy-tdcell<field>"]` cells:
- `phrase` → keyword
- `impressionExact30` → **searchVolume** (exact monthly)
- `iq` → **iqScore** (Cerebro IQ = searchVolume ÷ (competing/1000))
- `newCprExact` → **cpr** (units to reach page 1)
- `resultsNumber` → competing products (context)

Attach `searchVolume, iqScore, cpr` to each niche. **Validate the DOM live.** If a
metered action would exceed the cap, skip validation for the lower niches (rank them on
Black Box metrics alone) and note `H10 usage cap reached`.

## Phase 1E — Write niche-map.json + run score.mjs (0 metered)

**Do no arithmetic yourself.** Write a `<run-dir>/niche-map.json` capturing only your
**judgment**, then let `score.mjs` compute every number deterministically:

```json
{ "category": "…", "date": "YYYY-MM-DD",
  "criteria": { "minPrice":20, "minRevenue":5000, "maxReviews":500, "maxWeightLb":2, "minRatingGapAt":4.3 },
  "totals": { "candidatesFound":200, "blackBox":true, "blackBoxSource":"fresh|cache", "blackBoxCapturedAt":"…" },
  "h10LookupsUsed": 2,
  "niches": [
    { "niche":"Reusable beeswax bread bags & bakers",
      "why":"1–2 sentence, data-grounded rationale.",
      "asins":["B0F3C7NSQT","B0F2NTB9CF","B0DWHW39HH"],
      "keyword":"beeswax bread bag", "searchVolume":45418, "iqScore":45418, "cpr":81 }
  ] }
```
- `asins` — the products (from `candidates.json`) you clustered into this niche.
- `keyword`/`searchVolume`/`iqScore`/`cpr` — the head term + the Magnet metrics you read
  (nullable if not validated).
- `totals`/`h10LookupsUsed`/`criteria` — passed through unchanged.

Then write the helper (**the copy embedded in this file — see §score.mjs**) to
`<run-dir>/score.mjs` and run it (no repo download needed):
```bash
node "<run-dir>/score.mjs" "<run-dir>"
```
`score.mjs` looks each niche's `asins` up in `candidates.json`, computes the aggregates
(median revenue, price range, median reviews, avg weight), applies the **fixed-band
opportunity score** (demand 40% · rankability 40% · margin 20%; labels
**Strong ≥70 / Worth-testing 45–69 / Pass <45**), sorts, splits Top-3 `shortlist` +
`runnersUp`, and **writes `opportunities.js`**. The bands/weights are tunable constants at
the top of `score.mjs`; scores are deterministic (same inputs → same scores).

## Phase 1F — Report

`opportunities.js` was written by `score.mjs` in Phase 1E (`score.mjs` itself is written
from the copy embedded in this file — see §score.mjs — so **no repo download is needed**;
only the report template is fetched). Fetch the renderer on first run only, then serve
over http (fresh port) and open.

```bash
[ -f "<run-dir>/report.html" ] || curl -fsSL \
  https://raw.githubusercontent.com/AronLEEdev/product-opportunity-finder-skill/main/report-template.html \
  -o "<run-dir>/report.html"
python3 -m http.server 7910 --directory "<run-dir>" &
```

Navigate Chrome to `http://localhost:7910/report.html`. The template loads
`opportunities.js` via a `<script>` tag, so `file://` can't read it — serve over http.
**Verify with a DOM-count probe** (not screenshots):

```js
JSON.stringify({ opp: document.querySelectorAll('.opp').length,
  scores: [...document.querySelectorAll('.score')].map(e=>e.textContent),
  runnersUp: document.querySelectorAll('.ru-table tr').length })
```

Take **one** screenshot of the finished report to share.

### opportunities.js shape (`window.__DISCOVERY_DATA__`)

```js
window.__DISCOVERY_DATA__ = {
  category: "Home & Kitchen",
  date: "2026-07-02",
  criteria: { minPrice: 20, minRevenue: 5000, maxReviews: 500, maxWeightLb: 2, minRatingGapAt: 4.3 },
  totals: { candidatesFound: 200, nichesEvaluated: 8, blackBox: true,
            blackBoxSource: "fresh", blackBoxCapturedAt: "2026-07-02T12:00:00Z" },  // source: "fresh"|"cache"; h10LookupsUsed must equal ACTUAL metered actions (0 on a full cache hit)
  shortlist: [                       // Top 3, highest score first
    {
      niche: "Silicone stretch lids",
      score: 78, label: "Strong",
      why: "1–2 sentence, data-grounded rationale.",
      metrics: { medRevenue30d: 18000, medReviews: 320, medRating: 4.3, priceLow: 12.99, priceHigh: 24.99, searchVolume: 14000, avgWeightLb: 0.4 },
      exampleProducts: [ { asin: "B0...", title: "...", price: 21.99, revenue30d: 22000, reviewCount: 410, rating: 4.2, source: "blackbox" } ],
      nextSteps: { costSkillAsin: "B0...", reviewSkillKeyword: "silicone stretch lids" }
    }
  ],
  runnersUp: [ { niche: "...", score: 52, label: "Worth-testing" } ],   // ranks 4+
  h10LookupsUsed: 2
};
```

## score.mjs (write this to the run dir)

Phase 1E runs this helper to compute scores + emit `opportunities.js`. Write it
verbatim to `<run-dir>/score.mjs` (or fetch it from the repo). It has **no
dependencies** (Node ≥ 18 built-ins).

```js
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
```

> **Maintainers:** `score.mjs` + `score.test.mjs` in the repo are the tested source;
> this embed mirrors `score.mjs` verbatim. Edit `score.mjs`, run
> `node --test score.test.mjs`, then re-sync this block.

## Error handling (no-fallback)

- **Black Box unavailable / not on plan** → `totals.blackBox = false`; discover from the
  Best-Sellers scrape, rank on scrape metrics + Magnet SV; the report notes C-only.
- **Login wall / CAPTCHA** (Amazon or Helium 10) → stop, ask the user, then continue.
- **Cap reached** → skip remaining metered validation, rank on available data, note it.
- **Never fabricate** products, ASINs, revenue, reviews, ratings, weights, search
  volumes, or scores. A niche missing a metric leaves it `null` (renders as `N/A`).
- **Cache:** a corrupt / unreadable / older-than-14-day cache file → treat as a miss and
  overwrite it on the fresh pull; `mkdir -p` the cache dir first. A change to any filter
  (or category) yields a different `filterhash` → a fresh pull, never a mismatched reuse.
  Only real captured rows are written to the cache — never fabricate rows or a
  `capturedAt`.
