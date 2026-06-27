# Bangladesh BIN Crawler (Node.js)

Bangladesh NBR **Business Identification Number (BIN)** collector.

## Current Status (June 2026)

| Source | Status | Notes |
|--------|--------|-------|
| BGMEA | Not working | Member list no longer shows BIN numbers |
| BIDA | Not working | SSL certificate expired |
| **NBR (vat.gov.bd)** | **Best option** | Needs API URL from browser DevTools |

## Quick Start

```bash
npm install
```

## NBR BIN Verification (Recommended)

This is the **most reliable** approach — directly queries the government VAT database.

### Step 1: Find the API URL

1. Open **https://vat.gov.bd** in Chrome
2. Find the BIN verification / search page
3. Press **F12 → Network tab** (filter: XHR/Fetch)
4. Search for any BIN number on the site
5. Copy the **Request URL** from the Network tab

### Step 2: Run

```bash
# GET method (most common)
node scrapers/nbr-bin-verify.js --api "https://vat.gov.bd/api/..." --target 1000

# POST method (if the site uses POST)
node scrapers/nbr-bin-verify.js --api "THE_URL" --method POST --target 1000
```

### Options

```
--api <url>       API endpoint URL (REQUIRED)
--start <num>     Start number (default: 1)
--end <num>       End number (default: 9999999)
--target <num>    Stop after N valid BINs (default: 1000)
--method GET|POST Request method (default: GET)
--field <name>    JSON field name for BIN in POST body (default: bin)
```

### Features
- Sequential brute-force: checks 000000001, 000000002, ...
- Resumable: re-running continues from where it stopped
- Smart skip: jumps ahead after 500 consecutive misses
- Rate limit aware: backs off on HTTP 429

## Other Scrapers (currently broken)

```bash
# BGMEA (not showing BINs anymore)
node scrapers/bgmea.js --url "https://www.bgmea.com.bd/page/member-list"

# BIDA (SSL expired)
node scrapers/bida.js --url "https://bida.gov.bd/..."
```

## Output

```
output/
├── nbr_bins.csv           ← NBR verified BINs (best)
├── bgmea_bins.csv         ← BGMEA (if working)
├── bida_bins.csv          ← BIDA (if working)
└── all_bins_combined.csv  ← Merged
```

## Alternative: Official Request

If vat.gov.bd doesn't have a public API, the most reliable path is:
- Submit a formal request to **NBR (National Board of Revenue)** for bulk BIN data
- Your government department can request database access through official channels
