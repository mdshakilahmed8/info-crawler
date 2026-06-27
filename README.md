# Bangladesh BIN Crawler (Node.js)

Bangladesh NBR **Business Identification Number (BIN)** collector from BGMEA & BIDA public data.

## Quick Start

```bash
npm install
node index.js
```

## Run individually

```bash
npm run bgmea    # Only BGMEA factories
npm run bida     # Only BIDA companies
```

## Output

```
output/
├── bgmea_bins.csv         # BGMEA factory list BINs
├── bida_bins.csv          # BIDA registered company BINs
└── all_bins_combined.csv  # Merged & de-duplicated
```

## If BIDA doesn't work automatically

```bash
node scrapers/bida.js --url "https://bida.gov.bd/the-actual-page"
```

## Expected Results

| Source | BINs | Notes |
|--------|------|-------|
| BGMEA | 3000-5000 | Garment factories |
| BIDA | 1000-3000 | Registered investment projects |
| **Total** | **4000+** | De-duplicated |
