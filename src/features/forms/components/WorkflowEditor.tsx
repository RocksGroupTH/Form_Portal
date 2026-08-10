"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui";
import { SidePanel } from "@/components/ui/SidePanel";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { Plus, GripVertical, Users, User, UserCheck, Workflow } from "lucide-react";
import { WorkflowStepEditor } from "./WorkflowStepEditor";
import { toast } from "sonner";

interface WorkflowStep {
  id?: number;
  name: string;
  stepOrder: number;
  parallelGroup: string;
  assigneeType: string;
  assigneeValue: string;
  autoApproveCondition: string;
}

interface WorkflowEditorProps {
  formId: number;
  formName: string;
  initialSteps: WorkflowStep[];
  slaDays: number;
  onSave: (steps: WorkflowStep[], slaDays: number) => Promise<void>;
}

const ASSIGNEE_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  user: User,
  role: Users,
  submitter_manager: UserCheck,
};

export function WorkflowEditor({ formId, formName, initialSteps, slaDays: initialSLA, onSave }: WorkflowEditorProps) {
  const [steps, setSteps] = useState<WorkflowStep[]>(initialSteps);
  const [slaDays, setSlaDays] = useState(initialSLA);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const selected = selectedIdx !== null ? steps[selectedIdx] : null;

  const addStep = useCallback(() => {
    const maxOrder = steps.length > 0 ? Math.max(...steps.map((s) => s.stepOrder)) : 0;
    setSteps((prev) => [...prev, {
      name: "New Step",
      stepOrder: maxOrder + 1,
      parallelGroup: "",
      assigneeType: "user",
      assigneeValue: "",
      autoApproveCondition: "",
    }]);
    setSelectedIdx(steps.length);
  }, [steps]);

  const updateStep = useCallback((idx: number, updates: Partial<WorkflowStep>) => {
    setSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, ...updates } : s)));
  }, []);

  const removeStep = useCallback((idx: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== idx));
    setSelectedIdx(null);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(steps, slaDays);
      toast.success("Workflow saved!");
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeaderBar
        icon={Workflow}
        title={formName}
        subtitle="Approval Workflow"
        backHref="/forms/admin"
        right={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <label className="text-[12px]" style={{ color: "var(--text-muted)" }}>SLA (days):</label>
              <input
                type="number"
                className="w-16 rounded-lg px-2 py-1 text-[12px] outline-none"
                style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-input)" }}
                value={slaDays}
                onChange={(e) => setSlaDays(Number(e.target.value))}
                min={1}
              />
            </div>
            <Button variant="primary" size="sm" onClick={handleSave} loading={saving}>
              Save Workflow
            </Button>
          </div>
        }
      />

      {/* Steps list */}
      <div className="flex flex-col gap-2 mb-3">
        {steps.length === 0 && (
          <div
            className="rounded-xl p-6 text-center"
            style={{ background: "var(--bg-card)", border: "2px dashed var(--border-card)" }}
          >
            <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
              No approval steps. Add steps to enable approval workflow.
            </p>
          </div>
        )}

        {steps.map((step, idx) => {
          const AssigneeIcon = ASSIGNEE_ICONS[step.assigneeType] ?? User;
          const isSelected = selectedIdx === idx;

          return (
            <div
              key={idx}
              onClick={() => setSelectedIdx(idx)}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors"
              style={{
                background: isSelected ? "var(--bg-selected)" : "var(--bg-card)",
                border: isSelected ? "1px solid var(--nav-active-text)" : "1px solid var(--border-card)",
              }}
            >
              <GripVertical size={14} style={{ color: "var(--text-faint)" }} className="shrink-0" />
              <div
                className="w-6 h-6 rounded flex items-center justify-center text-[11px] font-bold shrink-0"
                style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
              >
                {step.stepOrder}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium truncate" style={{ color: "var(--text-primary)" }}>
                  {step.name}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span style={{ color: "var(--text-muted)" }}><AssigneeIcon size={11} /></span>
                  <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                    {step.assigneeType === "submitter_manager" ? "Submitter's Manager" : step.assigneeType + (step.assigneeValue ? `: ${step.assigneeValue}` : "")}
                  </span>
                  {step.parallelGroup && (
                    <span className="text-[10px] px-1 rounded" style={{ background: "var(--bg-badge)", color: "var(--text-faint)" }}>
                      parallel: {step.parallelGroup}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={addStep}>
        Add Step
      </Button>

      {/* Step editor panel */}
      <SidePanel open={!!selected} onClose={() => setSelectedIdx(null)} width="360px">
        {selected && selectedIdx !== null && (
          <WorkflowStepEditor
            step={selected}
            onChange={(updates) => updateStep(selectedIdx, updates)}
            onRemove={() => removeStep(selectedIdx)}
          />
        )}
      </SidePanel>
    </div>
  );
}
