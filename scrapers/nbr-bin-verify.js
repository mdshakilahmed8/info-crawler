/**
 * NBR BIN Verification Scraper
 * ==============================
 * Uses the NBR (National Board of Revenue) VAT system to verify and collect
 * valid Business Identification Numbers by checking sequential numbers.
 *
 * IMPORTANT: You need to find the actual API endpoint first!
 * 
 * Steps:
 *   1. Open https://vat.gov.bd in Chrome
 *   2. Find the BIN verification / search page
 *   3. Press F12 -> Network tab
 *   4. Search for a BIN number
 *   5. Copy the API URL that gets hit
 *   6. Run: node scrapers/nbr-bin-verify.js --api "THE_API_URL"
 *
 * Output: output/nbr_bins.csv
 */

const axios = require("axios");
const { createObjectCsvWriter } = require("csv-writer");
const fs = require("fs");
const path = require("path");

const OUTPUT_DIR = path.join(__dirname, "..", "output");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "nbr_bins.csv");
const DELAY_MS = 500; // half second between requests (be polite)

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json, text/html, */*",
  "Accept-Language": "en-US,en;q=0.9,bn;q=0.8",
};

// Known NBR/VAT endpoints to try (update these based on your F12 findings)
const KNOWN_ENDPOINTS = [
  "https://vat.gov.bd/api/bin/verify",
  "https://vat.gov.bd/vatonline/api/bin-verify",
  "https://vat.gov.bd/vatonline/api/search/bin",
  "https://nbr.gov.bd/api/bin/search",
  "https://etaxnbr.gov.bd/api/bin/verify",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs() {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === "--api" && process.argv[i + 1]) {
      args.api = process.argv[++i];
    } else if (process.argv[i] === "--start" && process.argv[i + 1]) {
      args.start = parseInt(process.argv[++i]);
    } else if (process.argv[i] === "--end" && process.argv[i + 1]) {
      args.end = parseInt(process.argv[++i]);
    } else if (process.argv[i] === "--target" && process.argv[i + 1]) {
      args.target = parseInt(process.argv[++i]);
    } else if (process.argv[i] === "--method" && process.argv[i + 1]) {
      args.method = process.argv[++i].toUpperCase();
    } else if (process.argv[i] === "--field" && process.argv[i + 1]) {
      args.field = process.argv[++i]; // JSON field name for BIN in request body
    }
  }
  return args;
}

// Load existing BINs for resume capability
function loadExisting() {
  if (!fs.existsSync(OUTPUT_FILE)) return new Set();
  const content = fs.readFileSync(OUTPUT_FILE, "utf-8");
  const lines = content.split("\n").slice(1);
  const bins = new Set();
  for (const line of lines) {
    const bin = (line.split(",")[0] || "").trim().replace(/"/g, "");
    if (bin) bins.add(bin);
  }
  return bins;
}

async function tryVerifyBin(apiUrl, binNumber, method = "GET", field = "bin") {
  try {
    let resp;
    if (method === "POST") {
      resp = await axios.post(
        apiUrl,
        { [field]: binNumber },
        { headers: { ...HEADERS, "Content-Type": "application/json" }, timeout: 10000 }
      );
    } else {
      // Try different GET patterns
      const urls = [
        `${apiUrl}?bin=${binNumber}`,
        `${apiUrl}?q=${binNumber}`,
        `${apiUrl}/${binNumber}`,
      ];
      for (const url of urls) {
        try {
          resp = await axios.get(url, { headers: HEADERS, timeout: 10000 });
          if (resp.status === 200) break;
        } catch (e) {
          continue;
        }
      }
    }

    if (!resp || resp.status !== 200) return null;

    const data = resp.data;
    if (!data) return null;

    // Check if response indicates a valid BIN
    // Different APIs return different structures
    if (typeof data === "object") {
      // Check for success indicators
      const isValid =
        data.success === true ||
        data.status === "valid" ||
        data.status === "active" ||
        data.found === true ||
        data.data != null ||
        data.name != null ||
        data.company_name != null ||
        data.taxpayer_name != null;

      if (isValid || (data.name && data.name.length > 1)) {
        return {
          bin_number: binNumber,
          company_name:
            data.name ||
            data.company_name ||
            data.taxpayer_name ||
            data.organization_name ||
            (data.data && data.data.name) ||
            "",
          address:
            data.address ||
            data.location ||
            (data.data && data.data.address) ||
            "",
          status: data.status || "active",
        };
      }
    }

    return null;
  } catch (err) {
    if (err.response && err.response.status === 404) return null; // not found = invalid BIN
    if (err.response && err.response.status === 429) {
      console.log("\n    Rate limited! Waiting 30s...");
      await sleep(30000);
      return "retry";
    }
    return null;
  }
}

async function run() {
  console.log("=".repeat(60));
  console.log("  NBR BIN Verification Scraper");
  console.log("=".repeat(60));
  console.log();

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const args = parseArgs();
  const apiUrl = args.api;
  const startNum = args.start || 1;
  const endNum = args.end || 9999999;
  const target = args.target || 1000;
  const method = args.method || "GET";
  const field = args.field || "bin";

  if (!apiUrl) {
    console.log("  ERROR: No API URL provided!\n");
    console.log("  HOW TO FIND THE API URL:");
    console.log("  1. Open https://vat.gov.bd in Chrome");
    console.log("  2. Press F12 -> Network tab");
    console.log("  3. Search/verify a BIN number on the site");
    console.log("  4. In Network tab, find the XHR request");
    console.log("  5. Copy the Request URL\n");
    console.log("  THEN RUN:");
    console.log("  node scrapers/nbr-bin-verify.js --api \"https://vat.gov.bd/api/...\"");
    console.log("\n  OPTIONS:");
    console.log("  --api <url>       API endpoint URL (REQUIRED)");
    console.log("  --start <num>     Start number (default: 1)");
    console.log("  --end <num>       End number (default: 9999999)");
    console.log("  --target <num>    Stop after N valid BINs (default: 1000)");
    console.log("  --method GET|POST Request method (default: GET)");
    console.log("  --field <name>    JSON field name for BIN (default: bin)");

    // Try known endpoints
    console.log("\n  Trying known endpoints...");
    for (const endpoint of KNOWN_ENDPOINTS) {
      try {
        const resp = await axios.get(endpoint, { headers: HEADERS, timeout: 5000 });
        console.log(`    ${endpoint} -> HTTP ${resp.status} (might work!)`);
      } catch (err) {
        const status = err.response ? err.response.status : "timeout";
        console.log(`    ${endpoint} -> ${status}`);
      }
    }

    process.exit(1);
  }

  console.log(`  API: ${apiUrl}`);
  console.log(`  Method: ${method}`);
  console.log(`  Range: ${startNum} to ${endNum} (9-digit padded)`);
  console.log(`  Target: ${target} valid BINs`);
  console.log();

  // Resume
  const existing = loadExisting();
  console.log(`  Resuming: ${existing.size} BINs already collected.\n`);

  let found = existing.size;
  let checked = 0;
  let consecutive_fails = 0;

  // Open CSV in append mode
  const writeHeader = !fs.existsSync(OUTPUT_FILE) || fs.statSync(OUTPUT_FILE).size === 0;
  const csvStream = fs.createWriteStream(OUTPUT_FILE, { flags: "a" });
  if (writeHeader) {
    csvStream.write("bin_number,company_name,address,status\n");
  }

  for (let i = startNum; i <= endNum && found < target; i++) {
    const binNumber = String(i).padStart(9, "0"); // 9-digit zero-padded

    if (existing.has(binNumber)) continue;

    const result = await tryVerifyBin(apiUrl, binNumber, method, field);

    if (result === "retry") {
      i--; // retry same number
      continue;
    }

    checked++;

    if (result) {
      found++;
      consecutive_fails = 0;
      existing.add(binNumber);

      const name = (result.company_name || "").replace(/,/g, ";");
      const addr = (result.address || "").replace(/,/g, ";");
      csvStream.write(`${binNumber},${name},${addr},${result.status}\n`);

      console.log(`  [${found}/${target}] FOUND: ${binNumber} -> ${result.company_name || "N/A"}`);
    } else {
      consecutive_fails++;
      if (checked % 100 === 0) {
        process.stdout.write(`  Checked ${checked} | Found ${found} | Current: ${binNumber}\r`);
      }
    }

    // If we hit 500 consecutive fails in a row, skip ahead
    if (consecutive_fails >= 500) {
      console.log(`\n  500 consecutive misses at ${binNumber}, skipping ahead 1000...`);
      i += 1000;
      consecutive_fails = 0;
    }

    await sleep(DELAY_MS);
  }

  csvStream.end();

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  DONE! Total valid BINs: ${found}`);
  console.log(`  Checked: ${checked} numbers`);
  console.log(`  File: ${OUTPUT_FILE}`);
  console.log("=".repeat(60));

  return found;
}

module.exports = { run };

if (require.main === module) {
  run().catch(console.error);
}
