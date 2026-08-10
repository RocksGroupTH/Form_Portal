"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { useFormBySlug } from "@/features/forms/hooks/useFormDetail";
import { FormFiller } from "@/features/forms/components/FormFiller";
import { FileText } from "lucide-react";

export default function FillFormPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const router = useRouter();
  const { form, fields, isLoading } = useFormBySlug(slug);

  if (isLoading) {
    return (
      <PageContainer className="py-6 px-3 sm:px-0">
        <PageHeaderBar icon={FileText} title="Form" backHref="/forms" />
        <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>Loading form...</p>
      </PageContainer>
    );
  }

  if (!form) {
    return (
      <PageContainer className="py-6 px-3 sm:px-0">
        <PageHeaderBar icon={FileText} title="Form not found" backHref="/forms" />
        <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>Form not found.</p>
      </PageContainer>
    );
  }

  return (
    <PageContainer className="py-6 px-3 sm:px-0">
      <PageHeaderBar icon={FileText} title={form.name} backHref="/forms" />
      <FormFiller
        formId={form.id}
        formName={form.name}
        fields={fields}
        submissionId={null}
        onSubmitted={() => router.push("/forms")}
      />
    </PageContainer>
  );
}
