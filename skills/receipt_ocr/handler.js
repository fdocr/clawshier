#!/usr/bin/env node
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

const fs = require("fs");
const path = require("path");
const { runOcrWithProvider } = require("../../lib/visionOcr");

const isTestMode = process.env.CLAWSHIER_TEST_MODE === "1";

function getImagePath(argv = process.argv) {
  const imageArg = argv.indexOf("--image");
  if (imageArg === -1 || !argv[imageArg + 1]) {
    throw new Error("Usage: handler.js --image <path>");
  }
  return argv[imageArg + 1];
}

function runMockOcr(imagePath) {
  const fixturePath = process.env.CLAWSHIER_TEST_OCR_FIXTURE || path.resolve(__dirname, "../../test/fixtures/mock-ocr.txt");
  const base = path.basename(imagePath).toLowerCase();

  if (base.includes("not-a-receipt")) {
    throw new Error("Image does not appear to be a receipt or invoice");
  }

  return fs.readFileSync(fixturePath, "utf8").trim();
}

async function main() {
  const imagePath = getImagePath();

  if (isTestMode) {
    process.stdout.write(JSON.stringify({ ocr_text: runMockOcr(imagePath) }));
    return;
  }

  const ocrText = await runOcrWithProvider({ imagePath });
  process.stdout.write(JSON.stringify({ ocr_text: ocrText }));
}

main().catch((err) => {
  process.stderr.write(JSON.stringify({ error: err.message }));
  process.exit(1);
});
