---
name: clawshier
description: Process receipt or invoice images into structured expenses and log them to Google Sheets. Use when the user wants to scan, log, track, or record an expense from a receipt or invoice image, or when they provide a local file path to a receipt/invoice image. OCR uses OpenAI by default; set CLAWSHIER_VISION_PROVIDER=ollama to use local Ollama instead.
metadata: {"openclaw":{"requires":{"env":["GOOGLE_SHEETS_ID","GOOGLE_SERVICE_ACCOUNT_KEY"]},"primaryEnv":"OPENAI_API_KEY"}}
---

# Clawshier

Process a receipt or invoice image through a four-step pipeline, then reply with a short summary of what was added.

## Input handling

- If the user provides a **local file path** to the image, use that path directly.
- If the user sends an image in chat and a **local attachment path** is available, use that path.
- If no local file path is available for the image, ask the user to resend it as a file or provide a path you can execute against.
- If the user explicitly gives the receipt date, preserve it and pass it to step 3 with `--date YYYY-MM-DD`.

## Workflow

Run these steps sequentially. If a step fails, retry it up to **2 times** before surfacing the error.

### Step 1 — OCR

Run:

```bash
node {baseDir}/skills/receipt_ocr/handler.js --image <path_to_image>
```

Expected output:

```json
{ "ocr_text": "STARBUCKS\n123 Main St..." }
```

If OCR reports that the image is not a receipt or invoice, tell the user:

> I couldn't detect a receipt or invoice in that image. Could you try again with a clearer photo?

### Step 2 — Structure

Pipe the OCR output directly into the structurer:

```bash
printf '%s' '<step1_output>' | node {baseDir}/skills/expense_structurer/handler.js
```

Do not manually rewrite the JSON. Preserve the model output for the validator.

Expected output:

```json
{
  "date": "03/25/2026",
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

### Step 3 — Validate and deduplicate

Pipe the structured expense directly into the validator:

```bash
printf '%s' '<step2_output>' | node {baseDir}/skills/expense_validator/handler.js
```

If the user explicitly provided a date, always pass it in ISO format:

```bash
printf '%s' '<step2_output>' | node {baseDir}/skills/expense_validator/handler.js --date 2026-03-25
```

This step:

- normalizes the receipt date to `YYYY-MM-DD`
- normalizes currency and item defaults
- generates the expense fingerprint
- derives the monthly sheet tab name (`MM-YY`)
- checks for duplicate fingerprints in that monthly tab when it exists

If the validator reports a duplicate, stop and tell the user:

> This receipt appears to already be logged (vendor, date, total match an existing entry). Skipping.

### Step 4 — Store

Pipe the validated expense directly into the storage handler:

```bash
printf '%s' '<step3_output>' | node {baseDir}/skills/expense_store_sheets/handler.js
```

This step writes to:

- the monthly expense tab (`MM-YY`)
- `Invoice Archive Breakdown`
- `Summary`

It also removes the default `Sheet1` tab if present.

## Success reply

After a successful run, reply in this format:

> Added expense: **{vendor}** — {total} {currency} on {date} ({category}). Row #{row} in your spreadsheet (tab {MM-YY}).

If the user explicitly asks for tracing/debugging/cost tracing, append a compact per-step trace summary using the last recorded trace file. Otherwise keep the normal success reply short.

## Failure reply

If a step still fails after retries, say which step failed and include the error message.

## Notes

- Use `{baseDir}` exactly so the commands do not depend on the current working directory.
- For old invoices, prefer `--date YYYY-MM-DD` instead of relying on same-day date inference.
- OCR backend selection is machine-level: `CLAWSHIER_VISION_PROVIDER=openai|ollama|auto` (default: `openai`).
- `auto` tries local Ollama first and falls back to OpenAI. Set to `ollama` to force local-only OCR.
- Use `CLAWSHIER_OLLAMA_MODEL`, `CLAWSHIER_OLLAMA_HOST`, and `CLAWSHIER_OLLAMA_MAX_DIMENSION` to control the Ollama OCR backend.
- When `CLAWSHIER_TEST_MODE=1` is present in the environment, the handlers use local test fixtures and a local mock sheet store. Use that for safe smoke tests before touching real APIs.
- Optional tracing: set `CLAWSHIER_TRACE=1` to record per-step timing/usage metadata to `.clawshier-last-trace.json`. Show that trace in chat only when the user explicitly asks for tracing/debugging/cost tracing.
