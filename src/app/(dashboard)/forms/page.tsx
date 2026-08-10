"use client";

import { useState } from "react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { Button } from "@/components/ui";
import { FileText, Settings, ClipboardList } from "lucide-react";
import { useForms } from "@/features/forms/hooks/useForms";
import { useMySubmissions } from "@/features/forms/hooks/useSubmissions";
import { FormCard } from "@/features/forms/components/FormCard";
import { SubmissionList } from "@/features/forms/components/SubmissionList";
import { useRole } from "@/lib/hooks/useRole";
import Link from "next/link";

type Tab = "catalog" | "submissions";

export default function FormsHubPage() {
  const [tab, setTab] = useState<Tab>("catalog");
  const { forms, isLoading: formsLoading } = useForms();
  const { submissions, isLoading: subsLoading } = useMySubmissions();
  const { canAdmin } = useRole();

  return (
    <PageContainer className="py-6 px-3 sm:px-0">
      {/* Header */}
      <PageHeaderBar
        icon={FileText}
        title="Office Forms"
        subtitle="Submit and manage office forms"
        right={
          canAdmin ? (
            <Link href="/forms/admin">
              <Button variant="secondary" size="sm" icon={<Settings size={14} />}>Manage</Button>
            </Link>
          ) : undefined
        }
      />

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-4">
        {([
          { id: "catalog" as Tab, label: "Forms", icon: <FileText size={14} />, count: forms.length },
          { id: "submissions" as Tab, label: "My Submissions", icon: <ClipboardList size={14} />, count: submissions.length },
        ]).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium cursor-pointer border-none transition-colors"
            style={{
              background: tab === t.id ? "var(--nav-active-bg)" : "transparent",
              color: tab === t.id ? "var(--nav-active-text)" : "var(--text-muted)",
            }}
          >
            {t.icon}
            {t.label}
            <span className="text-[10px] opacity-70">({t.count})</span>
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === "catalog" && (
        formsLoading ? (
          <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>Loading...</p>
        ) : forms.length === 0 ? (
          <div className="rounded-xl p-8 text-center" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
            <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>No forms available yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {forms.map((form) => <FormCard key={form.id} form={form} />)}
          </div>
        )
      )}

      {tab === "submissions" && (
        subsLoading ? (
          <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>Loading...</p>
        ) : (
          <SubmissionList submissions={submissions} />
        )
      )}
    </PageContainer>
  );
}
