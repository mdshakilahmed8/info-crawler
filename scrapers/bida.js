/**
 * BIDA Registered Companies BIN Scraper
 * ========================================
 * BIDA maintains a registry of registered investment projects / companies.
 *
 * Run standalone: node scrapers/bida.js
 * With custom URL: node scrapers/bida.js --url https://bida.gov.bd/...
 * Output: output/bida_bins.csv
 */

const axios = require("axios");
const cheerio = require("cheerio");
const { createObjectCsvWriter } = require("csv-writer");
const fs = require("fs");
const path = require("path");

const OUTPUT_DIR = path.join(__dirname, "..", "output");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "bida_bins.csv");
const DELAY_MS = 1500;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9,bn;q=0.8",
};

const BIDA_CANDIDATE_URLS = [
  "https://bida.gov.bd/registered-companies",
  "https://bida.gov.bd/registered-company",
  "https://bida.gov.bd/company-list",
  "https://bida.gov.bd/industrial-units",
  "https://bida.gov.bd/registered-projects",
  "https://oss.bida.gov.bd/api/companies",
  "https://oss.bida.gov.bd/registered-projects",
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isValidBin(str) {
  const cleaned = str.replace(/[\s\-]/g, "");
  if (!/^\d{9,13}$/.test(cleaned)) return false;
  if (cleaned.startsWith("880")) return false;
  if (cleaned.length === 11 && cleaned.startsWith("01")) return false;
  if (new Set(cleaned).size === 1) return false;
  return true;
}

function cleanDigits(str) {
  return str.replace(/[\s\-]/g, "");
}

// Parse JSON API response
function parseJsonResponse(data) {
  const records = [];
  let items = [];

  if (Array.isArray(data)) {
    items = data;
  } else if (data && typeof data === "object") {
    for (const key of ["data", "results", "companies", "items", "records"]) {
      if (Array.isArray(data[key])) {
        items = data[key];
        break;
      }
    }
  }

  for (const item of items) {
    if (!item || typeof item !== "object") continue;

    let binNumber = "";
    const binFields = [
      "bin", "bin_no", "bin_number", "business_identification_number",
      "vat_no", "vat_number", "registration_no",
    ];
    for (const field of binFields) {
      if (item[field]) {
        const val = String(item[field]).trim();
        if (isValidBin(val)) {
          binNumber = cleanDigits(val);
          break;
        }
      }
    }

    if (!binNumber) continue;

    let companyName = "";
    for (const field of ["name", "company_name", "company", "organization", "project_name", "factory_name"]) {
      if (item[field]) {
        companyName = String(item[field]).trim();
        break;
      }
    }

    let address = "";
    for (const field of ["address", "location", "district", "area"]) {
      if (item[field]) {
        address = String(item[field]).trim();
        break;
      }
    }

    records.push({
      company_name: companyName,
      bin_number: binNumber,
      address,
      source: "BIDA",
    });
  }

  return records;
}

// Extract from HTML tables
function extractFromTable($) {
  const records = [];
  const tables = $("table");

  tables.each((_, table) => {
    const headerCols = $(table)
      .find("tr")
      .first()
      .find("th, td")
      .toArray()
      .map((el) => $(el).text().trim().toLowerCase());

    let binCol = -1;
    let nameCol = -1;
    headerCols.forEach((h, i) => {
      if (/bin|vat|registration|নিবন্ধন/.test(h)) binCol = i;
      if (/name|company|factory|নাম/.test(h)) nameCol = i;
    });

    const rows = $(table).find("tr").toArray().slice(1);
    for (const row of rows) {
      const cols = $(row)
        .find("td")
        .toArray()
        .map((td) => $(td).text().trim());
      if (cols.length < 3) continue;

      let binNumber = "";

      if (binCol >= 0 && binCol < cols.length) {
        const cleaned = cleanDigits(cols[binCol]);
        if (isValidBin(cleaned)) binNumber = cleaned;
      }

      if (!binNumber) {
        for (const col of cols) {
          const cleaned = cleanDigits(col);
          if (isValidBin(cleaned)) {
            binNumber = cleaned;
            break;
          }
        }
      }

      if (!binNumber) continue;

      let companyName = "";
      if (nameCol >= 0 && nameCol < cols.length) {
        companyName = cols[nameCol];
      } else {
        for (const col of cols) {
          if (col.length > 5 && !col.replace(/[\s\-]/g, "").match(/^\d+$/)) {
            companyName = col;
            break;
          }
        }
      }

      records.push({
        company_name: companyName,
        bin_number: binNumber,
        address: "",
        source: "BIDA",
      });
    }
  });

  return records;
}

// Extract from full page text
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
        source: "BIDA",
      });
    }
  }

  return records;
}

