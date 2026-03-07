const fs = require("fs");
const path = require("path");
const os = require("os");

const STORE_DIR = path.join(os.homedir(), ".clawshier");
const STORE_PATH = path.join(STORE_DIR, "fingerprints.json");

function load() {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
  } catch {
    return [];
  }
}

function has(fp) {
  return load().includes(fp);
}

function save(fp) {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  const existing = load();
  if (!existing.includes(fp)) {
    existing.push(fp);
    fs.writeFileSync(STORE_PATH, JSON.stringify(existing, null, 2));
  }
}

module.exports = { load, has, save };
