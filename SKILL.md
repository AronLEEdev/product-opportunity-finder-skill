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
| `niches.json` | Phase 1C–1E | clustered niches + aggregated metrics + validation + score |
| `opportunities.js` | Phase 1F | `window.__DISCOVERY_DATA__ = {...}` — loaded by the template |
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

### Lane A — Helium 10 Black Box (1 metered)

In the logged-in Chrome, `navigate` to `https://members.helium10.com/black-box`
(Products tab). Apply filters where the UI supports them:
- **Price ≥ 20**
- **Monthly revenue ≥ 5000**
- **Review count ≤ 500** (low barrier to entry)
- **Weight ≤ 2 lb** (low FBA fees, starter-friendly)
- Category = the target category

**Run the search once** — this is the **1 metered action** (increment the counter).
**Validate the Black Box SPA DOM live** before extracting (filter inputs, the run/apply
trigger, the results grid — it is a virtualized table). Drive with `browser_batch`;
stash the results (`window.__BB = […]`) and read them back in slices; return only
trimmed rows. Extract per product: `asin, title, price, revenue30d, units30d,
reviewCount, rating, bsr, weightLb`.

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

Group candidates into **niches** at product-type granularity (e.g. "silicone stretch
lids", not "kitchen"). Dedupe. **Drop starter-unfriendly niches:**
- gated / restricted categories,
- brand- or IP-dominated (licensed characters; one brand owning the SERP),
- oversized / heavy (> ~2–3 lb),
- strongly seasonal,
- hazmat / electrical with warranty risk.

Keep the ~5–8 most promising niches for scoring.

## Phase 1D — Validate top niches with Magnet (≤ 2 metered)

For the top niches by preliminary score, confirm search demand with **one batched
Magnet lookup** (`https://members.helium10.com/magnet`) on the niche head terms →
attach `searchVolume` per niche (increment the counter). Black Box already supplies
price / revenue / reviews. **Validate the Magnet SPA DOM live.** If a metered action
would exceed the cap, skip validation for the lower niches (rank them on Black Box
metrics alone) and note `H10 usage cap reached`.

## Phase 1E — Score & rank (0 metered)

Per niche compute an **opportunity score 0–100** = a weighted blend of:
- **Demand** — median top-listing `revenue30d` and/or niche `searchVolume` (higher better),
- **Low competition** — lower median `reviewCount` of the niche's top listings is better
  (bonus when several are < 100),
- **Margin fit** — price ≥ $20 and light weight (low FBA),
- **Rating gap** — top listings ≤ 4.3 (differentiation room).

Label: **Strong (≥ 70) / Worth-testing (45–69) / Pass (< 45)**. Take the **Top 3** by
score into `shortlist`; ranks 4+ go to `runnersUp`. Aggregate each niche's `metrics`
object (`medRevenue30d, medReviews, medRating, priceLow, priceHigh, searchVolume,
avgWeightLb`) and pick 2–3 real `exampleProducts`. Write `<run-dir>/niches.json`.

## Phase 1F — Report

Fetch the renderer from the repo on first run only; write `opportunities.js`; serve over
http (fresh port); open.

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
  totals: { candidatesFound: 140, nichesEvaluated: 7, blackBox: true },
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

## Error handling (no-fallback)

- **Black Box unavailable / not on plan** → `totals.blackBox = false`; discover from the
  Best-Sellers scrape, rank on scrape metrics + Magnet SV; the report notes C-only.
- **Login wall / CAPTCHA** (Amazon or Helium 10) → stop, ask the user, then continue.
- **Cap reached** → skip remaining metered validation, rank on available data, note it.
- **Never fabricate** products, ASINs, revenue, reviews, ratings, weights, search
  volumes, or scores. A niche missing a metric leaves it `null` (renders as `N/A`).
