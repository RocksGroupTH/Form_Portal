"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui";
import {
  DEFAULT_ERP_JOURNAL_DESC_TEMPLATE,
  ERP_JOURNAL_DESC_TOKENS,
  sampleErpJournalDescription,
} from "@/lib/acc/erp-journal-description";

export function ErpJournalTemplateSettings() {
  const [template, setTemplate] = useState(DEFAULT_ERP_JOURNAL_DESC_TEMPLATE);
  const [savedTemplate, setSavedTemplate] = useState(DEFAULT_ERP_JOURNAL_DESC_TEMPLATE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/request/accounting/settings/erp-journal-template")
      .then((r) => r.json())
      .then((json: { ok: boolean; data?: { template: string }; error?: string }) => {
        if (json.ok && json.data?.template) {
          setTemplate(json.data.template);
          setSavedTemplate(json.data.template);
        } else if (!json.ok) {
          toast.error(json.error ?? "โหลด template ไม่สำเร็จ");
        }
      })
      .catch(() => toast.error("โหลด template ไม่สำเร็จ"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const isDirty = template.trim() !== savedTemplate.trim();
  const preview = useMemo(() => sampleErpJournalDescription(template), [template]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/request/accounting/settings/erp-journal-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template }),
      });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json.error ?? "บันทึกไม่สำเร็จ");
        return;
      }
      const next = json.data?.template ?? template.trim();
      setTemplate(next);
      setSavedTemplate(next);
      toast.success("บันทึก Description Template แล้ว");
    } catch {
      toast.error("บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <p className="text-[12px] m-0 mb-4" style={{ color: "var(--text-muted)" }}>
        กำลังโหลด Description Template...
      </p>
    );
  }

  return (
    <div
      className="rounded-xl p-4 mb-4"
      style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide m-0" style={{ color: "var(--text-faint)" }}>
            Journal Description
          </p>
          <p className="text-[12px] m-0 mt-0.5" style={{ color: "var(--text-muted)" }}>
            รูปแบบ Description สำหรับ Interface ERP Preview (รวมยอดต่อคน + แผนก)
          </p>
        </div>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => void save()}
          loading={saving}
          disabled={!isDirty}
        >
          บันทึก Template
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="min-w-0">
          <label
            htmlFor="erp-journal-desc-template"
            className="text-[10px] font-bold uppercase tracking-wide block mb-1"
            style={{ color: "var(--text-faint)" }}
          >
            Template
          </label>
          <textarea
            id="erp-journal-desc-template"
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            rows={3}
            className="w-full text-[12px] rounded-xl px-3 py-2.5 outline-none resize-y min-h-[72px]"
            style={{
              background: "var(--bg-card)",
              border: `1px solid ${isDirty ? "var(--border-info-yellow)" : "var(--border-input)"}`,
              color: "var(--text-primary)",
            }}
          />
          <div className="flex flex-wrap gap-1.5 mt-2">
            {ERP_JOURNAL_DESC_TOKENS.map(({ token, label }) => (
              <button
                key={token}
                type="button"
                onClick={() => setTemplate((prev) => `${prev}${prev.endsWith(" ") || !prev ? "" : " "}${token}`)}
                className="text-[10px] font-mono px-1.5 py-0.5 rounded cursor-pointer"
                style={{
                  background: "var(--bg-card)",
                  border: "1px solid var(--border-light)",
                  color: "var(--text-secondary)",
                }}
                title={label}
              >
                {token}
              </button>
            ))}
          </div>
        </div>

        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wide m-0 mb-1" style={{ color: "var(--text-faint)" }}>
            ตัวอย่าง
          </p>
          <p
            className="text-[12px] m-0 px-3 py-2.5 rounded-xl leading-relaxed"
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border-light)",
              color: "var(--text-primary)",
            }}
          >
            {preview}
          </p>
          <p className="text-[10px] m-0 mt-1.5" style={{ color: "var(--text-faint)" }}>
            ค่าเริ่มต้น: <span className="font-mono">{DEFAULT_ERP_JOURNAL_DESC_TEMPLATE}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