async function scrapePage(url) {
  try {
    const { data, headers: respHeaders } = await axios.get(url, {
      headers: HEADERS,
      timeout: 20000,
    });

    const contentType = respHeaders["content-type"] || "";

    // JSON API response
    if (contentType.includes("json") || typeof data === "object") {
      return parseJsonResponse(data);
    }

    // HTML page
    const $ = cheerio.load(data);
    let records = extractFromTable($);
    if (!records.length) records = extractFromText($);
    return records;
  } catch (err) {
    return [];
  }
}

async function scrapePaginated(baseUrl, maxPages = 200) {
  const allRecords = [];
  const seenBins = new Set();

  for (let page = 1; page <= maxPages; page++) {
    const urls = [
      `${baseUrl}?page=${page}`,
      `${baseUrl}&page=${page}`,
      `${baseUrl}/${page}`,
    ];

    let found = false;
    for (const url of urls) {
      const records = await scrapePage(url);
      if (records.length) {
        let newCount = 0;
        for (const rec of records) {
          if (!seenBins.has(rec.bin_number)) {
            seenBins.add(rec.bin_number);
            allRecords.push(rec);
            newCount++;
          }
        }
        if (newCount > 0) {
          console.log(`    Page ${page}: +${newCount} (total: ${allRecords.length})`);
        }
        found = true;
        await sleep(DELAY_MS);
        break;
      }
    }

    if (!found && page > 1) break;
  }

  return allRecords;
}

async function discoverBidaPages() {
  console.log("[*] Discovering BIDA site structure...");
  try {
    const { data } = await axios.get("https://bida.gov.bd", {
      headers: HEADERS,
      timeout: 20000,
    });
    const $ = cheerio.load(data);
    const candidateUrls = [];

    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") || "";
      const text = $(el).text().trim().toLowerCase();
      if (/company|register|project|industrial/.test(text)) {
        const fullUrl = href.startsWith("http")
          ? href
          : `https://bida.gov.bd${href}`;
        candidateUrls.push(fullUrl);
        console.log(`    Found: "${text}" -> ${fullUrl}`);
      }
    });

    if (candidateUrls.length) return candidateUrls;
  } catch (err) {
    console.log(`    Could not reach bida.gov.bd: ${err.message}`);
  }

  return BIDA_CANDIDATE_URLS;
}

async function run() {
  console.log("=".repeat(60));
  console.log("  BIDA Registered Companies BIN Scraper");
  console.log("=".repeat(60));
  console.log();

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Check for --url flag
  const urlIdx = process.argv.indexOf("--url");
  let customUrl = null;
  if (urlIdx !== -1 && process.argv[urlIdx + 1]) {
    customUrl = process.argv[urlIdx + 1];
  }

  let allRecords = [];

  if (customUrl) {
    console.log(`[*] Using provided URL: ${customUrl}\n`);
    allRecords = await scrapePaginated(customUrl);
  } else {
    const urls = await discoverBidaPages();
    console.log(`\n[*] Trying ${urls.length} candidate URLs...\n`);

    for (const url of urls) {
      console.log(`  Trying: ${url}`);
      const records = await scrapePage(url);
      if (records.length) {
        console.log(`    SUCCESS! Found ${records.length} records.`);
        const more = await scrapePaginated(url);
        allRecords = more.length > records.length ? more : records;
        break;
      }
      await sleep(DELAY_MS);
    }
  }

  if (!allRecords.length) {
    console.log("\n[!] Could not find BIN data automatically.");
    console.log("\n    MANUAL STEPS:");
    console.log("    1. Open https://bida.gov.bd in Chrome");
    console.log("    2. Navigate to the registered companies/projects page");
    console.log("    3. Copy the URL from the address bar");
    console.log("    4. Run: node scrapers/bida.js --url <paste_url_here>");
    console.log("\n    OR if BIDA has an API:");
    console.log("    1. Open Chrome DevTools (F12) -> Network tab");
    console.log("    2. Navigate the company list");
    console.log("    3. Look for XHR/Fetch requests returning JSON");
    console.log("    4. Copy that API URL and use --url flag");
    process.exit(1);
  }

  // Deduplicate
  const seenBins = new Set();
  const unique = allRecords.filter((r) => {
    if (seenBins.has(r.bin_number)) return false;
    seenBins.add(r.bin_number);
    return true;
  });

  // Save
  const csvWriter = createObjectCsvWriter({
    path: OUTPUT_FILE,
    header: [
      { id: "company_name", title: "company_name" },
      { id: "bin_number", title: "bin_number" },
      { id: "address", title: "address" },
      { id: "source", title: "source" },
    ],
  });

  await csvWriter.writeRecords(unique);

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  DONE! Saved ${unique.length} unique BINs`);
  console.log(`  File: ${OUTPUT_FILE}`);
  console.log("=".repeat(60));

  return unique.length;
}

module.exports = { run };

if (require.main === module) {
  run().catch(console.error);
}
