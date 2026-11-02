// Aura Bonds Platform Backend API Client
const env = (import.meta && import.meta.env) || {};
export const BACKEND_URL = (env.VITE_BACKEND_URL || "http://localhost:4000").replace(/\/$/, "");

const ADMIN_KEY = env.VITE_ADMIN_API_KEY || "";
export const hasAdminKey = () => Boolean(ADMIN_KEY);

// Store session token in localStorage for reliable SPA reloads
const SESSION_KEY = "aura_session_token";
export const getSessionToken = () => {
  try {
    return localStorage.getItem(SESSION_KEY) || "";
  } catch {
    return "";
  }
};

export const setSessionToken = (token) => {
  try {
    if (token) localStorage.setItem(SESSION_KEY, token);
    else localStorage.removeItem(SESSION_KEY);
  } catch {}
};

async function call(path, { method = "GET", body, admin = false, auth = false, timeoutMs = 12000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = {};
    const token = getSessionToken();

    if (token && (auth || !admin)) {
      headers["Authorization"] = `Bearer ${token}`;
      headers["x-session-token"] = token;
    }

    if (admin) {
      if (ADMIN_KEY) headers["x-admin-key"] = ADMIN_KEY;
      if (token) headers["x-session-token"] = token;
    }

    if (body && !(body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
    }

    const res = await fetch(`${BACKEND_URL}${path}`, {
      method,
      headers,
      credentials: "include",
      body: body ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined,
      signal: controller.signal,
    });

    let data = null;
    try {
      data = await res.json();
    } catch {
      /* empty body */
    }

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: (data && data.error) || `Request failed (${res.status})`,
        data,
      };
    }
    return { ok: true, status: res.status, data };
  } catch (e) {
    return {
      ok: false,
      unreachable: true,
      error: e.name === "AbortError" ? "The backend did not respond in time." : "The Aura Bonds backend is not reachable.",
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------
// Health
// ---------------------------------------------
export const backendHealth = () => call("/api/health", { timeoutMs: 3000 });

// ---------------------------------------------
// Authentication
// ---------------------------------------------
export const getAuthNonce = (wallet) => call("/api/auth/nonce", { method: "POST", body: { wallet } });

export async function verifySignature(wallet, signature, metadata = {}) {
  const res = await call("/api/auth/verify", {
    method: "POST",
    body: { wallet, signature, ...metadata },
  });
  if (res.ok && res.data?.token) {
    setSessionToken(res.data.token);
  }
  return res;
}

export async function institutionalLogin({ wallet, signature, adminKey }) {
  const res = await call("/api/auth/institutional-login", {
    method: "POST",
    body: { wallet, signature, adminKey },
  });
  if (res.ok && res.data?.token) {
    setSessionToken(res.data.token);
  }
  return res;
}

export const getCurrentUser = () => call("/api/auth/me", { auth: true });

export const updateProfile = (profileData) => call("/api/profile", { method: "PUT", body: profileData, auth: true });

export async function logoutUser() {
  const res = await call("/api/auth/logout", { method: "POST", auth: true });
  setSessionToken("");
  return res;
}

// ---------------------------------------------
// KYC Management
// ---------------------------------------------
export function submitKyc({ wallet, name, email, phone, country, investorType, file }) {
  const form = new FormData();
  if (wallet) form.append("wallet", wallet);
  form.append("name", name || "");
  if (email) form.append("email", email);
  if (phone) form.append("phone", phone);
  if (country) form.append("country", country);
  if (investorType) form.append("investorType", investorType);
  if (file) form.append("idFile", file);

  return call("/api/kyc", { method: "POST", body: form, auth: true, timeoutMs: 30000 });
}

export const getKycStatus = (wallet) => call(`/api/kyc/${wallet}`);

export function getKycDocumentUrl(wallet) {
  const token = getSessionToken();
  const query = token ? `?token=${encodeURIComponent(token)}` : "";
  return `${BACKEND_URL}/api/kyc/${encodeURIComponent(wallet)}/document${query}`;
}

export const listKyc = (status, search = "") => {
  const params = new URLSearchParams();
  if (status && status !== "all") params.set("status", status);
  if (search) params.set("search", search);
  const q = params.toString() ? `?${params.toString()}` : "";
  return call(`/api/admin/kyc${q}`, { admin: true });
};

export const approveKycRequest = (wallet) => call(`/api/admin/kyc/${wallet}/approve`, { method: "POST", admin: true, timeoutMs: 90000 });

export const rejectKycRequest = (wallet, reason = "") => call(`/api/admin/kyc/${wallet}/reject`, { method: "POST", body: { reason }, admin: true });

// ---------------------------------------------
// Institutional Management & Audit
// ---------------------------------------------
export const getAdminMetrics = () => call("/api/admin/metrics", { admin: true });

export const updateUserRole = (wallet, role) =>
  call(`/api/admin/users/${wallet}/role`, { method: "POST", body: { role }, admin: true });

export const getAdminInvestors = ({ search = "", role = "", limit = 50, offset = 0 } = {}) => {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (role) params.set("role", role);
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  return call(`/api/admin/investors?${params.toString()}`, { admin: true });
};

export const getAdminAuditLogs = ({ limit = 100, offset = 0, action = null } = {}) => {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  if (action) params.set("action", action);
  return call(`/api/admin/audit-logs?${params.toString()}`, { admin: true });
};

export const recordAdminAudit = ({ action, targetWallet, details, txHash }) =>
  call("/api/admin/audit", {
    method: "POST",
    body: { action, targetWallet, details, txHash },
    admin: true,
  });

export const fetchBackendEvents = (limit = 50) => call(`/api/events?limit=${limit}`);

// ---------------------------------------------
// Test MockUSDC Faucet API
// ---------------------------------------------
export const getFaucetInfo = () => call("/api/faucet/info");

export const requestFaucetFunds = (toWallet, amount = 5000) =>
  call("/api/faucet/mint", {
    method: "POST",
    body: { to: toWallet, amount: Number(amount) },
    timeoutMs: 90000,
  });

export const seedDemoInvestor = (wallet, bondCount = 25, periodId = 1) =>
  call("/api/demo/seed-investor", {
    method: "POST",
    body: { wallet, bondCount, periodId },
    timeoutMs: 120000,
  });

export const ID_FILE_LIMIT = 5 * 1024 * 1024;
export const ID_FILE_TYPES = ["image/png", "image/jpeg", "image/jpg", "application/pdf"];
