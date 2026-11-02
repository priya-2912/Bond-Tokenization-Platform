require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { ethers } = require("ethers");
const db = require("./db");
const { contract, complianceSigner, checkOnChainRoles, NETWORK } = require("./chain");
const { start: startIndexer } = require("./indexer");

const app = express();

// Ensure upload directory exists
const uploadDir = path.join(__dirname, "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

app.use(express.json());

// Support cookies and CORS
const allowedOrigins = [
  process.env.CORS_ORIGIN || "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:3000",
];
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, true); // Dev-friendly fallback
      }
    },
    credentials: true,
  })
);

// Basic cookie parser helper
app.use((req, res, next) => {
  const cookieHeader = req.headers.cookie;
  req.cookies = {};
  if (cookieHeader) {
    cookieHeader.split(";").forEach((cookie) => {
      const parts = cookie.split("=");
      const name = parts[0].trim();
      const value = parts.slice(1).join("=").trim();
      req.cookies[name] = decodeURIComponent(value);
    });
  }
  next();
});

// Dummy ID uploads only. Never collect real identity documents in this prototype.
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".bin";
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, unique);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    const allowed = /^(image\/(png|jpeg|jpg)|application\/pdf)$/.test(file.mimetype);
    cb(null, allowed);
  },
});

const normalise = (w) => (w && ethers.isAddress(w) ? ethers.getAddress(w) : null);

// ----------------------------------------------------
// Authentication Middleware
// ----------------------------------------------------
function getSessionToken(req) {
  // Check Authorization Bearer header, x-session-token header, or cookie
  const authHeader = req.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }
  if (req.get("x-session-token")) {
    return req.get("x-session-token").trim();
  }
  if (req.cookies && req.cookies.aura_session) {
    return req.cookies.aura_session;
  }
  return null;
}

function authenticateSession(req, res, next) {
  const token = getSessionToken(req);
  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }
  const session = db.getSession(token);
  if (!session) {
    return res.status(401).json({ error: "Session expired or invalid. Please sign in again." });
  }
  req.session = session;
  req.userWallet = session.wallet;
  req.userRole = session.role;
  next();
}

function optionalSession(req, res, next) {
  const token = getSessionToken(req);
  if (token) {
    const session = db.getSession(token);
    if (session) {
      req.session = session;
      req.userWallet = session.wallet;
      req.userRole = session.role;
    }
  }
  next();
}

async function requireInstitutional(req, res, next) {
  // 1. First allow developer key in header for backward compatibility
  const adminKey = process.env.ADMIN_API_KEY;
  if (adminKey && req.get("x-admin-key") === adminKey) {
    req.userWallet = req.get("x-admin-wallet") || "0x0000000000000000000000000000000000000001";
    req.userRole = "admin";
    return next();
  }

  // 2. Otherwise verify authenticated session with institutional role
  const token = getSessionToken(req);
  if (!token) {
    return res.status(401).json({ error: "Institutional authentication required" });
  }
  const session = db.getSession(token);
  if (!session) {
    return res.status(401).json({ error: "Session expired" });
  }

  // Check role in database or on-chain
  if (["admin", "compliance", "issuer"].includes(session.role)) {
    req.session = session;
    req.userWallet = session.wallet;
    req.userRole = session.role;
    return next();
  }

  // Check on-chain roles for this wallet
  const roles = await checkOnChainRoles(session.wallet);
  if (roles.hasInstitutionalRole) {
    let resolvedRole = "investor";
    if (roles.isAdmin) resolvedRole = "admin";
    else if (roles.isCompliance) resolvedRole = "compliance";
    else if (roles.isIssuer) resolvedRole = "issuer";

    db.setUserRole(session.wallet, resolvedRole);
    req.session = session;
    req.userWallet = session.wallet;
    req.userRole = resolvedRole;
    return next();
  }

  return res.status(403).json({ error: "Forbidden: institutional access required" });
}

// ----------------------------------------------------
// Public & System Endpoints
// ----------------------------------------------------
app.get("/api/health", (_req, res) => res.json({ ok: true, network: NETWORK, timestamp: Date.now() }));

// ----------------------------------------------------
// Authentication Endpoints
// ----------------------------------------------------

