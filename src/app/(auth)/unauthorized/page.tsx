"use client";

import Link from "next/link";
import { ShieldX, ArrowLeft } from "lucide-react";

export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "var(--bg-page)" }}>
      <div className="text-center max-w-md">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
          style={{ background: "rgba(220,38,38,0.1)" }}
        >
          <ShieldX size={28} style={{ color: "var(--color-danger)" }} />
        </div>

        <h1 className="text-[20px] font-bold mb-2" style={{ color: "var(--text-heading)" }}>
          Access Denied
        </h1>
        <p className="text-[13px] mb-6" style={{ color: "var(--text-muted)" }}>
          Your account is not authorized to access Form Portal. If you believe this is an error, please contact your administrator.
        </p>

        <Link
          href="/login"
          className="inline-flex items-center gap-2 text-[13px] font-medium no-underline px-4 py-2 rounded-xl"
          style={{ background: "var(--btn-primary-bg)", color: "var(--btn-primary-text)", border: "1px solid var(--btn-primary-border)" }}
        >
          <ArrowLeft size={14} />
          Back to Sign In
        </Link>
      </div>
    </div>
  );
}
