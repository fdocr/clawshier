---
name: clawshier
description: >
  Scan receipt or invoice photos sent via chat, extract expense data using
  OpenAI Vision, validate and deduplicate, then log to a Google Spreadsheet
  via the browser. Responds with a short summary of what was added.
metadata:
  openclaw:
    requires:
      env:
        - OPENAI_API_KEY
        - CLAWSHIER_GOOGLE_SHEETS_ID
      config:
        - browser.enabled
    primaryEnv: OPENAI_API_KEY
tags:
  - expenses
  - receipts
  - invoices
  - google-sheets
  - ocr
  - automation
---

# Clawshier

Process receipt and invoice photos into structured expenses and log them to Google Sheets.

## When to Activate

Activate this skill when the user sends a **photo or image** and any of these apply:

- The message mentions receipts, invoices, expenses, or purchases
- The image appears to be a receipt, invoice, or bill
- The user asks to log, track, or record an expense
- The user asks to add something to their expense spreadsheet

Do **not** activate for images that are clearly not financial documents (memes, screenshots of conversations, etc.).

## Pipeline

Run each step sequentially. If a step fails, retry it up to **2 times** before reporting the error.

### Step 1 — OCR

Save the received image to a temporary file, then extract text:

```bash
node {baseDir}/skills/receipt_ocr/handler.js --image <path_to_image>
```

Output schema:

```json
{ "ocr_text": "STARBUCKS\n123 Main St..." }
```

### Step 2 — Structure

Pipe the OCR output to the structurer:

```bash
echo '<step1_output>' | node {baseDir}/skills/expense_structurer/handler.js
```

Output schema:

```json
{
  "date": "2026-03-05",
  "vendor": "Starbucks",
  "items": [
    { "description": "Caffe Latte", "quantity": 1, "amount": 5.95 }
  ],
  "subtotal": 5.95,
  "tax": 0.52,
  "total": 6.47,
  "currency": "USD",
  "category": "Food & Drink"
}
```

### Step 3 — Validate

Pipe the structured expense to the validator:

```bash
echo '<step2_output>' | node {baseDir}/skills/expense_validator/handler.js
```

This step:
- Generates a SHA-256 fingerprint from `vendor + date + total`
- Checks a local fingerprint store (`~/.clawshier/fingerprints.json`) for duplicates
- Normalizes currency codes and trims whitespace
- Validates all required fields are present
- Saves the fingerprint locally on success

If a **duplicate is found**, stop the pipeline and tell the user:

> "This receipt appears to already be logged (vendor, date, total match an existing entry). Skipping."

Output schema (adds `fingerprint` field):

```json
{
  "date": "2026-03-05",
  "vendor": "Starbucks",
  "items": [...],
  "subtotal": 5.95,
  "tax": 0.52,
  "total": 6.47,
  "currency": "USD",
  "category": "Food & Drink",
  "fingerprint": "a1b2c3..."
}
```

### Step 4 — Store (Browser)

Use the `browser` tool to add the expense to Google Sheets. The spreadsheet URL is in the `CLAWSHIER_GOOGLE_SHEETS_ID` environment variable.

Expected spreadsheet columns (Row 1 headers): Date | Vendor | Category | Items | Subtotal | Tax | Total | Currency | Fingerprint | Added At

Follow these steps:

1. Open the spreadsheet URL in the browser:
   ```
   browser open $CLAWSHIER_GOOGLE_SHEETS_ID
   ```

2. Wait for the page to load, then take a snapshot to understand the sheet layout.

3. Find the first empty row after existing data.

4. Click on cell A of the empty row and type each value across the columns:
   - **A**: `{date}`
   - **B**: `{vendor}`
   - **C**: `{category}`
   - **D**: Items summary (e.g. `Caffe Latte x1; Muffin x2`)
   - **E**: `{subtotal}`
   - **F**: `{tax}`
   - **G**: `{total}`
   - **H**: `{currency}`
   - **I**: `{fingerprint}`
   - **J**: Current ISO timestamp

5. Press Enter to confirm the last cell, then close the browser tab.

If the browser is not available or Google Sheets fails to load, report the error to the user and suggest they check their browser configuration and Google login.

## Response

After a successful pipeline run, reply with a short summary:

> Added expense: **{vendor}** — {total} {currency} on {date} ({category}).

## Error Handling

- Retry each step up to 2 times on failure
- If a step fails after retries, respond with which step failed and the error message
- If the image is not a receipt/invoice (OCR returns no useful text), tell the user:
  > "I couldn't detect a receipt or invoice in that image. Could you try again with a clearer photo?"

## Setup

```bash
npm install
cp .env.example .env
# Fill in OPENAI_API_KEY and CLAWSHIER_GOOGLE_SHEETS_ID
```

See `README.md` for full setup instructions.
