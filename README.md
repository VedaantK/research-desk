# Atlas research desk

[![Site checks](https://github.com/VedaantK/research-desk/actions/workflows/ci.yml/badge.svg)](https://github.com/VedaantK/research-desk/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Live site: <https://vedaantk.github.io/research-desk/>**

Every systematic strategy I've tested, published with the same detail whether it worked or
not. The results come from **Atlas**, an autonomous research loop, running on
**Horizon**, a backtester that only accepts a result when three independent engines agree.

## How a strategy gets here

1. **Idea → spec → code.** A plain-English hypothesis is formalized by Claude into a spec;
   Codex writes the strategy code. Model-written code runs only in a sandbox.
2. **Three engines must agree.** Every backtest runs through a plain-Python reference
   engine, vectorbt and Nautilus Trader. Fills, positions, cash and equity must reconcile
   or the run is rejected.
3. **Honest data.** CRSP daily returns with delisting returns kept, point-in-time S&P 500
   membership (no survivorship bias), Compustat fundamentals only after their report date,
   trading costs and square-root market impact on every trade.
4. **Rules fixed in advance.** Gates (Sharpe, drawdown, factor-alpha t-stat, cost stress,
   nearby-parameter robustness) and a trial budget are registered before the first run.
   AI reviewers propose improvements for up to two rounds.
5. **One-shot holdout.** A version that clears the gates on research data gets a sealed
   holdout period, opened once. Spent holdout years can't be reused by later ideas.
6. **Attribution.** Results are regressed on Fama-French five factors plus momentum, so a
   strategy that is just a known factor shows up as one.

## What's on the site

| Page | What |
|---|---|
| [Research desk](https://vedaantk.github.io/research-desk/) | Every experiment with its verdict, equity curve against the S&P 500, yearly returns, gates and factor exposures; live paper portfolio |
| [Research notes](https://vedaantk.github.io/research-desk/notes.html) | Fixed studies run on data sealed at the end of 2019, every result reported |
| [Note 001: annual value → profitability](https://vedaantk.github.io/research-desk/annual.html) | US stocks outside the S&P 500: every run, the component controls, and why nothing advanced |
| [Note 002: small caps](https://vedaantk.github.io/research-desk/smallcaps.html) | Five 20-name small-cap strategies with strong published evidence; all five failed |
| [Updates](https://vedaantk.github.io/research-desk/updates.html) | Plain-English build notes: what was tested, what changed, what's next |

Most ideas fail, and the site says so. That record is the point: it shows how often a
plausible strategy looks good before a fair test and doesn't after.

## How it's built

The site is static HTML/CSS/JS with [ECharts](https://echarts.apache.org/) and no build
step. A machine running the research loop regenerates the JSON files and pushes them here
every 15 minutes when results change; GitHub Pages serves `main`.

| File | Contents |
|---|---|
| `data.json` | Experiments, versions, metrics, equity curves, gates, paper portfolio |
| `annual-data.json`, `controls-data.json`, `annual-review.json` | Research note 001 |
| `index.html`, `site.js`, `site.css`, `theme.js` | Main page, charts and light/dark theme |

CI (`.github/scripts/check_site.py`) checks on every push that the data parses and isn't
empty, that every referenced file exists, and that no security identifiers (PERMNO,
GVKEY, CUSIP) were published.

## Data and licensing

Only portfolio-level aggregates are published: equity curves, yearly returns and summary
statistics. No backtest holdings, fills or security-level data from CRSP or Compustat,
which are licensed through WRDS. The site code is [MIT](LICENSE) licensed; the results
data is published for reading and is not licensed for reuse.

Backtested, hypothetical results. This is not investment advice.
