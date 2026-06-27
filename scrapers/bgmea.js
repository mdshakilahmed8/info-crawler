/**
 * BGMEA Factory List BIN Scraper
 * ================================
 * BGMEA publicly lists 4000+ garment factories with BIN numbers.
 *
 * Run standalone: node scrapers/bgmea.js
 * Output: output/bgmea_bins.csv
 */

const axios = require("axios");
const cheerio = require("cheerio");
const { createObjectCsvWriter } = require("csv-writer");
const fs = require("fs");
const path = require("path");

const BASE_URL = "https://www.bgmea.com.bd";
const LIST_URL = `${BASE_URL}/factorylist`;
const OUTPUT_DIR = path.join(__dirname, "..", "output");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "bgmea_bins.csv");
const DELAY_MS = 1500;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9,bn;q=0.8",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Validate BIN: 9-13 digits, not a phone number
function isValidBin(str) {
  const cleaned = str.replace(/[\s\-]/g, "");
  if (!/^\d{9,13}$/.test(cleaned)) return false;
  if (cleaned.startsWith("880")) return false; // +880 phone
  if (cleaned.length === 11 && cleaned.startsWith("01")) return false; // BD mobile
  if (new Set(cleaned).size === 1) return false; // all same digits
  return true;
}

function cleanDigits(str) {
  return str.replace(/[\s\-]/g, "");
}

// Extract BINs from HTML tables
function extractFromTable($) {
  const records = [];
  const tables = $("table");

  tables.each((_, table) => {
    const rows = $(table).find("tr").toArray().slice(1);

    for (const row of rows) {
      const cols = $(row)
        .find("td")
        .toArray()
        .map((td) => $(td).text().trim());

      if (cols.length < 3) continue;

      let binNumber = "";
      let companyName = "";

      // Find BIN column (pure digit match)
      for (const col of cols) {
        const cleaned = cleanDigits(col);
        if (isValidBin(cleaned)) {
          binNumber = cleaned;
          break;
        }
      }

      // Try regex inside cell text
      if (!binNumber) {
        for (const col of cols) {
          const match = col.match(/(?:BIN|VAT)[:\s]*(\d[\d\s\-]{7,15}\d)/i);
          if (match && isValidBin(cleanDigits(match[1]))) {
            binNumber = cleanDigits(match[1]);
            break;
          }
        }
      }

      if (!binNumber) continue;

      // Company name: first text-heavy column
      for (const col of cols) {
        if (col.length > 5 && !col.replace(/[\s\-]/g, "").match(/^\d+$/)) {
          companyName = col;
          break;
        }
      }

      records.push({
        company_name: companyName,
        bin_number: binNumber,
        address: cols.find((c) => c.length > 20 && c !== companyName) || "",
        source: "BGMEA",
      });
    }
  });

  return records;
}

// Extract from card/div layouts
function extractFromCards($) {
  const records = [];
  const cards = $("div").filter((_, el) => {
    const cls = ($(el).attr("class") || "").toLowerCase();
    return /factory|member|company|card|list-item/.test(cls);
  });

  cards.each((_, card) => {
    const text = $(card).text();
    const match = text.match(
      /(?:BIN|Business Identification|VAT)[^\d]{0,20}(\d{9,13})/i
    );
    if (match && isValidBin(match[1])) {
      const lines = $(card).text().trim().split("\n");
      records.push({
        company_name: lines[0]?.trim() || "Unknown",
        bin_number: match[1],
        address: "",
        source: "BGMEA",
      });
    }
  });

  return records;
}

// Extract from full page text (last resort)
function extractFromText($) {
  const records = [];
  const text = $("body").text();
  const regex = /(?:BIN|Business Identification|VAT)[^\d]{0,20}(\d{9,13})/gi;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (isValidBin(match[1])) {
      const start = Math.max(0, match.index - 150);
      const context = text.slice(start, match.index);
      const lines = context.split("\n").filter((l) => l.trim());
      records.push({
        company_name: lines[lines.length - 1]?.trim() || "Unknown",
        bin_number: match[1],
        address: "",
        source: "BGMEA",
      });
    }
  }

  return records;
}

// Check pagination
function hasNextPage($, currentPage) {
  const pagination = $(".pagination, nav[aria-label='pagination']");
  if (pagination.length) {
    const links = pagination.find("a");
    for (let i = 0; i < links.length; i++) {
      const href = $(links[i]).attr("href") || "";
      const text = $(links[i]).text().trim().toLowerCase();
      if (
        text === "next" ||
        text === "›" ||
        text === "»" ||
        href.includes(`page=${currentPage + 1}`)
      ) {
        return true;
      }
    }
  }
  if ($('a[rel="next"]').length) return true;
  return false;
}

async function scrapePage(url) {
  try {
    const { data } = await axios.get(url, {
      headers: HEADERS,
      timeout: 20000,
    });
    const $ = cheerio.load(data);

    let records = extractFromTable($);
    if (!records.length) records = extractFromCards($);
    if (!records.length) records = extractFromText($);

    return { records, $ };
  } catch (err) {
    console.log(`    Error fetching ${url}: ${err.message}`);
    return { records: [], $: null };
  }
}

async function run() {
  console.log("=".repeat(60));
  console.log("  BGMEA Factory List BIN Scraper");
  console.log("=".repeat(60));
  console.log();

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Test connection
  console.log("[*] Testing connection to BGMEA...");
  try {
    await axios.get(BASE_URL, { headers: HEADERS, timeout: 20000 });
    console.log("    Connected!\n");
  } catch (err) {
    console.log(`    FAILED: ${err.message}`);
    console.log("    Make sure you have internet access.");
    process.exit(1);
  }

  const allRecords = [];
  const seenBins = new Set();
  let page = 1;
  const maxPages = 300;

  while (page <= maxPages) {
    const url = `${LIST_URL}?page=${page}`;
    process.stdout.write(`[*] Page ${page}... `);

    const { records, $ } = await scrapePage(url);

    if (!records.length) {
      console.log("No records — stopping.");
      break;
    }

    // Deduplicate
    let newCount = 0;
    for (const rec of records) {
      if (!seenBins.has(rec.bin_number)) {
        seenBins.add(rec.bin_number);
        allRecords.push(rec);
        newCount++;
      }
    }

    console.log(`+${newCount} new BINs (total unique: ${allRecords.length})`);

    if ($ && !hasNextPage($, page)) {
      console.log("[*] No next page — done.");
      break;
    }

    page++;
    await sleep(DELAY_MS);
  }

  if (!allRecords.length) {
    console.log("\n[!] No records found. Site layout may have changed.");
    console.log("    Open https://www.bgmea.com.bd/factorylist in browser");
    console.log("    and check the HTML structure.");
    process.exit(1);
  }

  // Save to CSV
  const csvWriter = createObjectCsvWriter({
    path: OUTPUT_FILE,
    header: [
      { id: "company_name", title: "company_name" },
      { id: "bin_number", title: "bin_number" },
      { id: "address", title: "address" },
      { id: "source", title: "source" },
    ],
  });

  await csvWriter.writeRecords(allRecords);

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  DONE! Saved ${allRecords.length} unique BINs`);
  console.log(`  File: ${OUTPUT_FILE}`);
  console.log("=".repeat(60));

  return allRecords.length;
}

module.exports = { run };

if (require.main === module) {
  run().catch(console.error);
}
