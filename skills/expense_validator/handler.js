#!/usr/bin/env node
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

const { fingerprint } = require("../../lib/hashing");
const { getColumn, sheetExists } = require("../../lib/googleSheets");
const {
  parseOverrideDate,
  normalize,
  validate,
  sheetNameFromDate,
} = require("../../lib/expenseValidator");
const { isTraceEnabled, readTrace, writeTrace, startTraceStep, finishTraceStep } = require("../../lib/trace");

const FINGERPRINT_COLUMN = "A";

async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;

  const traceEnabled = isTraceEnabled();
  const trace = traceEnabled ? (readTrace() || { steps: [] }) : null;
  const traceStep = traceEnabled ? startTraceStep("validate", { kind: "local+sheets" }) : null;

  const overrideDate = parseOverrideDate(process.argv);
  const expense = normalize(JSON.parse(input), { overrideDate, today: new Date() });
  validate(expense);

  expense.fingerprint = fingerprint(expense.vendor, expense.date, expense.total);

  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
  const sheetName = sheetNameFromDate(expense.date);

  const tabExists = await sheetExists(spreadsheetId, sheetName);
  if (tabExists) {
    const existing = await getColumn(spreadsheetId, sheetName, FINGERPRINT_COLUMN);
    if (existing.includes(expense.fingerprint)) {
      throw new Error(
        `Duplicate receipt detected (vendor: ${expense.vendor}, date: ${expense.date}, total: ${expense.total})`
      );
    }
  }

  if (traceEnabled) {
    trace.steps.push(finishTraceStep(traceStep, {
      status: "ok",
      dedupeChecked: true,
      targetSheet: sheetName,
    }));
    writeTrace(trace);
  }

  process.stdout.write(JSON.stringify(expense));
}

main().catch((err) => {
  process.stderr.write(JSON.stringify({ error: err.message }));
  process.exit(1);
});
