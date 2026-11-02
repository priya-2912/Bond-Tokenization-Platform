import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { ethers } from "ethers";
import {
  NETWORKS,
  getContract,
  getReadProvider,
  isDeployed,
  switchWalletNetwork,
} from "../contracts/platform";
import { useRoles, MASTER_ADMIN_WALLET } from "../lib/useRoles";
import { friendlyError } from "../lib/utils";
import {
  getAuthNonce,
  verifySignature,
  institutionalLogin as apiInstitutionalLogin,
  getCurrentUser,
  updateProfile as apiUpdateProfile,
  logoutUser,
  getSessionToken,
  setSessionToken,
} from "../lib/backend";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [account, setAccount] = useState(null);
  const [signer, setSigner] = useState(null);
  const [walletChainId, setWalletChainId] = useState(null);
  const [network, setNetwork] = useState("sepolia"); // Default to deployed Sepolia
  const [user, setUser] = useState(null);
  const [kycData, setKycData] = useState({ status: "none" });
  const [isKycVerified, setIsKycVerified] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [authLoading, setAuthLoading] = useState(true);
  const userDisconnected = useRef(false);

  const readProvider = getReadProvider(network);
  const deployed = isDeployed(network);
  const chainOk = walletChainId === NETWORKS[network].chainId;
  const activeSigner = account && chainOk ? signer : null;
  const roles = useRoles(account, readProvider, network, refreshTrigger);

  const syncWallet = useCallback(async (requestAccounts = false) => {
    if (!window.ethereum) return null;
    const bp = new ethers.BrowserProvider(window.ethereum);
    try {
      const accounts = await bp.send(requestAccounts ? "eth_requestAccounts" : "eth_accounts", []);
      const chainHex = await bp.send("eth_chainId", []);
      const chainId = parseInt(chainHex, 16);
      setWalletChainId(chainId);

      if (accounts.length > 0 && !userDisconnected.current) {
        const addr = ethers.getAddress(accounts[0]);
        setAccount(addr);
        setSigner(await bp.getSigner());
        return { account: addr, chainId };
      } else {
        setAccount(null);
        setSigner(null);
        return { account: null, chainId };
      }
    } catch (err) {
      console.warn("Wallet sync error:", err);
      return null;
    }
  }, []);

  // Initial wallet detection & change listeners
  useEffect(() => {
    if (!window.ethereum) {
      setAuthLoading(false);
      return undefined;
    }
    (async () => {
      try {
        const res = await syncWallet(false);
        if (res && res.chainId) {
          const match = Object.keys(NETWORKS).find((k) => NETWORKS[k].chainId === res.chainId);
          if (match) setNetwork(match);
        }
      } catch (e) {
        console.warn("Could not read wallet state:", e);
      } finally {
        setAuthLoading(false);
      }
    })();

    const refresh = () => syncWallet(false).catch((e) => console.warn(e));
    if (window.ethereum.on) {
      window.ethereum.on("accountsChanged", refresh);
      window.ethereum.on("chainChanged", refresh);
    }
    return () => {
      if (window.ethereum.removeListener) {
        window.ethereum.removeListener("accountsChanged", refresh);
        window.ethereum.removeListener("chainChanged", refresh);
      }
    };
  }, [syncWallet]);

  // Load backend session if token exists
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = getSessionToken();
      if (!token) return;
      try {
        const res = await getCurrentUser();
        if (!cancelled && res.ok && res.data?.user) {
          setUser(res.data.user);
          if (res.data.kyc) setKycData(res.data.kyc);
        } else if (!cancelled && res.status === 401) {
          setSessionToken("");
          setUser(null);
        }
      } catch (err) {
        console.warn("Could not load authenticated session:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [account, refreshTrigger]);

  // Check on-chain KYC status from KYCRegistry
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!account || !deployed) {
        setIsKycVerified(false);
        return;
      }
      try {
        const kyc = getContract("KYCRegistry", readProvider, network);
        const verified = await kyc.isVerified(account);
        if (!cancelled) setIsKycVerified(Boolean(verified));
      } catch (e) {
        if (!cancelled) setIsKycVerified(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [account, readProvider, network, deployed, refreshTrigger]);

  // Connect wallet
  const connectWallet = async () => {
    if (!window.ethereum) {
      throw new Error("No Web3 wallet found. Please install MetaMask to interact with the platform.");
    }
    userDisconnected.current = false;
    const res = await syncWallet(true);
    if (!res || !res.account) {
      throw new Error("Wallet connection was not approved.");
    }
    return res.account;
  };

  // Switch chain
  const switchChain = async () => {
    await switchWalletNetwork(network);
    await syncWallet(false);
  };

  // Login with signed message
  const loginWithWallet = async (profileMetadata = {}) => {
    let targetAccount = account;
    let targetSigner = signer;

    if (!targetAccount || !targetSigner) {
      targetAccount = await connectWallet();
      const bp = new ethers.BrowserProvider(window.ethereum);
      targetSigner = await bp.getSigner();
      setAccount(targetAccount);
      setSigner(targetSigner);
    }

    // Step 1: get nonce from backend
    const nonceRes = await getAuthNonce(targetAccount);
    if (!nonceRes.ok) {
      throw new Error(nonceRes.error || "Failed to generate authentication challenge from server");
    }

    const message = nonceRes.data.message;

    // Step 2: request MetaMask to sign message
    let signature;
    try {
      signature = await targetSigner.signMessage(message);
    } catch (err) {
      if (err.code === "ACTION_REJECTED" || err.code === 4001) {
        throw new Error("Authentication request was cancelled in your wallet.");
      }
      throw err;
    }

    // Step 3: verify with backend
    const verifyRes = await verifySignature(targetAccount, signature, profileMetadata);
    if (!verifyRes.ok) {
      throw new Error(verifyRes.error || "Server signature verification failed");
    }

    setUser(verifyRes.data.user);
    setRefreshTrigger((n) => n + 1);
    return verifyRes.data.user;
  };

  // Institutional login
  const loginInstitutional = async ({ adminKey = "" } = {}) => {
    if (adminKey) {
      const res = await apiInstitutionalLogin({ adminKey, wallet: account });
      if (!res.ok) throw new Error(res.error || "Institutional key authorization failed");
      setUser(res.data.user);
      setRefreshTrigger((n) => n + 1);
      return res.data.user;
    }

    let targetAccount = account;
    let targetSigner = signer;
    if (!targetAccount || !targetSigner) {
      targetAccount = await connectWallet();
      const bp = new ethers.BrowserProvider(window.ethereum);
      targetSigner = await bp.getSigner();
      setAccount(targetAccount);
      setSigner(targetSigner);
    }

    const nonceRes = await getAuthNonce(targetAccount);
    if (!nonceRes.ok) throw new Error(nonceRes.error || "Failed to request challenge");

    const signature = await targetSigner.signMessage(nonceRes.data.message);
    const res = await apiInstitutionalLogin({ wallet: targetAccount, signature });
    if (!res.ok) throw new Error(res.error || "Institutional authorization rejected");

    setUser(res.data.user);
    setRefreshTrigger((n) => n + 1);
    return res.data.user;
  };

  // Logout
  const logout = async () => {
    userDisconnected.current = true;
    try {
      await logoutUser();
    } catch {}
    setSessionToken("");
    setUser(null);
    setAccount(null);
    setSigner(null);
    setRefreshTrigger((n) => n + 1);
  };

  // Update profile
  const updateUserProfile = async (profileData) => {
    const res = await apiUpdateProfile(profileData);
    if (!res.ok) throw new Error(res.error || "Failed to update profile");
    setUser((prev) => ({ ...prev, ...res.data }));
    return res.data;
  };

  const isInstitutional = Boolean(
    (account && account.toLowerCase() === MASTER_ADMIN_WALLET) ||
    roles?.isMasterAdmin ||
    roles?.admin ||
    roles?.compliance ||
    roles?.issuer ||
    (user && (user.role === "admin" || user.role === "super_admin" || user.role === "compliance" || user.role === "issuer"))
  );

  const value = {
    account,
    signer: activeSigner,
    walletChainId,
    network,
    setNetwork,
    readProvider,
    deployed,
    chainOk,
    user,
    isAuthenticated: Boolean(user),
    isInstitutional,
    isKycVerified,
    kycData,
    roles,
    authLoading,
    refreshTrigger,
    setRefreshTrigger,
    connectWallet,
    switchChain,
    loginWithWallet,
    loginInstitutional,
    logout,
    updateUserProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

