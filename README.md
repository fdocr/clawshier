# Clawshier

OpenClaw skill that processes receipt/invoice photos from any chat channel, extracts expense data via OpenAI Vision, and logs it to a Google Spreadsheet using the browser.

## Prerequisites

- Node.js 18+
- OpenAI API key
- OpenClaw with browser enabled
- Logged into Google in the OpenClaw browser profile

## Install

```bash
git clone https://github.com/YOUR_USER/clawshier.git
cd clawshier
npm install
cp .env.example .env
```

Fill in `.env` with your credentials (see `.env.example`).

### Google Sheets setup

1. Create a Google Spreadsheet
2. Add column headers in Row 1: `Date`, `Vendor`, `Category`, `Items`, `Subtotal`, `Tax`, `Total`, `Currency`, `Fingerprint`, `Added At`
3. Copy the spreadsheet URL and paste it as `CLAWSHIER_GOOGLE_SHEETS_URL` in `.env`
4. Make sure you're logged into Google in your OpenClaw browser profile

### OpenClaw usage

Add to your skills directory or install via ClawHub:

```bash
clawhub install clawshier
```

Or symlink for local development:

```bash
ln -s /path/to/clawshier ~/.openclaw/skills/clawshier
```

## License

MIT
