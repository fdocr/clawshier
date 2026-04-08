const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

let _sheets = null;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MM_YY_PATTERN = /^(\d{2})-(\d{2})$/;
const SUMMARY_SHEET = "Summary";
const isTestMode = process.env.CLAWSHIER_TEST_MODE === "1";

function getMockDbPath() {
  return process.env.CLAWSHIER_TEST_DB_PATH || path.resolve(__dirname, "../.clawshier-test-db.json");
}

function loadMockDb() {
  const dbPath = getMockDbPath();
  if (!fs.existsSync(dbPath)) return { sheets: {} };
  return JSON.parse(fs.readFileSync(dbPath, "utf8"));
}

function saveMockDb(db) {
  const dbPath = getMockDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

function columnToIndex(column) {
  return String(column)
    .toUpperCase()
    .split("")
    .reduce((acc, char) => acc * 26 + (char.charCodeAt(0) - 64), 0) - 1;
}

function getMockSheet(db, sheetName) {
  return db.sheets[sheetName] || null;
}

function ensureMockSheet(db, sheetName, headers) {
  if (db.sheets[sheetName]) return true;
  db.sheets[sheetName] = { rows: headers && headers.length ? [headers] : [] };
  return false;
}

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

function getSheetId(meta, sheetName) {
  const sheet = meta.data.sheets.find(
    (s) => s.properties.title === sheetName
  );
  return sheet ? sheet.properties.sheetId : null;
}

function styleHeaderRequests(sheetId) {
  return [
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true },
            backgroundColor: { red: 0.93, green: 0.93, blue: 0.93 },
          },
        },
        fields: "userEnteredFormat(textFormat,backgroundColor)",
      },
    },
    {
      updateSheetProperties: {
        properties: {
          sheetId,
          gridProperties: { frozenRowCount: 1 },
        },
        fields: "gridProperties.frozenRowCount",
      },
    },
  ];
}

function numberFormatRequests(sheetId, columnIndices) {
  return columnIndices.map((col) => ({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 1,
        endRowIndex: 1000,
        startColumnIndex: col,
        endColumnIndex: col + 1,
      },
      cell: {
        userEnteredFormat: {
          numberFormat: { type: "NUMBER", pattern: "#,##0.00" },
        },
      },
      fields: "userEnteredFormat.numberFormat",
    },
  }));
}

async function ensureSheet(spreadsheetId, sheetName, headers, numberColumns) {
  if (isTestMode) {
    const db = loadMockDb();
    const existed = ensureMockSheet(db, sheetName, headers);
    saveMockDb(db);
    return existed;
  }

  const sheets = getClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = meta.data.sheets.find(
    (s) => s.properties.title === sheetName
  );

  if (existing) return true;

  const addRes = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: sheetName } } }],
    },
  });

  const newSheetId = addRes.data.replies[0].addSheet.properties.sheetId;

  if (headers && headers.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${sheetName}'!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [headers] },
    });

    const formatRequests = [
      ...styleHeaderRequests(newSheetId),
      ...(numberColumns ? numberFormatRequests(newSheetId, numberColumns) : []),
    ];

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: formatRequests },
    });
  }

  return false;
}

async function sheetExists(spreadsheetId, sheetName) {
  if (isTestMode) {
    const db = loadMockDb();
    return Boolean(getMockSheet(db, sheetName));
  }

  const sheets = getClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  return meta.data.sheets.some((s) => s.properties.title === sheetName);
}

async function deleteSheetIfExists(spreadsheetId, sheetName) {
  if (isTestMode) {
    const db = loadMockDb();
    if (!db.sheets[sheetName]) return false;
    delete db.sheets[sheetName];
    saveMockDb(db);
    return true;
  }

  const sheets = getClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetId = getSheetId(meta, sheetName);
  if (sheetId === null) return false;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ deleteSheet: { sheetId } }],
    },
  });
  return true;
}

async function appendRow(spreadsheetId, sheetName, row) {
  if (isTestMode) {
    const db = loadMockDb();
    ensureMockSheet(db, sheetName, []);
    db.sheets[sheetName].rows.push(row);
    saveMockDb(db);
    return db.sheets[sheetName].rows.length;
  }

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

  if (isTestMode) {
    const db = loadMockDb();
    ensureMockSheet(db, sheetName, []);
    db.sheets[sheetName].rows.push(...rows);
    saveMockDb(db);
    return db.sheets[sheetName].rows.length;
  }

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
  if (isTestMode) {
    const db = loadMockDb();
    const sheet = getMockSheet(db, sheetName);
    if (!sheet) return [];
    const index = columnToIndex(column);
    return sheet.rows.map((row) => row[index] ?? "");
  }

  const sheets = getClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName}'!${column}:${column}`,
  });
  return (res.data.values || []).flat();
}

