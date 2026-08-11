"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { getLoginErrorMessage, isNextRedirectError } from "@/lib/login-errors";
import { microsoftSignIn } from "./actions";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const errorCode = searchParams.get("error");
  const urlErrorMessage = getLoginErrorMessage(errorCode);

  useEffect(() => {
    if (urlErrorMessage) {
      setLocalError(urlErrorMessage);
      toast.error(urlErrorMessage, { duration: 8000 });
    }
  }, [urlErrorMessage]);

  const handleSignIn = async () => {
    setLoading(true);
    setLocalError(null);
    try {
      const result = await microsoftSignIn();
      if (!result.ok) {
        const msg = getLoginErrorMessage(result.error);
        setLocalError(msg);
        toast.error(msg, { duration: 8000 });
        setLoading(false);
      }
    } catch (err) {
      if (isNextRedirectError(err)) throw err;
      const msg = getLoginErrorMessage("Default");
      setLocalError(msg);
      toast.error(msg, { duration: 8000 });
      setLoading(false);
    }
  };

  const displayError = localError || urlErrorMessage;

  return (
    <div className="min-h-screen flex" style={{ background: "var(--bg-page)" }}>
      <div
        className="hidden md:flex flex-col justify-between w-[420px] shrink-0 p-8"
        style={{ background: "var(--bg-sidebar)", color: "#ffffff" }}
      >
        <div>
          <div className="flex items-center gap-3 mb-8">
            <img src="/brandlogo/rocks.png" alt="Form Portal" width={40} height={40} className="brightness-0 invert" />
            <span className="text-[22px] font-bold">Form Portal</span>
          </div>
          <p className="text-[14px] leading-relaxed opacity-80">
            Internal portal for Rocks Group — office forms, requests, and approvals in one place.
          </p>
        </div>
        <p className="text-[11px] opacity-40 mt-4">Rocks Group — Form Portal</p>
      </div>

      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="flex md:hidden items-center justify-center gap-2 mb-8">
            <img src="/brandlogo/rocks.png" alt="Form Portal" width={32} height={32} />
            <span className="text-[18px] font-bold" style={{ color: "var(--text-heading)" }}>Form Portal</span>
          </div>

          <h1 className="text-[20px] font-bold mb-2" style={{ color: "var(--text-heading)" }}>Sign in</h1>
          <p className="text-[13px] mb-6" style={{ color: "var(--text-muted)" }}>
            Use your Rocks Group Microsoft account to continue.
          </p>

          {displayError && (
            <div
              role="alert"
              className="flex gap-2.5 text-[12px] px-3 py-3 rounded-lg mb-4"
              style={{
                background: "rgba(220,38,38,0.1)",
                color: "var(--color-danger)",
                border: "1px solid rgba(220,38,38,0.25)",
              }}
            >
              <AlertCircle size={18} className="shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold mb-0.5">เข้าสู่ระบบไม่สำเร็จ</p>
                <p className="leading-relaxed opacity-90">{displayError}</p>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={handleSignIn}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl text-[14px] font-bold cursor-pointer transition-opacity disabled:opacity-50 disabled:cursor-not-allowed btn-lift"
            style={{ background: "var(--btn-primary-bg)", color: "var(--btn-primary-text)", border: "none" }}
          >
            {loading ? (
              <span
                className="inline-block w-4 h-4 border-2 rounded-full animate-spin"
                style={{ borderColor: "currentColor", borderTopColor: "transparent" }}
              />
            ) : (
              <svg width="20" height="20" viewBox="0 0 21 21" fill="none" aria-hidden>
                <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
              </svg>
            )}
            Sign in with Microsoft
          </button>
        </div>
      </div>
    </div>
  );
}
