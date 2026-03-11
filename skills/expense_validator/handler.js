#!/usr/bin/env node
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

const { fingerprint } = require("../../lib/hashing");
const { getColumn, sheetExists } = require("../../lib/googleSheets");

const CURRENCY_ALIASES = { "$": "USD", "€": "EUR", "£": "GBP", "¥": "JPY" };
const FINGERPRINT_COLUMN = "A";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeDate(raw) {
  raw = (raw || "").trim();

  if (ISO_DATE.test(raw)) {
    const d = new Date(raw + "T00:00:00");
    if (!isNaN(d.getTime())) return raw;
  }

  const slashOrDash = raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (slashOrDash) {
    let [, a, b, yearPart] = slashOrDash;
    let year = parseInt(yearPart, 10);
    if (year < 100) year += 2000;
    a = parseInt(a, 10);
    b = parseInt(b, 10);

    let month, day;
    if (a > 12 && b <= 12) {
      day = a; month = b;
    } else if (b > 12 && a <= 12) {
      month = a; day = b;
    } else {
      month = a; day = b;
    }

    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const d = new Date(iso + "T00:00:00");
      if (!isNaN(d.getTime())) return iso;
    }
  }

  const d = new Date(raw);
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }

  throw new Error(`Unable to parse date: "${raw}"`);
}

function sheetNameFromDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${mm}-${yy}`;
}

function normalize(expense) {
  expense.vendor = (expense.vendor || "").trim();
  expense.date = normalizeDate(expense.date);
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

  const d = new Date(expense.date + "T00:00:00");
  const now = new Date();
  now.setDate(now.getDate() + 7);
  if (d > now) throw new Error(`Date "${expense.date}" is in the future`);
  if (d.getFullYear() < 2000) throw new Error(`Date "${expense.date}" has an unreasonable year`);
}

async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;

  const expense = normalize(JSON.parse(input));
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
