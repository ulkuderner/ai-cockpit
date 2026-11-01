/**
 * @file TokenGate.tsx
 * @description AI Cockpit access-token prompt: shown when the server answers 401 (remote mode with DASHBOARD_TOKEN). Stores the token where the API client and WebSocket read it, then reloads.
 * @author Caglar Ulkuderner
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyRound } from "lucide-react";

export function TokenGate() {
  const { t } = useTranslation("cockpit");
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener("cockpit:unauthorized", show);
    return () => window.removeEventListener("cockpit:unauthorized", show);
  }, []);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="token-gate-title"
    >
      <form
        className="card w-full max-w-md p-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          try {
            localStorage.setItem("dashboard_token", value.trim());
          } catch {
            /* storage blocked */
          }
          window.location.reload();
        }}
      >
        <div className="flex items-center gap-2">
          <KeyRound className="w-5 h-5 text-accent" aria-hidden />
          <h2 id="token-gate-title" className="text-base font-semibold text-gray-100">
            {t("tokenGate.title")}
          </h2>
        </div>
        <p className="text-sm text-gray-400">{t("tokenGate.text")}</p>
        <input
          autoFocus
          type="password"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t("tokenGate.placeholder")}
          aria-label={t("tokenGate.placeholder")}
          className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-gray-100 font-mono focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <button
          type="submit"
          disabled={!value.trim()}
          className="w-full rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-40 px-4 py-2 text-sm font-medium text-white"
        >
          {t("tokenGate.save")}
        </button>
      </form>
    </div>
  );
}
