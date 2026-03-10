#!/usr/bin/env node
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

const { ensureSheet, appendRow, appendRows } = require("../../lib/googleSheets");

const EXPENSE_HEADERS = [
  "Fingerprint", "Date", "Vendor", "Category",
  "Subtotal", "Tax", "Total", "Currency",
];
const BREAKDOWN_SHEET = "Invoice Archive Breakdown";
const BREAKDOWN_HEADERS = ["Fingerprint", "Item", "Quantity", "Cost"];

function sheetNameFromDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${mm}-${yy}`;
}

async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;

  const expense = JSON.parse(input);
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
  const sheetName = sheetNameFromDate(expense.date);

  await ensureSheet(spreadsheetId, sheetName, EXPENSE_HEADERS);

  const row = [
    expense.fingerprint,
    expense.date,
    expense.vendor,
    expense.category,
    expense.subtotal,
    expense.tax,
    expense.total,
    expense.currency,
  ];

  const rowNumber = await appendRow(spreadsheetId, sheetName, row);

  await ensureSheet(spreadsheetId, BREAKDOWN_SHEET, BREAKDOWN_HEADERS);

  const itemRows = (expense.items || []).map((item) => [
    expense.fingerprint,
    item.description,
    item.quantity || 1,
    item.amount,
  ]);

  await appendRows(spreadsheetId, BREAKDOWN_SHEET, itemRows);

  process.stdout.write(JSON.stringify({ success: true, row: rowNumber }));
}

main().catch((err) => {
  process.stderr.write(JSON.stringify({ error: err.message }));
  process.exit(1);
});
