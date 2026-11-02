import React, { createContext, useContext, useState, useCallback } from "react";
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from "lucide-react";

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((type, message, duration = 5000) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, type, message }]);

    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = {
    success: (msg, dur) => addToast("success", msg, dur),
    error: (msg, dur) => addToast("error", msg, dur),
    info: (msg, dur) => addToast("info", msg, dur),
    warn: (msg, dur) => addToast("warn", msg, dur),
  };

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast-container" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            {t.type === "success" && <CheckCircle2 size={18} color="#34d399" style={{ flexShrink: 0, marginTop: 1 }} />}
            {t.type === "error" && <AlertCircle size={18} color="#fb7185" style={{ flexShrink: 0, marginTop: 1 }} />}
            {t.type === "info" && <Info size={18} color="#60a5fa" style={{ flexShrink: 0, marginTop: 1 }} />}
            {t.type === "warn" && <AlertTriangle size={18} color="#fbbf24" style={{ flexShrink: 0, marginTop: 1 }} />}
            <div style={{ flex: 1 }}>{t.message}</div>
            <button
              onClick={() => removeToast(t.id)}
              style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", opacity: 0.7, padding: 2 }}
              aria-label="Close notification"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      success: (m) => console.log("[Toast Success]", m),
      error: (m) => console.error("[Toast Error]", m),
      info: (m) => console.log("[Toast Info]", m),
      warn: (m) => console.warn("[Toast Warn]", m),
    };
  }
  return ctx;
}

