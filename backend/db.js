const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const dir = path.join(__dirname, "data");
fs.mkdirSync(dir, { recursive: true });
const db = new Database(path.join(dir, "platform.db"));
db.pragma("journal_mode = WAL");

// Primary Master Admin Wallet specified by user
const MASTER_ADMIN_WALLET = "0xc992ddeb354F51EDc472c7FB9D84Db200FaAf5DA".toLowerCase();

// Initialize tables
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT NOT NULL UNIQUE,
  full_name TEXT,
  email TEXT,
  phone TEXT,
  country TEXT,
  investor_type TEXT DEFAULT 'Individual',
  role TEXT DEFAULT 'investor',
  profile_completed INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'investor',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_nonces (
  wallet TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kyc_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  country TEXT,
  investor_type TEXT DEFAULT 'Individual',
  id_file TEXT,
  id_file_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  rejection_reason TEXT,
  reviewer_wallet TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  tx_hash TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_wallet TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  target_wallet TEXT,
  details TEXT,
  tx_hash TEXT,
  created_at TEXT NOT NULL
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

// Safe upgrades for legacy schema
try { db.exec(`ALTER TABLE kyc_requests ADD COLUMN email TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE kyc_requests ADD COLUMN phone TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE kyc_requests ADD COLUMN country TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE kyc_requests ADD COLUMN investor_type TEXT DEFAULT 'Individual';`); } catch (e) {}
try { db.exec(`ALTER TABLE kyc_requests ADD COLUMN id_file_name TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE kyc_requests ADD COLUMN rejection_reason TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE kyc_requests ADD COLUMN reviewer_wallet TEXT;`); } catch (e) {}

const now = () => new Date().toISOString();

// Ensure master admin wallet is initialized with admin role
const masterAdmin = db.prepare("SELECT * FROM users WHERE LOWER(wallet) = ?").get(MASTER_ADMIN_WALLET);
if (!masterAdmin) {
  db.prepare(`
    INSERT INTO users (wallet, full_name, email, role, profile_completed, created_at, updated_at)
    VALUES (?, ?, ?, 'admin', 1, ?, ?)
  `).run(MASTER_ADMIN_WALLET, "Platform Super Admin", "admin@aurabonds.com", now(), now());
} else if (masterAdmin.role !== "admin") {
  db.prepare("UPDATE users SET role = 'admin', updated_at = ? WHERE LOWER(wallet) = ?").run(now(), MASTER_ADMIN_WALLET);
}

module.exports = {
  db,
  now,
  MASTER_ADMIN_WALLET,

  isMasterAdmin(wallet) {
    return wallet && wallet.toLowerCase() === MASTER_ADMIN_WALLET;
  },

  // --- Auth Nonces ---
  generateNonce(wallet) {
    const nonce = `Sign this message to authenticate with Aura Bonds:\nNonce: ${crypto.randomBytes(16).toString("hex")}\nTimestamp: ${Date.now()}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO auth_nonces (wallet, nonce, expires_at)
      VALUES (?, ?, ?)
      ON CONFLICT(wallet) DO UPDATE SET nonce = excluded.nonce, expires_at = excluded.expires_at
    `).run(wallet.toLowerCase(), nonce, expiresAt);
    return nonce;
  },

  getValidNonce(wallet) {
    const row = db.prepare("SELECT * FROM auth_nonces WHERE wallet = ?").get(wallet.toLowerCase());
    if (!row) return null;
    if (new Date(row.expires_at) < new Date()) {
      db.prepare("DELETE FROM auth_nonces WHERE wallet = ?").run(wallet.toLowerCase());
      return null;
    }
    return row.nonce;
  },

  consumeNonce(wallet) {
    db.prepare("DELETE FROM auth_nonces WHERE wallet = ?").run(wallet.toLowerCase());
  },

  // --- Sessions ---
  createSession(wallet, role = "investor") {
    // Master admin always gets admin session
    if (this.isMasterAdmin(wallet)) {
      role = "admin";
    }
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO sessions (token, wallet, role, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(token, wallet.toLowerCase(), role, expiresAt, now());
    return { token, wallet: wallet.toLowerCase(), role, expiresAt };
  },

  getSession(token) {
    if (!token) return null;
    const row = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
    if (!row) return null;
    if (new Date(row.expires_at) < new Date()) {
      db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
      return null;
    }
    return row;
  },

  deleteSession(token) {
    if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  },

  // --- Users & Profiles ---
  getUser(wallet) {
    return db.prepare("SELECT * FROM users WHERE LOWER(wallet) = LOWER(?)").get(wallet);
  },

  createUser({ wallet, fullName = "", email = "", phone = "", country = "", investorType = "Individual", role = "investor" }) {
    if (this.isMasterAdmin(wallet)) {
      role = "admin";
    }
    const existing = db.prepare("SELECT * FROM users WHERE LOWER(wallet) = LOWER(?)").get(wallet);
    if (existing) return existing;
    const profileCompleted = fullName && email ? 1 : 0;
    db.prepare(`
      INSERT INTO users (wallet, full_name, email, phone, country, investor_type, role, profile_completed, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(wallet.toLowerCase(), fullName, email, phone, country, investorType, role, profileCompleted, now(), now());
    return db.prepare("SELECT * FROM users WHERE LOWER(wallet) = LOWER(?)").get(wallet);
  },

  updateProfile(wallet, { fullName, email, phone, country, investorType }) {
    const existing = db.prepare("SELECT * FROM users WHERE LOWER(wallet) = LOWER(?)").get(wallet);
    if (!existing) {
      return this.createUser({ wallet, fullName, email, phone, country, investorType });
    }
    const newName = fullName !== undefined ? fullName : existing.full_name;
    const newEmail = email !== undefined ? email : existing.email;
    const newPhone = phone !== undefined ? phone : existing.phone;
    const newCountry = country !== undefined ? country : existing.country;
    const newType = investorType !== undefined ? investorType : existing.investor_type;
    const profileCompleted = (newName && (newEmail || existing.email)) ? 1 : 0;

    db.prepare(`
      UPDATE users 
      SET full_name = ?, email = ?, phone = ?, country = ?, investor_type = ?, profile_completed = ?, updated_at = ?
      WHERE LOWER(wallet) = LOWER(?)
    `).run(newName, newEmail, newPhone, newCountry, newType, profileCompleted, now(), wallet);

    return db.prepare("SELECT * FROM users WHERE LOWER(wallet) = LOWER(?)").get(wallet);
  },

  setUserRole(wallet, role) {
    db.prepare("UPDATE users SET role = ?, updated_at = ? WHERE LOWER(wallet) = LOWER(?)").run(role, now(), wallet);
    return db.prepare("SELECT * FROM users WHERE LOWER(wallet) = LOWER(?)").get(wallet);
  },

  listUsers({ search = "", role = "", limit = 50, offset = 0 } = {}) {
    let query = "SELECT u.*, k.status as kyc_status, k.tx_hash as kyc_tx_hash FROM users u LEFT JOIN kyc_requests k ON LOWER(u.wallet) = LOWER(k.wallet) WHERE 1=1";
    const params = [];

    if (search) {
      query += " AND (LOWER(u.wallet) LIKE ? OR LOWER(u.full_name) LIKE ? OR LOWER(u.email) LIKE ?)";
      const pattern = `%${search.toLowerCase()}%`;
      params.push(pattern, pattern, pattern);
    }
    if (role) {
      query += " AND u.role = ?";
      params.push(role);
    }
    query += " ORDER BY u.created_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    return db.prepare(query).all(...params);
  },

  countUsers(search = "") {
    if (!search) {
      return db.prepare("SELECT COUNT(*) as count FROM users").get().count;
    }
    const pattern = `%${search.toLowerCase()}%`;
    return db.prepare("SELECT COUNT(*) as count FROM users WHERE LOWER(wallet) LIKE ? OR LOWER(full_name) LIKE ? OR LOWER(email) LIKE ?").get(pattern, pattern, pattern).count;
  },

  // --- KYC Requests ---
  submitKyc({ wallet, name, email = "", phone = "", country = "", investorType = "Individual", idFile = null, idFileName = null }) {
    const existing = db.prepare("SELECT * FROM kyc_requests WHERE LOWER(wallet) = LOWER(?)").get(wallet);
    if (existing && existing.status === "approved") {
      return { error: "Already approved", row: existing };
    }

    if (existing) {
      db.prepare(`
        UPDATE kyc_requests 
        SET name = ?, email = ?, phone = ?, country = ?, investor_type = ?, id_file = COALESCE(?, id_file), id_file_name = COALESCE(?, id_file_name),
            status = 'pending', rejection_reason = NULL, reviewer_wallet = NULL, created_at = ?, decided_at = NULL, tx_hash = NULL
        WHERE LOWER(wallet) = LOWER(?)
      `).run(name, email, phone, country, investorType, idFile, idFileName, now(), wallet);
    } else {
      db.prepare(`
        INSERT INTO kyc_requests (wallet, name, email, phone, country, investor_type, id_file, id_file_name, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      `).run(wallet.toLowerCase(), name, email, phone, country, investorType, idFile, idFileName, now());
    }

    this.createUser({ wallet, fullName: name, email, phone, country, investorType });

    return { row: db.prepare("SELECT * FROM kyc_requests WHERE LOWER(wallet) = LOWER(?)").get(wallet) };
  },

  getKyc(wallet) {
    return db.prepare("SELECT * FROM kyc_requests WHERE LOWER(wallet) = LOWER(?)").get(wallet);
  },

  listKyc(status = null, search = "") {
    let query = "SELECT * FROM kyc_requests WHERE 1=1";
    const params = [];
    if (status) {
      query += " AND status = ?";
      params.push(status);
    }
    if (search) {
      query += " AND (LOWER(wallet) LIKE ? OR LOWER(name) LIKE ? OR LOWER(email) LIKE ?)";
      const pattern = `%${search.toLowerCase()}%`;
      params.push(pattern, pattern, pattern);
    }
    query += " ORDER BY created_at DESC";
    return db.prepare(query).all(...params);
  },

  setKycStatus(wallet, status, txHash = null, reason = null, reviewer = null) {
    db.prepare(`
      UPDATE kyc_requests 
      SET status = ?, decided_at = ?, tx_hash = ?, rejection_reason = ?, reviewer_wallet = ?
      WHERE LOWER(wallet) = LOWER(?)
    `).run(status, now(), txHash, reason, reviewer, wallet);
    return db.prepare("SELECT * FROM kyc_requests WHERE LOWER(wallet) = LOWER(?)").get(wallet);
  },

  // --- Audit Logs ---
  addAuditLog({ actorWallet, actorRole, action, targetWallet = null, details = null, txHash = null }) {
    db.prepare(`
      INSERT INTO audit_logs (actor_wallet, actor_role, action, target_wallet, details, tx_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(actorWallet.toLowerCase(), actorRole, action, targetWallet ? targetWallet.toLowerCase() : null, details ? JSON.stringify(details) : null, txHash, now());
  },

  listAuditLogs({ limit = 50, offset = 0, action = null } = {}) {
    let query = "SELECT * FROM audit_logs WHERE 1=1";
    const params = [];
    if (action) {
      query += " AND action = ?";
      params.push(action);
    }
    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);
    return db.prepare(query).all(...params);
  },

  // --- Admin Metrics ---
  getMetrics() {
    const totalUsers = db.prepare("SELECT COUNT(*) as count FROM users").get().count;
    const totalKyc = db.prepare("SELECT COUNT(*) as count FROM kyc_requests").get().count;
    const pendingKyc = db.prepare("SELECT COUNT(*) as count FROM kyc_requests WHERE status = 'pending'").get().count;
    const approvedKyc = db.prepare("SELECT COUNT(*) as count FROM kyc_requests WHERE status = 'approved'").get().count;
    const rejectedKyc = db.prepare("SELECT COUNT(*) as count FROM kyc_requests WHERE status = 'rejected'").get().count;
    const totalAudits = db.prepare("SELECT COUNT(*) as count FROM audit_logs").get().count;
    const recentAudits = db.prepare("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 6").all();
    const recentKyc = db.prepare("SELECT * FROM kyc_requests ORDER BY created_at DESC LIMIT 6").all();

    return {
      totalUsers,
      totalKyc,
      pendingKyc,
      approvedKyc,
      rejectedKyc,
      totalAudits,
      recentAudits,
      recentKyc,
    };
  },

  // --- Events (Indexer) ---
  insertEvent({ contract, type, blockNumber, txHash, logIndex, args }) {
    db.prepare(`
      INSERT OR IGNORE INTO events (contract, type, block_number, tx_hash, log_index, args)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(contract, type, blockNumber, txHash, logIndex, JSON.stringify(args));
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
