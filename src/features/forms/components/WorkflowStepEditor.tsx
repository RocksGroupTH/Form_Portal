"use client";

import React from "react";
import { Button } from "@/components/ui";
import { Trash2 } from "lucide-react";

interface StepData {
  id?: number;
  name: string;
  stepOrder: number;
  parallelGroup: string;
  assigneeType: string;
  assigneeValue: string;
  autoApproveCondition: string;
}

interface WorkflowStepEditorProps {
  step: StepData;
  onChange: (updates: Partial<StepData>) => void;
  onRemove: () => void;
}

const inputClass = "w-full rounded-lg px-3 py-1.5 text-[12px] outline-none";
const inputStyle: React.CSSProperties = {
  background: "var(--bg-input)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-input)",
};

export function WorkflowStepEditor({ step, onChange, onRemove }: WorkflowStepEditorProps) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-bold" style={{ color: "var(--text-heading)" }}>
          Edit Step
        </p>
        <Button variant="danger" size="sm" icon={<Trash2 size={12} />} onClick={onRemove}>
          Remove
        </Button>
      </div>

      <div>
        <label className="block text-[11px] font-medium mb-0.5" style={{ color: "var(--text-muted)" }}>Step Name</label>
        <input className={inputClass} style={inputStyle} value={step.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="e.g. Manager Approval" />
      </div>

      <div className="flex gap-2">
        <div className="flex-1">
          <label className="block text-[11px] font-medium mb-0.5" style={{ color: "var(--text-muted)" }}>Step Order</label>
          <input type="number" className={inputClass} style={inputStyle} value={step.stepOrder} onChange={(e) => onChange({ stepOrder: Number(e.target.value) })} min={1} />
        </div>
        <div className="flex-1">
          <label className="block text-[11px] font-medium mb-0.5" style={{ color: "var(--text-muted)" }}>Parallel Group</label>
          <input className={inputClass} style={inputStyle} value={step.parallelGroup} onChange={(e) => onChange({ parallelGroup: e.target.value })} placeholder="e.g. 2a (optional)" />
        </div>
      </div>

      <div>
        <label className="block text-[11px] font-medium mb-0.5" style={{ color: "var(--text-muted)" }}>Assignee Type</label>
        <select className={inputClass} style={inputStyle} value={step.assigneeType} onChange={(e) => onChange({ assigneeType: e.target.value })}>
          <option value="user">Specific User</option>
          <option value="role">Role</option>
          <option value="submitter_manager">Submitter&apos;s Manager</option>
        </select>
      </div>

      {step.assigneeType === "user" && (
        <div>
          <label className="block text-[11px] font-medium mb-0.5" style={{ color: "var(--text-muted)" }}>User ID</label>
          <input className={inputClass} style={inputStyle} value={step.assigneeValue} onChange={(e) => onChange({ assigneeValue: e.target.value })} placeholder="TeamMember ID" />
        </div>
      )}

      {step.assigneeType === "role" && (
        <div>
          <label className="block text-[11px] font-medium mb-0.5" style={{ color: "var(--text-muted)" }}>Role</label>
          <select className={inputClass} style={inputStyle} value={step.assigneeValue} onChange={(e) => onChange({ assigneeValue: e.target.value })}>
            <option value="">Select role...</option>
            <option value="IT Admin">IT Admin</option>
            <option value="System Admin">System Admin</option>
            <option value="Staff">Staff</option>
          </select>
        </div>
      )}

      <div>
        <label className="block text-[11px] font-medium mb-0.5" style={{ color: "var(--text-muted)" }}>Auto-Approve Condition (JSON, optional)</label>
        <textarea
          className={`${inputClass} min-h-[60px] resize-y font-mono`}
          style={inputStyle}
          value={step.autoApproveCondition}
          onChange={(e) => onChange({ autoApproveCondition: e.target.value })}
          placeholder='{"field":"toll_cost","operator":"lt","value":500}'
        />
      </div>
    </div>
  );
}