async function updateSummary(spreadsheetId) {
  if (isTestMode) {
    const db = loadMockDb();
    const monthlyTabs = Object.keys(db.sheets)
      .filter((name) => MM_YY_PATTERN.test(name));

    const allCurrencies = new Set();
    const monthlyData = [];

    for (const tab of monthlyTabs) {
      const [, mm, yy] = tab.match(MM_YY_PATTERN);
      const month = parseInt(mm, 10);
      const year = 2000 + parseInt(yy, 10);
      const rows = db.sheets[tab].rows || [];
      const sums = {};

      for (let i = 1; i < rows.length; i++) {
        const amount = parseFloat(rows[i][6]) || 0;
        const currency = String(rows[i][7] || "USD").toUpperCase().trim();
        allCurrencies.add(currency);
        sums[currency] = Math.round(((sums[currency] || 0) + amount) * 100) / 100;
      }

      monthlyData.push({
        label: `${MONTH_NAMES[month - 1]} ${year}`,
        sums,
        year,
        month,
      });
    }

    monthlyData.sort((a, b) => b.year - a.year || b.month - a.month);
    const sortedCurrencies = [...allCurrencies].sort();
    const rows = [
      ["Month", ...sortedCurrencies],
      ...monthlyData.map((entry) => [
        entry.label,
        ...sortedCurrencies.map((currency) => entry.sums[currency] || 0),
      ]),
    ];

    db.sheets[SUMMARY_SHEET] = { rows };
    saveMockDb(db);
    return;
  }

  const sheets = getClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId });

  const monthlyTabs = meta.data.sheets
    .map((s) => s.properties.title)
    .filter((name) => MM_YY_PATTERN.test(name));

  const allCurrencies = new Set();
  const monthlyData = [];

  for (const tab of monthlyTabs) {
    const [, mm, yy] = tab.match(MM_YY_PATTERN);
    const month = parseInt(mm, 10);
    const year = 2000 + parseInt(yy, 10);

    const totals = await getColumn(spreadsheetId, tab, "G");
    const currencies = await getColumn(spreadsheetId, tab, "H");

    const sums = {};
    for (let i = 1; i < totals.length; i++) {
      const currency = (currencies[i] || "USD").toUpperCase().trim();
      const amount = parseFloat(totals[i]) || 0;
      allCurrencies.add(currency);
      sums[currency] = (sums[currency] || 0) + amount;
    }

    Object.keys(sums).forEach((c) => {
      sums[c] = Math.round(sums[c] * 100) / 100;
    });

    const label = `${MONTH_NAMES[month - 1]} ${year}`;
    monthlyData.push({ label, sums, year, month });
  }

  monthlyData.sort((a, b) => b.year - a.year || b.month - a.month);

  const sortedCurrencies = [...allCurrencies].sort();
  const headerRow = ["Month", ...sortedCurrencies];

  let summarySheetId = getSheetId(meta, SUMMARY_SHEET);

  if (summarySheetId === null) {
    const addRes = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: SUMMARY_SHEET } } }],
      },
    });
    summarySheetId = addRes.data.replies[0].addSheet.properties.sheetId;
  } else {
    const existingCharts = meta.data.sheets
      .find((s) => s.properties.sheetId === summarySheetId)
      ?.charts || [];

    const deleteChartRequests = existingCharts.map((c) => ({
      deleteEmbeddedObject: { objectId: c.chartId },
    }));

    const clearRequests = [
      {
        updateCells: {
          range: { sheetId: summarySheetId },
          fields: "userEnteredValue,userEnteredFormat",
        },
      },
      ...deleteChartRequests,
    ];

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: clearRequests },
    });
  }

  const dataRows = monthlyData.map((m) => [
    m.label,
    ...sortedCurrencies.map((c) => m.sums[c] || 0),
  ]);
  const rows = [headerRow, ...dataRows];

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${SUMMARY_SHEET}'!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: rows },
  });

  const dataRowCount = monthlyData.length;
  const currencyColIndices = sortedCurrencies.map((_, i) => i + 1);

  const formatRequests = [
    ...styleHeaderRequests(summarySheetId),
    ...numberFormatRequests(summarySheetId, currencyColIndices),
    {
      updateSheetProperties: {
        properties: { sheetId: summarySheetId, index: 0 },
        fields: "index",
      },
    },
  ];

  if (dataRowCount > 0 && sortedCurrencies.length > 0) {
    const series = sortedCurrencies.map((_, i) => ({
      series: {
        sourceRange: {
          sources: [{
            sheetId: summarySheetId,
            startRowIndex: 0,
            endRowIndex: dataRowCount + 1,
            startColumnIndex: i + 1,
            endColumnIndex: i + 2,
          }],
        },
      },
      targetAxis: "BOTTOM_AXIS",
    }));

    formatRequests.push({
      addChart: {
        chart: {
          position: {
            overlayPosition: {
              anchorCell: {
                sheetId: summarySheetId,
                rowIndex: 1,
                columnIndex: sortedCurrencies.length + 2,
              },
              widthPixels: 800,
              heightPixels: 400,
            },
          },
          spec: {
            title: "Monthly Expenses by Currency",
            basicChart: {
              chartType: "BAR",
              legendPosition: "BOTTOM_LEGEND",
              axis: [
                { position: "BOTTOM_AXIS", title: "Total" },
                { position: "LEFT_AXIS", title: "Month" },
              ],
              domains: [
                {
                  domain: {
                    sourceRange: {
                      sources: [{
                        sheetId: summarySheetId,
                        startRowIndex: 0,
                        endRowIndex: dataRowCount + 1,
                        startColumnIndex: 0,
                        endColumnIndex: 1,
                      }],
                    },
                  },
                },
              ],
              series,
              headerCount: 1,
            },
          },
        },
      },
    });
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: formatRequests },
  });
}

module.exports = {
  ensureSheet,
  sheetExists,
  deleteSheetIfExists,
  appendRow,
  appendRows,
  getColumn,
  updateSummary,
};
