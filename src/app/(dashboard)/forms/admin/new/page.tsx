"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { FilePlus } from "lucide-react";
import { Button } from "@/components/ui";
import { FORM_CATEGORIES } from "@/features/forms/constants";
import { toast } from "sonner";

const inputClass = "w-full rounded-lg px-3 py-2 text-[13px] outline-none";
const inputStyle: React.CSSProperties = {
  background: "var(--bg-input)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-input)",
};

export default function NewFormPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [saving, setSaving] = useState(false);

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const handleCreate = async () => {
    if (!name.trim()) { toast.error("Name is required"); return; }
    if (!slug) { toast.error("Invalid name for URL slug"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/forms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, slug, description: description || null, category: category || null }),
      });
      if (!res.ok) {
        const json = await res.json();
        toast.error(json.error ?? "Failed to create form");
        return;
      }
      const json = await res.json();
      toast.success("Form created!");
      router.push(`/forms/admin/${json.data.id}`);
    } catch { toast.error("Failed to create form"); }
    finally { setSaving(false); }
  };

  return (
    <PageContainer className="py-6 px-3 sm:px-0 max-w-[600px]">
      <PageHeaderBar icon={FilePlus} title="Create New Form" backHref="/forms/admin" />

      <div className="flex flex-col gap-4 rounded-xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
        <div>
          <label className="block text-[12px] font-medium mb-1" style={{ color: "var(--text-secondary)" }}>Form Name *</label>
          <input className={inputClass} style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Travel Expense Claim" />
          {slug && <p className="text-[11px] mt-0.5" style={{ color: "var(--text-faint)" }}>URL: /forms/{slug}</p>}
        </div>

        <div>
          <label className="block text-[12px] font-medium mb-1" style={{ color: "var(--text-secondary)" }}>Description</label>
          <textarea className={`${inputClass} min-h-[60px]`} style={inputStyle} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this form for?" />
        </div>

        <div>
          <label className="block text-[12px] font-medium mb-1" style={{ color: "var(--text-secondary)" }}>Category</label>
          <select className={inputClass} style={inputStyle} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Select category...</option>
            {FORM_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div className="flex justify-end pt-2">
          <Button variant="primary" onClick={handleCreate} loading={saving}>
            Create Form
          </Button>
        </div>
      </div>
    </PageContainer>
  );
}
