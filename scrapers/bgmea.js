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
const OUTPUT_DIR = path.join(__dirname, "..", "output");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "bgmea_bins.csv");
const DELAY_MS = 1500;

// BGMEA changes their URLs periodically. We try multiple known patterns.
const CANDIDATE_LIST_URLS = [
  `${BASE_URL}/member/memberlist`,
  `${BASE_URL}/member-list`,
  `${BASE_URL}/factory-list`,
  `${BASE_URL}/factorylist`,
  `${BASE_URL}/members`,
  `${BASE_URL}/page/member-list`,
  `${BASE_URL}/page/factory-list`,
];

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

  // Check for --url flag (user can provide exact URL)
  const urlIdx = process.argv.indexOf("--url");
  let listUrl = urlIdx !== -1 && process.argv[urlIdx + 1]
    ? process.argv[urlIdx + 1]
    : null;

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

  // Auto-discover the correct list URL
  if (!listUrl) {
    console.log("[*] Discovering factory list URL...");

    // First, try to find links from the homepage
    try {
      const { data } = await axios.get(BASE_URL, { headers: HEADERS, timeout: 20000 });
      const $ = cheerio.load(data);
      $("a[href]").each((_, el) => {
        const href = $(el).attr("href") || "";
        const text = $(el).text().trim().toLowerCase();
        if (/factory|member|factory.list|member.list/.test(text) || /factory|member/.test(href)) {
          const fullUrl = href.startsWith("http") ? href : `${BASE_URL}${href.startsWith("/") ? "" : "/"}${href}`;
          if (!CANDIDATE_LIST_URLS.includes(fullUrl)) {
            CANDIDATE_LIST_URLS.unshift(fullUrl);
          }
          console.log(`    Found link: "${$(el).text().trim()}" -> ${fullUrl}`);
        }
      });
    } catch (err) {
      console.log(`    Could not parse homepage: ${err.message}`);
    }

    // Try each candidate URL
    for (const url of CANDIDATE_LIST_URLS) {
      try {
        const resp = await axios.get(url, { headers: HEADERS, timeout: 15000 });
        if (resp.status === 200) {
          const $ = cheerio.load(resp.data);
          const text = $("body").text().toLowerCase();
          // Check if page has factory/member content
          if (text.includes("bin") || text.includes("factory") || $("table").length > 0) {
            listUrl = url;
            console.log(`    SUCCESS: ${url}\n`);
            break;
          }
        }
      } catch (err) {
        // 404/500 etc - try next
      }
      await sleep(500);
    }

    if (!listUrl) {
      console.log("\n[!] Could not find the factory list URL automatically.");
      console.log("    Open https://www.bgmea.com.bd in your browser,");
      console.log("    find the 'Member List' or 'Factory List' page,");
      console.log("    then run:");
      console.log("    node scrapers/bgmea.js --url <the_url>\n");
      process.exit(1);
    }
  } else {
    console.log(`[*] Using provided URL: ${listUrl}\n`);
  }

  const allRecords = [];
  const seenBins = new Set();
  let page = 1;
  const maxPages = 300;

  while (page <= maxPages) {
    // Try different pagination patterns
    const pageUrl = listUrl.includes("?")
      ? `${listUrl}&page=${page}`
      : `${listUrl}?page=${page}`;
    process.stdout.write(`[*] Page ${page}... `);

    const { records, $ } = await scrapePage(pageUrl);

    // If page=1 gives 404, try without ?page=
    if (!records.length && page === 1) {
      console.log("trying base URL...");
      const base = await scrapePage(listUrl);
      if (base.records.length) {
        let n = 0;
        for (const r of base.records) {
          if (!seenBins.has(r.bin_number)) { seenBins.add(r.bin_number); allRecords.push(r); n++; }
        }
        console.log(`[*] Page 1 (base)... +${n} new BINs (total unique: ${allRecords.length})`);
        page++;
        await sleep(DELAY_MS);
        continue;
      }
    }

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
