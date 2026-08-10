"use client";

import Link from "next/link";
import { Button, Badge } from "@/components/ui";
import { Settings, FileText, Eye, GitBranch } from "lucide-react";
import type { OfficeForm, FormStatus } from "../types";

const STATUS_COLORS: Record<FormStatus, { color: string; bg: string }> = {
  Draft:     { color: "var(--text-muted)",    bg: "var(--bg-badge)" },
  Published: { color: "var(--color-success)",  bg: "rgba(22,163,74,0.1)" },
  Archived:  { color: "var(--text-faint)",     bg: "var(--bg-badge)" },
};

interface FormAdminListProps {
  forms: (OfficeForm & { submissionCount?: number })[];
}

export function FormAdminList({ forms }: FormAdminListProps) {
  return (
    <div>
      <div className="rounded-xl overflow-hidden" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
        {forms.length === 0 && (
          <div className="p-8 text-center">
            <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>No forms yet.</p>
          </div>
        )}

        {forms.map((form, i) => {
          const sc = STATUS_COLORS[form.status];
          return (
            <div
              key={form.id}
              className="flex items-center gap-3 px-4 py-3 transition-colors"
              style={{
                borderBottom: i < forms.length - 1 ? "1px solid var(--border-light)" : undefined,
                background: i % 2 === 1 ? "var(--bg-row-stripe)" : undefined,
              }}
            >
              <FileText size={16} style={{ color: "var(--text-muted)" }} className="shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium truncate" style={{ color: "var(--text-primary)" }}>
                  {form.name}
                </p>
                <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                  v{form.currentVersion} · {form.submissionCount ?? 0} submissions
                </p>
              </div>
              <Badge label={form.status} color={sc.color} bg={sc.bg} small />
              <div className="flex items-center gap-1">
                <Link href={`/forms/admin/${form.id}`}>
                  <Button variant="icon"><Settings size={15} /></Button>
                </Link>
                <Link href={`/forms/admin/${form.id}/workflow`}>
                  <Button variant="icon"><GitBranch size={15} /></Button>
                </Link>
                {form.status === "Published" && (
                  <Link href={`/forms/${form.slug}`}>
                    <Button variant="icon"><Eye size={15} /></Button>
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
