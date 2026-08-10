"use client";

import { use, useState, useCallback } from "react";
import { PageContainer } from "@/components/layout/PageContainer";
import { useFormDetail } from "@/features/forms/hooks/useFormDetail";
import { FormBuilder } from "@/features/forms/components/FormBuilder";
import { FormPreview } from "@/features/forms/components/FormPreview";
import type { FormFieldDef } from "@/features/forms/types";
import { toast } from "sonner";

export default function FormBuilderPage({ params }: { params: Promise<{ formId: string }> }) {
  const { formId: formIdStr } = use(params);
  const formId = Number(formIdStr);
  const { form, fields, isLoading, mutate } = useFormDetail(isNaN(formId) ? null : formId);
  const [preview, setPreview] = useState(false);
  const [previewFields, setPreviewFields] = useState<FormFieldDef[]>([]);

  const handleSave = useCallback(async (updatedFields: FormFieldDef[]) => {
    const res = await fetch(`/api/forms/${formId}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields: updatedFields }),
    });
    if (!res.ok) throw new Error("Save failed");
    mutate();
  }, [formId, mutate]);

  const handlePublish = useCallback(async () => {
    const res = await fetch(`/api/forms/${formId}/publish`, { method: "POST" });
    if (!res.ok) {
      const json = await res.json();
      toast.error(json.error ?? "Publish failed");
      return;
    }
    toast.success("Form published!");
    mutate();
  }, [formId, mutate]);

  const handlePreview = useCallback(() => {
    setPreviewFields(fields);
    setPreview(true);
  }, [fields]);

  if (isLoading) {
    return (
      <PageContainer className="py-6 px-3 sm:px-0">
        <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>Loading...</p>
      </PageContainer>
    );
  }

  if (!form) {
    return (
      <PageContainer className="py-6 px-3 sm:px-0">
        <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>Form not found.</p>
      </PageContainer>
    );
  }

  return (
    <PageContainer className="py-6 px-3 sm:px-0" maxWidth="2k">
      <FormBuilder
        formId={formId}
        initialFields={fields}
        formName={form.name}
        onSave={handleSave}
        onPublish={handlePublish}
        onPreview={handlePreview}
      />
      <FormPreview
        open={preview}
        onClose={() => setPreview(false)}
        formName={form.name}
        fields={previewFields}
      />
    </PageContainer>
  );
}
