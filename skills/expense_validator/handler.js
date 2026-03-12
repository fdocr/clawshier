#!/usr/bin/env node
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

const { fingerprint } = require("../../lib/hashing");
const { getColumn, sheetExists } = require("../../lib/googleSheets");

const CURRENCY_ALIASES = { "$": "USD", "€": "EUR", "£": "GBP", "¥": "JPY" };
const FINGERPRINT_COLUMN = "A";
const STRICT_ISO = /^\d{4}-\d{2}-\d{2}$/;

function parseOverrideDate() {
  const idx = process.argv.indexOf("--date");
  if (idx === -1 || !process.argv[idx + 1]) return null;
  const val = process.argv[idx + 1];
  if (!STRICT_ISO.test(val)) {
    throw new Error(`--date must be in YYYY-MM-DD format, received: "${val}"`);
  }
  const d = new Date(val + "T00:00:00");
  if (isNaN(d.getTime())) {
    throw new Error(`--date is not a valid date: "${val}"`);
  }
  return val;
}

function toIso(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function resolveDate(raw) {
  raw = (raw || "").replace(/[T ].*$/, "").trim();
  if (!raw) throw new Error("Date field is empty");

  if (STRICT_ISO.test(raw)) {
    const d = new Date(raw + "T00:00:00");
    if (!isNaN(d.getTime())) return raw;
  }

  const parts = raw.match(/^(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{1,4})$/);
  if (!parts) throw new Error(`Unable to parse date: "${raw}"`);

  let [, p1, p2, p3] = parts.map((v, i) => (i === 0 ? v : parseInt(v, 10)));
  p1 = parseInt(p1, 10);

  let year, a, b;
  if (p3 >= 100) {
    year = p3; a = p1; b = p2;
  } else if (p1 >= 100) {
    year = p1; a = p2; b = p3;
  } else {
    year = p3 + 2000; a = p1; b = p2;
  }

  const today = new Date();
  const todayMonth = today.getMonth() + 1;
  const todayDay = today.getDate();

  const mmdd = { month: a, day: b };
  const ddmm = { month: b, day: a };

  const mmddMatch = mmdd.month === todayMonth && mmdd.day === todayDay;
  const ddmmMatch = ddmm.month === todayMonth && ddmm.day === todayDay;

  if (mmddMatch && ddmmMatch) return toIso(year, a, b);
  if (mmddMatch) return toIso(year, mmdd.month, mmdd.day);
  if (ddmmMatch) return toIso(year, ddmm.month, ddmm.day);

  throw new Error(
    `Date "${raw}" does not match today (${toIso(today.getFullYear(), todayMonth, todayDay)}). ` +
    "For old invoices, re-run with --date YYYY-MM-DD to set the date explicitly."
  );
}

function sheetNameFromDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${mm}-${yy}`;
}

function normalize(expense, overrideDate) {
  expense.vendor = (expense.vendor || "").trim();
  expense.date = overrideDate || resolveDate(expense.date);
  expense.category = (expense.category || "Other").trim();

  if (CURRENCY_ALIASES[expense.currency]) {
    expense.currency = CURRENCY_ALIASES[expense.currency];
  }
  expense.currency = (expense.currency || "USD").toUpperCase().trim();

  expense.total = parseFloat(expense.total) || 0;
  expense.subtotal = parseFloat(expense.subtotal) || expense.total;
  expense.tax = parseFloat(expense.tax) || 0;

  return expense;
}

function validate(expense) {
  const missing = [];
  if (!expense.vendor) missing.push("vendor");
  if (!expense.date) missing.push("date");
  if (!expense.total) missing.push("total");
  if (missing.length) throw new Error(`Missing required fields: ${missing.join(", ")}`);
}

async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;

  const overrideDate = parseOverrideDate();
  const expense = normalize(JSON.parse(input), overrideDate);
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

  process.stdout.write(JSON.stringify(expense));
}

main().catch((err) => {
  process.stderr.write(JSON.stringify({ error: err.message }));
  process.exit(1);
});
