/**
 * Bangladesh BIN Collector — BGMEA + BIDA Combined
 * ==================================================
 * Usage:
 *   npm install
 *   node index.js
 *
 * Output: output/all_bins_combined.csv
 */

const fs = require("fs");
const path = require("path");
const { createObjectCsvWriter } = require("csv-writer");

const OUTPUT_DIR = path.join(__dirname, "output");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "all_bins_combined.csv");

async function main() {
  console.log("=".repeat(60));
  console.log("  Bangladesh BIN Collector — BGMEA + BIDA");
  console.log("=".repeat(60));
  console.log();

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Run BGMEA
  console.log("\n" + "#".repeat(60));
  console.log("  Step 1: BGMEA Factory List");
  console.log("#".repeat(60) + "\n");

  let bgmeaCount = 0;
  try {
    const bgmea = require("./scrapers/bgmea");
    bgmeaCount = await bgmea.run();
  } catch (err) {
    console.log(`  BGMEA failed: ${err.message}`);
  }

  // Run BIDA
  console.log("\n" + "#".repeat(60));
  console.log("  Step 2: BIDA Registered Companies");
  console.log("#".repeat(60) + "\n");

  let bidaCount = 0;
  try {
    const bida = require("./scrapers/bida");
    bidaCount = await bida.run();
  } catch (err) {
    console.log(`  BIDA failed: ${err.message}`);
  }

  // Merge CSVs
  console.log("\n" + "=".repeat(60));
  console.log("  Merging results...");
  console.log("=".repeat(60) + "\n");

  const allBins = new Map();

  for (const [file, source] of [["bgmea_bins.csv", "BGMEA"], ["bida_bins.csv", "BIDA"]]) {
    const fp = path.join(OUTPUT_DIR, file);
    if (!fs.existsSync(fp)) continue;
    const lines = fs.readFileSync(fp, "utf-8").split("\n").slice(1);
    for (const line of lines) {
      if (!line.trim()) continue;
      const parts = line.split(",");
      const bin = (parts[1] || "").trim().replace(/"/g, "");
      if (bin && !allBins.has(bin)) {
        allBins.set(bin, {
          bin_number: bin,
          company_name: (parts[0] || "").trim().replace(/"/g, ""),
          address: (parts[2] || "").trim().replace(/"/g, ""),
          source,
        });
      }
    }
  }

  // Write combined CSV
  const csvWriter = createObjectCsvWriter({
    path: OUTPUT_FILE,
    header: [
      { id: "bin_number", title: "bin_number" },
      { id: "company_name", title: "company_name" },
      { id: "address", title: "address" },
      { id: "source", title: "source" },
    ],
  });

  await csvWriter.writeRecords(Array.from(allBins.values()));

  console.log(`  BGMEA: ${bgmeaCount} BINs`);
  console.log(`  BIDA:  ${bidaCount} BINs`);
  console.log(`  Combined (unique): ${allBins.size} BINs`);
  console.log();
  console.log("=".repeat(60));
  console.log(`  TOTAL: ${allBins.size} unique BINs`);
  console.log(`  File:  ${OUTPUT_FILE}`);
  console.log("=".repeat(60));

  if (allBins.size < 1000) {
    console.log(`\n  Target was 1000+, got ${allBins.size}.`);
    console.log("  Tips:");
    console.log("    - Check BIDA URL manually (see bida.js tips)");
    console.log("    - Also try: BKMEA, BTMA, DSE company lists");
  }
}

main().catch(console.error);
