"use client";

import { use, useCallback } from "react";
import { PageContainer } from "@/components/layout/PageContainer";
import { WorkflowEditor } from "@/features/forms/components/WorkflowEditor";
import { useFormDetail } from "@/features/forms/hooks/useFormDetail";
import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface WorkflowStep {
  id?: number;
  name: string;
  stepOrder: number;
  parallelGroup: string;
  assigneeType: string;
  assigneeValue: string;
  autoApproveCondition: string;
}

export default function WorkflowConfigPage({ params }: { params: Promise<{ formId: string }> }) {
  const { formId: formIdStr } = use(params);
  const formId = Number(formIdStr);
  const { form, isLoading: formLoading } = useFormDetail(isNaN(formId) ? null : formId);

  const { data: wfData, isLoading: wfLoading, mutate } = useSWR(
    !isNaN(formId) ? `/api/forms/${formId}/workflow` : null,
    fetcher,
  );

  const workflow = wfData?.data?.workflow;
  const steps: WorkflowStep[] = (wfData?.data?.steps ?? []).map((s: Record<string, unknown>) => ({
    id: s.Id as number,
    name: (s.Name as string) ?? "",
    stepOrder: (s.StepOrder as number) ?? 1,
    parallelGroup: (s.ParallelGroup as string) ?? "",
    assigneeType: (s.AssigneeType as string) ?? "user",
    assigneeValue: (s.AssigneeValue as string) ?? "",
    autoApproveCondition: (s.AutoApproveCondition as string) ?? "",
  }));

  const handleSave = useCallback(async (updatedSteps: WorkflowStep[], slaDays: number) => {
    // Update or create workflow SLA
    await fetch(`/api/forms/${formId}/workflow`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slaDays }),
    });

    // Sync steps: delete removed, update existing, create new
    const existingIds = new Set(steps.filter((s) => s.id).map((s) => s.id));
    const updatedIds = new Set(updatedSteps.filter((s) => s.id).map((s) => s.id));

    // Delete removed steps
    for (const oldStep of steps) {
      if (oldStep.id && !updatedIds.has(oldStep.id)) {
        await fetch(`/api/forms/${formId}/workflow/steps`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: oldStep.id }),
        });
      }
    }

    // Create or update steps
    for (const step of updatedSteps) {
      if (step.id && existingIds.has(step.id)) {
        await fetch(`/api/forms/${formId}/workflow/steps`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: step.id, name: step.name, stepOrder: step.stepOrder,
            parallelGroup: step.parallelGroup || null,
            assigneeType: step.assigneeType,
            assigneeValue: step.assigneeValue || null,
            autoApproveCondition: step.autoApproveCondition || null,
          }),
        });
      } else {
        await fetch(`/api/forms/${formId}/workflow/steps`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: step.name, stepOrder: step.stepOrder,
            parallelGroup: step.parallelGroup || null,
            assigneeType: step.assigneeType,
            assigneeValue: step.assigneeValue || null,
            autoApproveCondition: step.autoApproveCondition || null,
          }),
        });
      }
    }

    mutate();
  }, [formId, steps, mutate]);

  if (formLoading || wfLoading) {
    return (
      <PageContainer className="py-6 px-3 sm:px-0">
        <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>Loading...</p>
      </PageContainer>
    );
  }

  return (
    <PageContainer className="py-6 px-3 sm:px-0">
      <WorkflowEditor
        formId={formId}
        formName={form?.name ?? "Form"}
        initialSteps={steps}
        slaDays={workflow?.SLADays ?? 30}
        onSave={handleSave}
      />
    </PageContainer>
  );
}
