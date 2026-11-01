require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const { ethers } = require("ethers");
const db = require("./db");
const { contract, complianceSigner, NETWORK } = require("./chain");
const { start: startIndexer } = require("./indexer");

const app = express();
app.use(express.json());
app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:5173" }));

// DUMMY ID uploads only. Never collect real identity documents in this prototype.
const upload = multer({
  dest: path.join(__dirname, "uploads"),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^(image\/(png|jpeg)|application\/pdf)$/.test(file.mimetype)),
});

function requireAdmin(req, res, next) {
  const key = process.env.ADMIN_API_KEY;
  if (!key || req.get("x-admin-key") !== key) return res.status(401).json({ error: "unauthorised" });
  next();
}

const normalise = (w) => (ethers.isAddress(w) ? ethers.getAddress(w) : null);

app.get("/api/health", (_req, res) => res.json({ ok: true, network: NETWORK }));

// Investor submits KYC details
app.post("/api/kyc", upload.single("idFile"), (req, res) => {
  const wallet = normalise(req.body.wallet);
  const name = (req.body.name || "").trim();
  if (!wallet) return res.status(400).json({ error: "invalid wallet address" });
  if (name.length < 2 || name.length > 100) return res.status(400).json({ error: "name must be 2-100 characters" });
  const result = db.submitKyc({ wallet, name, idFile: req.file ? req.file.filename : null });
  if (result.error) return res.status(409).json({ error: result.error });
  res.status(201).json(result.row);
});

// Investor checks own status (off-chain request) 
app.get("/api/kyc/:wallet", (req, res) => {
  const wallet = normalise(req.params.wallet);
  if (!wallet) return res.status(400).json({ error: "invalid wallet address" });
  const row = db.getKyc(wallet);
  if (!row) return res.status(404).json({ error: "no request found" });
  res.json({ wallet: row.wallet, status: row.status, decided_at: row.decided_at, tx_hash: row.tx_hash });
});

// Admin: list requests
app.get("/api/kyc", requireAdmin, (req, res) => res.json(db.listKyc(req.query.status)));

// Admin: approve -> calls KYCRegistry.addToWhitelist on-chain
app.post("/api/kyc/:wallet/approve", requireAdmin, async (req, res) => {
  const wallet = normalise(req.params.wallet);
  if (!wallet) return res.status(400).json({ error: "invalid wallet address" });
  const row = db.getKyc(wallet);
  if (!row) return res.status(404).json({ error: "no request found" });
  if (row.status === "approved") return res.json(row);
  try {
    const registry = contract("KYCRegistry", complianceSigner());
    const tx = await registry.addToWhitelist(wallet);
    await tx.wait();
    res.json(db.setKycStatus(wallet, "approved", tx.hash));
  } catch (e) {
    res.status(500).json({ error: e.shortMessage || e.message });
  }
});

// Admin: reject (off-chain only)
app.post("/api/kyc/:wallet/reject", requireAdmin, (req, res) => {
  const wallet = normalise(req.params.wallet);
  if (!wallet) return res.status(400).json({ error: "invalid wallet address" });
  if (!db.getKyc(wallet)) return res.status(404).json({ error: "no request found" });
  res.json(db.setKycStatus(wallet, "rejected"));
});

// History from the indexer
app.get("/api/events", (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  res.json(db.listEvents({ type: req.query.type, limit }));
});

const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
  console.log(`Backend on http://localhost:${port} (network: ${NETWORK})`);
  startIndexer();
});
