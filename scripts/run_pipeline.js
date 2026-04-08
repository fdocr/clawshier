#!/usr/bin/env node
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : null;
}

function runNode(scriptPath, args = []) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    stdio: "pipe",
    encoding: "utf8",
    env: process.env,
  });

  if (result.status !== 0) {
    const stderr = String(result.stderr || "").trim();
    throw new Error(stderr || `Step failed: ${path.basename(scriptPath)}`);
  }

  return String(result.stdout || "").trim();
}

function main() {
  const baseDir = path.resolve(__dirname, "..");
  const imagePath = getArg("--image");
  const date = getArg("--date");

  if (!imagePath) {
    throw new Error("Usage: run_pipeline.js --image <path> [--date YYYY-MM-DD]");
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawshier-pipeline-"));
  const step1File = path.join(tempDir, "step1.json");
  const step2File = path.join(tempDir, "step2.json");
  const step3File = path.join(tempDir, "step3.json");
  const step4File = path.join(tempDir, "step4.json");

  try {
    runNode(path.join(baseDir, "skills/receipt_ocr/handler.js"), ["--image", imagePath, "--output-file", step1File]);
    runNode(path.join(baseDir, "skills/expense_structurer/handler.js"), ["--input-file", step1File, "--output-file", step2File]);

    const validateArgs = ["--input-file", step2File, "--output-file", step3File];
    if (date) validateArgs.push("--date", date);
    runNode(path.join(baseDir, "skills/expense_validator/handler.js"), validateArgs);

    runNode(path.join(baseDir, "skills/expense_store_sheets/handler.js"), ["--input-file", step3File, "--output-file", step4File]);
    process.stdout.write(fs.readFileSync(step4File, "utf8"));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (err) {
  process.stderr.write(JSON.stringify({ error: err.message }));
  process.exit(1);
}
