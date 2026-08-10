"use client";

import Link from "next/link";
import { FileText } from "lucide-react";
import type { OfficeForm } from "../types";

export function FormCard({ form }: { form: OfficeForm }) {
  return (
    <Link
      href={`/forms/${form.slug}`}
      className="group rounded-xl p-4 no-underline transition-all"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-card)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: "var(--nav-active-bg)" }}
        >
          <FileText size={18} style={{ color: "var(--nav-active-text)" }} />
        </div>
        <div className="min-w-0">
          <h3 className="text-[13px] font-bold truncate" style={{ color: "var(--text-heading)" }}>
            {form.name}
          </h3>
          {form.description && (
            <p className="text-[11px] mt-0.5 line-clamp-2" style={{ color: "var(--text-muted)" }}>
              {form.description}
            </p>
          )}
          {form.category && (
            <span
              className="inline-block text-[10px] px-1.5 py-0.5 rounded mt-1.5 font-medium"
              style={{ background: "var(--bg-badge)", color: "var(--text-muted)" }}
            >
              {form.category}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