// 1. Get nonce / challenge for wallet signature
app.post("/api/auth/nonce", (req, res) => {
  const wallet = normalise(req.body.wallet);
  if (!wallet) return res.status(400).json({ error: "Invalid wallet address" });
  const message = db.generateNonce(wallet);
  res.json({ wallet, message });
});

// 2. Verify signature and create session
app.post("/api/auth/verify", async (req, res) => {
  const wallet = normalise(req.body.wallet);
  const signature = req.body.signature;
  if (!wallet || !signature) {
    return res.status(400).json({ error: "Wallet address and signature required" });
  }

  const expectedMessage = db.getValidNonce(wallet);
  if (!expectedMessage) {
    return res.status(400).json({ error: "Challenge expired or not found. Please request a new nonce." });
  }

  try {
    const recovered = ethers.verifyMessage(expectedMessage, signature);
    if (recovered.toLowerCase() !== wallet.toLowerCase()) {
      return res.status(401).json({ error: "Signature verification failed. Address mismatch." });
    }
  } catch (err) {
    return res.status(400).json({ error: `Invalid signature: ${err.message}` });
  }

  // Consume nonce so it cannot be replayed
  db.consumeNonce(wallet);

  // Check on-chain roles
  const onChainRoles = await checkOnChainRoles(wallet);

  // Determine user role
  let role = "investor";
  if (onChainRoles.isAdmin) role = "admin";
  else if (onChainRoles.isCompliance) role = "compliance";
  else if (onChainRoles.isIssuer) role = "issuer";

  // Create or get user profile
  let user = db.getUser(wallet);
  if (!user) {
    user = db.createUser({
      wallet,
      fullName: req.body.name || "",
      email: req.body.email || "",
      role,
    });
  } else if (onChainRoles.hasInstitutionalRole && user.role !== role) {
    db.setUserRole(wallet, role);
    user.role = role;
  }

  // Create persistent session
  const session = db.createSession(wallet, user.role);

  // Set HTTP-only cookie
  res.cookie("aura_session", session.token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  // Log audit
  db.addAuditLog({
    actorWallet: wallet,
    actorRole: user.role,
    action: "USER_LOGIN",
    targetWallet: wallet,
    details: { method: "wallet_signature", onChainRoles },
  });

  res.json({
    token: session.token,
    user: {
      wallet: user.wallet,
      fullName: user.full_name,
      email: user.email,
      phone: user.phone,
      country: user.country,
      investorType: user.investor_type,
      role: user.role,
      profileCompleted: Boolean(user.profile_completed),
    },
    onChainRoles,
  });
});

// 3. Institutional login (checks role & credentials)
app.post("/api/auth/institutional-login", async (req, res) => {
  const wallet = normalise(req.body.wallet);
  const signature = req.body.signature;
  const adminKey = req.body.adminKey;

  // Support direct compliance / admin key for testing / emergency access
  if (adminKey && adminKey === process.env.ADMIN_API_KEY) {
    const adminWallet = wallet || "0x0000000000000000000000000000000000000001";
    const session = db.createSession(adminWallet, "admin");
    db.createUser({ wallet: adminWallet, fullName: "Platform Administrator", role: "admin" });

    res.cookie("aura_session", session.token, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    db.addAuditLog({
      actorWallet: adminWallet,
      actorRole: "admin",
      action: "INSTITUTIONAL_KEY_LOGIN",
      details: { method: "admin_key" },
    });

    return res.json({
      token: session.token,
      user: {
        wallet: adminWallet,
        fullName: "Platform Administrator",
        role: "admin",
      },
      roles: { isAdmin: true, isCompliance: true, isIssuer: true },
    });
  }

  if (!wallet || !signature) {
    return res.status(400).json({ error: "Institutional wallet address and signature required" });
  }

  const expectedMessage = db.getValidNonce(wallet);
  if (!expectedMessage) {
    return res.status(400).json({ error: "Nonce expired or invalid" });
  }

  try {
    const recovered = ethers.verifyMessage(expectedMessage, signature);
    if (recovered.toLowerCase() !== wallet.toLowerCase()) {
      return res.status(401).json({ error: "Signature verification failed" });
    }
  } catch (err) {
    return res.status(400).json({ error: `Signature verification failed: ${err.message}` });
  }

  db.consumeNonce(wallet);

  // Check required on-chain institutional role
  const onChainRoles = await checkOnChainRoles(wallet);
  const user = db.getUser(wallet);
  const isDbAdmin = user && ["admin", "compliance", "issuer"].includes(user.role);

  if (!onChainRoles.hasInstitutionalRole && !isDbAdmin) {
    return res.status(403).json({
      error: "This wallet does not hold an authorized institutional role (Admin, Compliance Officer, or Issuer) on-chain or in the registry.",
      onChainRoles,
    });
  }

  let role = "admin";
  if (onChainRoles.isAdmin) role = "admin";
  else if (onChainRoles.isCompliance) role = "compliance";
  else if (onChainRoles.isIssuer) role = "issuer";
  else if (user) role = user.role;

  db.createUser({ wallet, role, fullName: user?.full_name || "Institutional Officer" });
  db.setUserRole(wallet, role);
  const session = db.createSession(wallet, role);

  res.cookie("aura_session", session.token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  db.addAuditLog({
    actorWallet: wallet,
    actorRole: role,
    action: "INSTITUTIONAL_LOGIN",
    details: { onChainRoles },
  });

  res.json({
    token: session.token,
    user: {
      wallet,
      role,
      fullName: user?.full_name || "Institutional Officer",
    },
    onChainRoles,
  });
});

// 4. Get current authenticated user
app.get("/api/auth/me", authenticateSession, async (req, res) => {
  let user = db.getUser(req.userWallet);
  if (!user) {
    user = db.createUser({ wallet: req.userWallet, role: req.userRole });
  }
  const kyc = db.getKyc(req.userWallet);
  const onChainRoles = await checkOnChainRoles(req.userWallet);

  res.json({
    user: {
      wallet: user.wallet,
      fullName: user.full_name,
      email: user.email,
      phone: user.phone,
      country: user.country,
      investorType: user.investor_type,
      role: user.role,
      profileCompleted: Boolean(user.profile_completed),
      createdAt: user.created_at,
    },
    kyc: kyc
      ? {
          status: kyc.status,
          rejectionReason: kyc.rejection_reason,
          decidedAt: kyc.decided_at,
          txHash: kyc.tx_hash,
          hasDocument: Boolean(kyc.id_file),
        }
      : { status: "none" },
    onChainRoles,
  });
});

// 5. Update investor profile
app.put("/api/profile", authenticateSession, (req, res) => {
  const { fullName, email, phone, country, investorType } = req.body;
  const updated = db.updateProfile(req.userWallet, {
    fullName,
    email,
    phone,
    country,
    investorType,
  });

  db.addAuditLog({
    actorWallet: req.userWallet,
    actorRole: req.userRole,
    action: "PROFILE_UPDATED",
    targetWallet: req.userWallet,
    details: { fullName, email, country, investorType },
  });

  res.json({
    wallet: updated.wallet,
    fullName: updated.full_name,
    email: updated.email,
    phone: updated.phone,
    country: updated.country,
    investorType: updated.investor_type,
    role: updated.role,
    profileCompleted: Boolean(updated.profile_completed),
  });
});

// 6. Logout
app.post("/api/auth/logout", (req, res) => {
  const token = getSessionToken(req);
  if (token) db.deleteSession(token);
  res.clearCookie("aura_session");
  res.json({ ok: true });
});

// ----------------------------------------------------
// KYC Endpoints
// ----------------------------------------------------

// Investor submits or updates KYC application
app.post("/api/kyc", upload.single("idFile"), (req, res) => {
  // Support both authenticated session or wallet in body
  const token = getSessionToken(req);
  const session = token ? db.getSession(token) : null;
  const wallet = normalise(session ? session.wallet : req.body.wallet);
  const name = (req.body.name || req.body.fullName || "").trim();
  const email = (req.body.email || "").trim();
  const phone = (req.body.phone || "").trim();
  const country = (req.body.country || "").trim();
  const investorType = (req.body.investorType || "Individual").trim();

  if (!wallet) return res.status(400).json({ error: "Valid wallet address required" });
  if (name.length < 2 || name.length > 100) {
    return res.status(400).json({ error: "Full legal name must be between 2 and 100 characters" });
  }

  const idFile = req.file ? req.file.filename : null;
  const idFileName = req.file ? req.file.originalname : null;

  const result = db.submitKyc({
    wallet,
    name,
    email,
    phone,
    country,
    investorType,
    idFile,
    idFileName,
  });

  if (result.error) return res.status(409).json({ error: result.error });

  db.addAuditLog({
    actorWallet: wallet,
    actorRole: "investor",
    action: "KYC_SUBMITTED",
    targetWallet: wallet,
    details: { name, email, country, idFileName: idFileName || "None" },
  });

  res.status(201).json(result.row);
});

// Investor checks own status
app.get("/api/kyc/:wallet", (req, res) => {
  const wallet = normalise(req.params.wallet);
  if (!wallet) return res.status(400).json({ error: "Invalid wallet address" });

  const row = db.getKyc(wallet);
  if (!row) return res.status(404).json({ error: "No KYC application found" });

  res.json({
    wallet: row.wallet,
    name: row.name,
    status: row.status,
    decided_at: row.decided_at,
    tx_hash: row.tx_hash,
    rejection_reason: row.rejection_reason,
    created_at: row.created_at,
    has_document: Boolean(row.id_file),
    document_name: row.id_file_name,
  });
});

// Secure preview of KYC document (restricted to applicant or compliance officer/admin)
app.get("/api/kyc/:wallet/document", optionalSession, async (req, res) => {
  const wallet = normalise(req.params.wallet);
  if (!wallet) return res.status(400).json({ error: "Invalid wallet address" });

  const row = db.getKyc(wallet);
  if (!row || !row.id_file) {
    return res.status(404).json({ error: "No identity document on file" });
  }

  // Access control:
  // Allowed if:
  // 1. Dev admin key provided
  const adminKey = process.env.ADMIN_API_KEY;
  const isKeyAdmin = adminKey && req.get("x-admin-key") === adminKey;

  // 2. Or caller is logged in as the document owner
  const isOwner = req.userWallet && req.userWallet.toLowerCase() === wallet.toLowerCase();

  // 3. Or caller is an institutional admin/compliance officer
  const isInstitutional = req.userRole && ["admin", "compliance"].includes(req.userRole);

  if (!isKeyAdmin && !isOwner && !isInstitutional) {
    return res.status(403).json({ error: "Unauthorized access to confidential identity document" });
  }

  const filePath = path.join(uploadDir, row.id_file);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found on server" });
  }

  // Prevent browser caching & sniffing
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-cache, no-store, must-revalidate");

  // Determine mime type
  const ext = path.extname(row.id_file).toLowerCase();
  let contentType = "application/octet-stream";
  if (ext === ".pdf") contentType = "application/pdf";
  else if (ext === ".png") contentType = "image/png";
  else if (ext === ".jpg" || ext === ".jpeg") contentType = "image/jpeg";

  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `inline; filename="${row.id_file_name || "kyc-document" + ext}"`);

  fs.createReadStream(filePath).pipe(res);
});

// ----------------------------------------------------
// Institutional / Admin Management Endpoints
// ----------------------------------------------------

// Admin: update a user's institutional role (Super Admin permission)
app.post("/api/admin/users/:wallet/role", requireInstitutional, (req, res) => {
  const targetWallet = normalise(req.params.wallet);
  const newRole = (req.body.role || "").toLowerCase();
  if (!targetWallet) return res.status(400).json({ error: "Invalid target wallet address" });

  const validRoles = ["admin", "compliance", "issuer", "investor"];
  if (!validRoles.includes(newRole)) {
    return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(", ")}` });
  }

  // Only super admin or master admin can change roles
  const isMaster = db.isMasterAdmin(req.userWallet);
  if (!isMaster && req.userRole !== "admin") {
    return res.status(403).json({ error: "Only Super Administrators can assign roles" });
  }

  const updated = db.setUserRole(targetWallet, newRole);

  db.addAuditLog({
    actorWallet: req.userWallet,
    actorRole: req.userRole || "admin",
    action: "ROLE_CHANGED",
    targetWallet,
    details: { newRole },
  });

  res.json({ ok: true, user: updated });
});

// Admin metrics overview
app.get("/api/admin/metrics", requireInstitutional, (_req, res) => {
  const metrics = db.getMetrics();
  res.json(metrics);
});

// List all registered investors
app.get("/api/admin/investors", requireInstitutional, (req, res) => {
  const search = req.query.search || "";
  const role = req.query.role || "";
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;

  const users = db.listUsers({ search, role, limit, offset });
  const total = db.countUsers(search);

  res.json({ users, total, limit, offset });
});

// Admin: list KYC requests with optional status filter and search
app.get("/api/admin/kyc", requireInstitutional, (req, res) => {
  const status = req.query.status || null;
  const search = req.query.search || "";
  res.json(db.listKyc(status, search));
});

// Backward compatibility alias for legacy GET /api/kyc
app.get("/api/kyc", requireInstitutional, (req, res) => {
  res.json(db.listKyc(req.query.status));
});

// Admin: approve -> calls KYCRegistry.addToWhitelist on-chain
app.post("/api/admin/kyc/:wallet/approve", requireInstitutional, async (req, res) => {
  const wallet = normalise(req.params.wallet);
  if (!wallet) return res.status(400).json({ error: "Invalid wallet address" });

  const row = db.getKyc(wallet);
  if (!row) return res.status(404).json({ error: "No KYC application found" });

  if (row.status === "approved" && row.tx_hash) {
    return res.json(row);
  }

  try {
    const signer = complianceSigner();
    const registry = contract("KYCRegistry", signer);

    // Verify compliance role of the server signer
    const hasRole = await registry.hasRole(ethers.id("COMPLIANCE_ROLE"), signer.address).catch(() => true);
    if (!hasRole) {
      console.warn(`Signer ${signer.address} lacks COMPLIANCE_ROLE on-chain.`);
    }

    const tx = await registry.addToWhitelist(wallet);
    const receipt = await tx.wait();

    const updated = db.setKycStatus(wallet, "approved", receipt.hash, null, req.userWallet);

    db.addAuditLog({
      actorWallet: req.userWallet,
      actorRole: req.userRole || "compliance",
      action: "KYC_APPROVED",
      targetWallet: wallet,
      details: { name: row.name },
      txHash: receipt.hash,
    });

    res.json(updated);
  } catch (e) {
    console.error("KYC approval blockchain error:", e);
    res.status(500).json({ error: e.shortMessage || e.message || "Failed to execute on-chain whitelist transaction" });
  }
});

// Backward compatibility for legacy approve route
app.post("/api/kyc/:wallet/approve", requireInstitutional, async (req, res) => {
  const wallet = normalise(req.params.wallet);
  if (!wallet) return res.status(400).json({ error: "Invalid wallet address" });
  const row = db.getKyc(wallet);
  if (!row) return res.status(404).json({ error: "No request found" });
  if (row.status === "approved" && row.tx_hash) return res.json(row);

  try {
    const registry = contract("KYCRegistry", complianceSigner());
    const tx = await registry.addToWhitelist(wallet);
    const receipt = await tx.wait();
    const updated = db.setKycStatus(wallet, "approved", receipt.hash, null, req.userWallet);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.shortMessage || e.message });
  }
});

// Admin: reject KYC with optional reason
app.post("/api/admin/kyc/:wallet/reject", requireInstitutional, (req, res) => {
  const wallet = normalise(req.params.wallet);
  const reason = (req.body.reason || "Verification documents did not meet requirements").trim();
  if (!wallet) return res.status(400).json({ error: "Invalid wallet address" });

  const existing = db.getKyc(wallet);
  if (!existing) return res.status(404).json({ error: "No KYC application found" });

  const updated = db.setKycStatus(wallet, "rejected", null, reason, req.userWallet);

  db.addAuditLog({
    actorWallet: req.userWallet,
    actorRole: req.userRole || "compliance",
    action: "KYC_REJECTED",
    targetWallet: wallet,
    details: { reason, name: existing.name },
  });

  res.json(updated);
});

// Backward compatibility for legacy reject route
app.post("/api/kyc/:wallet/reject", requireInstitutional, (req, res) => {
  const wallet = normalise(req.params.wallet);
  const reason = (req.body.reason || "Application rejected").trim();
  if (!wallet) return res.status(400).json({ error: "Invalid wallet address" });
  if (!db.getKyc(wallet)) return res.status(404).json({ error: "No request found" });
  res.json(db.setKycStatus(wallet, "rejected", null, reason, req.userWallet));
});

// Compliance & Audit Trail API
app.get("/api/admin/audit-logs", requireInstitutional, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Number(req.query.offset) || 0;
  const action = req.query.action || null;
  res.json(db.listAuditLogs({ limit, offset, action }));
});

// Record custom administrative audit action (e.g., pause, oracle update, snapshot recorded)
app.post("/api/admin/audit", requireInstitutional, (req, res) => {
  const { action, targetWallet, details, txHash } = req.body;
  if (!action) return res.status(400).json({ error: "Action name required" });

  db.addAuditLog({
    actorWallet: req.userWallet,
    actorRole: req.userRole || "admin",
    action,
    targetWallet,
    details,
    txHash,
  });

  res.status(201).json({ ok: true });
});

// ----------------------------------------------------
// Test MockUSDC Faucet API
// ----------------------------------------------------
app.get("/api/faucet/info", (req, res) => {
  try {
    const deploymentData = require("./chain").deployment ? require("./chain").deployment() : {};
    res.json({
      ok: true,
      contract: deploymentData.MockUSDC || "0xfda038bc24b03a551d48eFB91E452F5f02654a2F",
      network: NETWORK,
      decimals: 6,
      maxLimit: 100000,
      standardAmount: 5000,
    });
  } catch (err) {
    res.json({
      ok: true,
      contract: "0xfda038bc24b03a551d48eFB91E452F5f02654a2F",
      network: NETWORK,
      decimals: 6,
      maxLimit: 100000,
      standardAmount: 5000,
    });
  }
});

app.post("/api/faucet/mint", async (req, res) => {
  const targetWallet = normalise(req.body.to || req.body.wallet);
  const amountNum = Number(req.body.amount || 5000);

  if (!targetWallet) {
    return res.status(400).json({ error: "Valid recipient wallet address is required." });
  }
  if (!Number.isFinite(amountNum) || amountNum <= 0 || amountNum > 100000) {
    return res.status(400).json({ error: "Amount must be between 1 and 100,000 MockUSDC." });
  }

  try {
    const signer = complianceSigner();
    const usdc = contract("MockUSDC", signer);
    const rawAmount = ethers.parseUnits(amountNum.toString(), 6);

    const tx = await usdc.mint(targetWallet, rawAmount);
    const receipt = await tx.wait();

    try {
      db.addAuditLog({
        actorWallet: signer.address,
        actorRole: "faucet_relayer",
        action: "faucet_mint_usdc",
        targetWallet,
        details: { amount: amountNum, unit: "mUSDC" },
        txHash: receipt.hash,
      });
    } catch {}

    return res.json({
      ok: true,
      txHash: receipt.hash,
      recipient: targetWallet,
      amount: amountNum,
      blockNumber: receipt.blockNumber,
    });
  } catch (err) {
    console.error("[Faucet] Minting error:", err);
    return res.status(500).json({
      ok: false,
      error: err.reason || err.shortMessage || err.message || "Failed to execute faucet mint on blockchain",
    });
  }
});

// ----------------------------------------------------
// Demo & Seed Helper for Testing Portfolios and Coupon Claiming
// ----------------------------------------------------
app.post("/api/demo/seed-investor", async (req, res) => {
  const targetWallet = normalise(req.body.wallet || req.body.to || "0xE3a9419109499d6A67507F67D04ce97075f6E78C");
  const bondCount = Number(req.body.bondCount || 25); // 25 AURA-BOND = $25,000 face value
  const periodId = Number(req.body.periodId || 1);

  if (!targetWallet) {
    return res.status(400).json({ error: "Valid target wallet address required." });
  }

  const logs = [];

  try {
    const signer = complianceSigner();
    const kyc = contract("KYCRegistry", signer);
    const bond = contract("BondToken", signer);
    const usdc = contract("MockUSDC", signer);
    const dist = contract("CouponDistributor", signer);
    const distAddress = await dist.getAddress();

    // 1. Whitelist investor on KYCRegistry if needed
    const isVerified = await kyc.isVerified(targetWallet).catch(() => false);
    if (!isVerified) {
      logs.push(`Whitelisting ${targetWallet} on KYCRegistry...`);
      const tx = await kyc.addToWhitelist(targetWallet);
      await tx.wait();
      logs.push(`Whitelisted successfully. Tx: ${tx.hash}`);
    } else {
      logs.push(`${targetWallet} is already KYC verified.`);
    }

    // Ensure database profile exists and is approved
    try {
      let user = db.getUser(targetWallet);
      if (!user) {
        db.createUser({ wallet: targetWallet, fullName: "Demo Investor", role: "investor" });
      }
      db.setKycStatus(targetWallet, "approved", null, null, signer.address);
    } catch (e) {
      console.warn("DB user update note:", e.message);
    }

    // 2. Transfer or Mint BondTokens to investor
    const targetBondWei = ethers.parseUnits(bondCount.toString(), 18);
    const currentBondBal = await bond.balanceOf(targetWallet);

    if (currentBondBal < targetBondWei) {
      const neededWei = targetBondWei - currentBondBal;
      const signerBondBal = await bond.balanceOf(signer.address);

      if (signerBondBal >= neededWei) {
        logs.push(`Transferring ${ethers.formatUnits(neededWei, 18)} AURA-BOND from treasury to ${targetWallet}...`);
        const tx = await bond.transfer(targetWallet, neededWei);
        await tx.wait();
        logs.push(`Bond transfer complete. Tx: ${tx.hash}`);
      } else {
        logs.push(`Minting ${ethers.formatUnits(neededWei, 18)} AURA-BOND directly to ${targetWallet}...`);
        const tx = await bond.mint(targetWallet, neededWei);
        await tx.wait();
        logs.push(`Bond mint complete. Tx: ${tx.hash}`);
      }
    } else {
      logs.push(`${targetWallet} already holds ${ethers.formatUnits(currentBondBal, 18)} AURA-BOND.`);
    }

    // 3. Ensure CouponDistributor has pool funds
    const poolBal = await usdc.balanceOf(distAddress);
    const minPoolWei = ethers.parseUnits("5000", 6);
    if (poolBal < minPoolWei) {
      logs.push("Funding CouponDistributor pool with MockUSDC...");
      const mintAmount = ethers.parseUnits("10000", 6);
      const mintTx = await usdc.mint(signer.address, mintAmount);
      await mintTx.wait();
      const appTx = await usdc.approve(distAddress, mintAmount);
      await appTx.wait();
      const depTx = await dist.depositCouponFunds(mintAmount);
      await depTx.wait();
      logs.push("Deposited $10,000 MockUSDC to Coupon Pool.");
    } else {
      logs.push(`CouponDistributor pool already has $${ethers.formatUnits(poolBal, 6)} MockUSDC.`);
    }

    // 4. Record Snapshot for Period 1
    const finalBondBal = await bond.balanceOf(targetWallet);
    const snapBal = await dist.snapshotBalances(periodId, targetWallet);

    if (snapBal < finalBondBal) {
      logs.push(`Recording snapshot for Period ${periodId}: ${targetWallet} with ${ethers.formatUnits(finalBondBal, 18)} bonds...`);
      const snapTx = await dist.recordSnapshot(periodId, [targetWallet], [finalBondBal]);
      await snapTx.wait();
      logs.push(`Snapshot recorded for Period ${periodId}. Tx: ${snapTx.hash}`);
    } else {
      logs.push(`Snapshot for Period ${periodId} already recorded (${ethers.formatUnits(snapBal, 18)} bonds).`);
    }

    // 5. Query claimable amount
    let claimableUSDC = 0n;
    try {
      claimableUSDC = await dist.getClaimableCoupon(periodId, targetWallet);
    } catch {}

    const hasClaimed = await dist.hasClaimed(periodId, targetWallet).catch(() => false);

    return res.json({
      ok: true,
      wallet: targetWallet,
      bondsHeld: ethers.formatUnits(finalBondBal, 18),
      periodId,
      claimableUSDC: ethers.formatUnits(claimableUSDC, 6),
      hasClaimed,
      logs,
    });
  } catch (err) {
    console.error("[Demo Seed Error]:", err);
    return res.status(500).json({
      ok: false,
      error: err.reason || err.shortMessage || err.message || "Failed to seed demo investments",
      logs,
    });
  }
});

// ----------------------------------------------------
// Indexed Event History
// ----------------------------------------------------
app.get("/api/events", (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  res.json(db.listEvents({ type: req.query.type, limit }));
});

const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
  console.log(`[Aura Bonds Backend] Running on http://localhost:${port} (Network: ${NETWORK})`);
  try {
    startIndexer();
  } catch (err) {
    console.warn("Indexer initialization deferred:", err.message);
  }
});
