const { google } = require("googleapis");
const path = require("path");

let _sheets = null;

function getClient() {
  if (_sheets) return _sheets;

  const keyPath = path.resolve(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const auth = new google.auth.GoogleAuth({
    keyFile: keyPath,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  _sheets = google.sheets({ version: "v4", auth });
  return _sheets;
}

async function ensureSheet(spreadsheetId, sheetName, headers) {
  const sheets = getClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets.some(
    (s) => s.properties.title === sheetName
  );

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: sheetName } } }],
      },
    });

    if (headers && headers.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${sheetName}'!A1`,
        valueInputOption: "RAW",
        requestBody: { values: [headers] },
      });
    }
  }

  return exists;
}

async function sheetExists(spreadsheetId, sheetName) {
  const sheets = getClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  return meta.data.sheets.some((s) => s.properties.title === sheetName);
}

async function appendRow(spreadsheetId, sheetName, row) {
  const sheets = getClient();
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${sheetName}'!A:Z`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });

  const updatedRange = res.data.updates?.updatedRange || "";
  const match = updatedRange.match(/(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

async function appendRows(spreadsheetId, sheetName, rows) {
  if (!rows.length) return null;
  const sheets = getClient();
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${sheetName}'!A:Z`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows },
  });

  const updatedRange = res.data.updates?.updatedRange || "";
  const match = updatedRange.match(/(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

async function getColumn(spreadsheetId, sheetName, column) {
  const sheets = getClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName}'!${column}:${column}`,
  });
  return (res.data.values || []).flat();
}

module.exports = { ensureSheet, sheetExists, appendRow, appendRows, getColumn };
