---
name: clawshier
description: >
  Scan receipt or invoice photos sent via chat, extract expense data using
  OpenAI Vision, validate and deduplicate, then log to a Google Spreadsheet.
  Responds with a short summary of what was added.
metadata:
  openclaw:
    requires:
      env:
        - OPENAI_API_KEY
        - GOOGLE_SHEETS_ID
        - GOOGLE_SERVICE_ACCOUNT_KEY
    primaryEnv: OPENAI_API_KEY
tags:
  - expenses
  - receipts
  - invoices
  - google-sheets
  - ocr
  - automation
---

# Receipt Expense Tracker

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
node skills/receipt_ocr/handler.js --image <path_to_image>
```

Output schema:

```json
{ "ocr_text": "STARBUCKS\n123 Main St..." }
```

### Step 2 — Structure

Pipe the OCR output to the structurer:

```bash
echo '<step1_output>' | node skills/expense_structurer/handler.js
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
echo '<step2_output>' | node skills/expense_validator/handler.js
```

For **old invoices** (when the user explicitly provides a date), pass the `--date` flag:

```bash
echo '<step2_output>' | node skills/expense_validator/handler.js --date 2026-01-15
```

This step:
- **Resolves the date** — the date from step 2 may arrive in any format (MM-DD-YYYY, DD-MM-YYYY, etc.). The validator compares it against today's date to determine the correct interpretation and normalizes to YYYY-MM-DD. If the `--date YYYY-MM-DD` flag is provided, it uses that value directly and skips auto-detection.
- Generates a SHA-256 fingerprint from `vendor + date + total`
- Derives the sheet tab name from the expense date (MM-YY format)
- Checks the matching monthly sheet for duplicate fingerprints (column A)
- If the sheet tab doesn't exist yet, skips the duplicate check
- Normalizes currency codes and trims whitespace
- Validates all required fields are present

**Date resolution**: invoices are expected to be processed the same day they are issued. The validator tests both MM-DD and DD-MM interpretations and picks the one matching today. If neither matches, the validator returns an error asking the user to provide the date explicitly via `--date`.

**Old invoice flow**: if the user says the image is an old invoice and provides a date (e.g. "this is from 2026-01-15"), pass that date using `--date 2026-01-15`. The value **must** be in YYYY-MM-DD format or the validator will reject it with a clear error.

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

### Step 4 — Store

Pipe the validated expense to the store:

```bash
echo '<step3_output>' | node skills/expense_store_sheets/handler.js
```

This step writes to three sheets and performs cleanup:

**Monthly expense sheet** (tab named MM-YY, e.g. `03-26`): created automatically with headers if it doesn't exist. Columns: Fingerprint, Date, Vendor, Category, Subtotal, Tax, Total, Currency.

**Invoice Archive Breakdown** (single persistent tab): created automatically with headers if it doesn't exist. Columns: Fingerprint, Item, Quantity, Cost. One row per line item from the expense, linked to the monthly sheet via Fingerprint.

**Summary** (first tab): rebuilt on every store. Columns: Month (human-readable, e.g. "March 2026"), Total. Sorted most recent month first. Includes a line chart of monthly expense totals over time. All headers are bold with a frozen first row.

Additionally, the default "Sheet1" tab is deleted if it exists.

Output schema:

```json
{ "success": true, "row": 42 }
```

## Response

After a successful pipeline run, reply with a short summary:

> Added expense: **{vendor}** — {total} {currency} on {date} ({category}). Row #{row} in your spreadsheet (tab {MM-YY}).

## Error Handling

- Retry each step up to 2 times on failure
- If a step fails after retries, respond with which step failed and the error message
- If the image is not a receipt/invoice (OCR returns no useful text), tell the user:
  > "I couldn't detect a receipt or invoice in that image. Could you try again with a clearer photo?"

## Setup

```bash
npm install
cp .env.example .env
# Fill in OPENAI_API_KEY, GOOGLE_SHEETS_ID, GOOGLE_SERVICE_ACCOUNT_KEY
```

See `README.md` for full setup instructions.
