"use client";

import Link from "next/link";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { Button } from "@/components/ui";
import { Settings, Plus } from "lucide-react";
import { useAdminForms } from "@/features/forms/hooks/useForms";
import { FormAdminList } from "@/features/forms/components/FormAdminList";

export default function FormsAdminPage() {
  const { forms, isLoading } = useAdminForms();

  return (
    <PageContainer className="py-6 px-3 sm:px-0">
      <PageHeaderBar
        icon={Settings}
        title="Manage Forms"
        backHref="/forms"
        right={
          <Link href="/forms/admin/new">
            <Button variant="primary" size="sm" icon={<Plus size={14} />}>
              New Form
            </Button>
          </Link>
        }
      />
      {isLoading ? (
        <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>Loading...</p>
      ) : (
        <FormAdminList forms={forms} />
      )}
    </PageContainer>
  );
}
