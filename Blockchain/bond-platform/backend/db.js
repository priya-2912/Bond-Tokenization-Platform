const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "data");
fs.mkdirSync(dir, { recursive: true });
const db = new Database(path.join(dir, "platform.db"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS kyc_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  id_file TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  decided_at TEXT,
  tx_hash TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract TEXT NOT NULL,
  type TEXT NOT NULL,
  block_number INTEGER NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  args TEXT NOT NULL,
  UNIQUE (tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS idx_events_type ON events (type, block_number DESC);
CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

const now = () => new Date().toISOString();

module.exports = {
  submitKyc({ wallet, name, idFile }) {
    const existing = db.prepare("SELECT * FROM kyc_requests WHERE wallet = ?").get(wallet);
    if (existing && existing.status === "approved") return { error: "already approved", row: existing };
    if (existing) {
      db.prepare(
        "UPDATE kyc_requests SET name=?, id_file=?, status='pending', created_at=?, decided_at=NULL, tx_hash=NULL WHERE wallet=?"
      ).run(name, idFile, now(), wallet);
    } else {
      db.prepare("INSERT INTO kyc_requests (wallet, name, id_file, created_at) VALUES (?,?,?,?)").run(
        wallet,
        name,
        idFile,
        now()
      );
    }
    return { row: db.prepare("SELECT * FROM kyc_requests WHERE wallet = ?").get(wallet) };
  },
  getKyc: (wallet) => db.prepare("SELECT * FROM kyc_requests WHERE wallet = ?").get(wallet),
  listKyc: (status) =>
    status
      ? db.prepare("SELECT * FROM kyc_requests WHERE status = ? ORDER BY created_at DESC").all(status)
      : db.prepare("SELECT * FROM kyc_requests ORDER BY created_at DESC").all(),
  setKycStatus(wallet, status, txHash = null) {
    db.prepare("UPDATE kyc_requests SET status=?, decided_at=?, tx_hash=? WHERE wallet=?").run(
      status,
      now(),
      txHash,
      wallet
    );
    return db.prepare("SELECT * FROM kyc_requests WHERE wallet = ?").get(wallet);
  },
  insertEvent({ contract, type, blockNumber, txHash, logIndex, args }) {
    db.prepare(
      "INSERT OR IGNORE INTO events (contract, type, block_number, tx_hash, log_index, args) VALUES (?,?,?,?,?,?)"
    ).run(contract, type, blockNumber, txHash, logIndex, JSON.stringify(args));
  },
  listEvents({ type, limit = 100 }) {
    const rows = type
      ? db.prepare("SELECT * FROM events WHERE type = ? ORDER BY block_number DESC, log_index DESC LIMIT ?").all(type, limit)
      : db.prepare("SELECT * FROM events ORDER BY block_number DESC, log_index DESC LIMIT ?").all(limit);
    return rows.map((r) => ({ ...r, args: JSON.parse(r.args) }));
  },
  getState: (key) => db.prepare("SELECT value FROM state WHERE key = ?").get(key)?.value ?? null,
  setState: (key, value) =>
    db.prepare("INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
      key,
      String(value)
    ),
};
