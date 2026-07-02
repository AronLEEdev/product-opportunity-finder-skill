# product-opportunity-finder-skill

A Claude skill that turns a broad Amazon **category** into a ranked **Top-3
product-opportunity shortlist** — the front of an FBA product-research funnel.

Given a category (e.g. `Home & Kitchen`, `Pet Supplies`), it drives the user's
logged-in Chrome via the **Claude-in-Chrome MCP** to:

1. **Discover real products** — **Helium 10 Black Box** filtered by price ≥ $20,
   monthly revenue, review count, and weight (the primary lane), enriched by scraping
   Amazon's own **Best Sellers / Movers & Shakers / New Releases** pages.
2. **Cluster** the results into product niches and prune starter-unfriendly ones
   (gated, brand/IP-dominated, oversized, seasonal).
3. **Validate demand** on the top niches with one **Magnet** keyword lookup.
4. **Score** each niche 0–100 (demand × low competition × margin fit × rating gap) and
   label it **Strong / Worth-testing / Pass**.
5. **Render** a static HTML report: the Top-3 shortlist (with metrics, example products,
   and next-step hand-offs) plus a runners-up table.

**Data-driven, never invented.** The LLM does not brainstorm random products — every
candidate and metric comes from real Black Box / Amazon data. Niches with no data for a
metric show `N/A`; nothing is fabricated.

**Front of the funnel.** Each shortlisted niche ends with a hand-off to the companion
skills — [`product-cost-analyze-skill`](https://github.com/AronLEEdev/product-cost-analyze-skill)
(is it profitable?) and
[`product-review-analyze-skill`](https://github.com/AronLEEdev/product-review-analyze-skill)
(what do buyers want?). Wiring those to auto-run is future work; for now the report
prints the exact ASIN + keyword to feed each.

## Preconditions

| Requirement | Required? |
|---|---|
| Chrome + Claude-in-Chrome MCP, connected | ✅ |
| **Amazon** account, logged in | ✅ |
| **Helium 10 with Black Box** (Platinum+) | recommended (degrades to Best-Sellers-only) |
| Python 3 (or any static server) | ✅ |

## Helium 10 usage cap

Metered Helium 10 lookups (Black Box, Magnet) are **capped at 3 per run** (default: 1
Black Box + 1 Magnet). Scraping Amazon Best Sellers and an open Xray overlay are free.
The report footer shows `H10 lookups used: N/3`.

## Install & packaging

Install the single **`SKILL.md`**. At run time the skill fetches `report-template.html`
from this repo (raw URL) and writes the run's data files (`candidates.json`,
`niches.json`, `opportunities.js`) into the run directory; the report is served over
http (the template loads its data via a `<script>` tag, which `file://` can't read).

## Files

```
SKILL.md              # ← the only file end users need
report-template.html  # Phase-1 report renderer; fetched from main at run time
sample/opportunities.sample.js   # fixture for verifying the template
LICENSE               # MIT
```
