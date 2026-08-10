"use client";

import React from "react";
import { Button } from "@/components/ui";
import { Trash2, Plus, GripVertical } from "lucide-react";
import type { FormFieldDef } from "../types";
import { FIELD_TYPES } from "../constants";

interface FieldEditorProps {
  field: FormFieldDef;
  onUpdate: (updates: Partial<FormFieldDef>) => void;
  onRemove: () => void;
}

const inputClass = "w-full rounded-lg px-3 py-1.5 text-[12px] outline-none";
const inputStyle: React.CSSProperties = {
  background: "var(--bg-input)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-input)",
};

export function FieldEditor({ field, onUpdate, onRemove }: FieldEditorProps) {
  const typeDef = FIELD_TYPES.find((ft) => ft.type === field.type);
  const hasOptions = field.type === "select" || field.type === "radio" || field.type === "checkbox";

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-bold" style={{ color: "var(--text-heading)" }}>
          Edit: {typeDef?.label ?? field.type}
        </p>
        <Button variant="danger" size="sm" icon={<Trash2 size={12} />} onClick={onRemove}>
          Remove
        </Button>
      </div>

      {/* Label */}
      <div>
        <label className="block text-[11px] font-medium mb-0.5" style={{ color: "var(--text-muted)" }}>Label</label>
        <input className={inputClass} style={inputStyle} value={field.label} onChange={(e) => onUpdate({ label: e.target.value })} />
      </div>

      {/* Key */}
      <div>
        <label className="block text-[11px] font-medium mb-0.5" style={{ color: "var(--text-muted)" }}>Field Key</label>
        <input className={inputClass} style={inputStyle} value={field.key} onChange={(e) => onUpdate({ key: e.target.value })} />
      </div>

      {/* Placeholder */}
      {!typeDef?.isLayout && (
        <div>
          <label className="block text-[11px] font-medium mb-0.5" style={{ color: "var(--text-muted)" }}>Placeholder</label>
          <input className={inputClass} style={inputStyle} value={field.placeholder ?? ""} onChange={(e) => onUpdate({ placeholder: e.target.value || undefined })} />
        </div>
      )}

      {/* Help Text */}
      <div>
        <label className="block text-[11px] font-medium mb-0.5" style={{ color: "var(--text-muted)" }}>Help Text</label>
        <input className={inputClass} style={inputStyle} value={field.helpText ?? ""} onChange={(e) => onUpdate({ helpText: e.target.value || undefined })} />
      </div>

      {/* Required */}
      {!typeDef?.isLayout && (
        <label className="flex items-center gap-2 text-[12px] cursor-pointer" style={{ color: "var(--text-secondary)" }}>
          <input type="checkbox" checked={field.required} onChange={(e) => onUpdate({ required: e.target.checked })} />
          Required
        </label>
      )}

      {/* Width */}
      <div>
        <label className="block text-[11px] font-medium mb-0.5" style={{ color: "var(--text-muted)" }}>Width</label>
        <select className={inputClass} style={inputStyle} value={field.width ?? "full"} onChange={(e) => onUpdate({ width: e.target.value as "full" | "half" })}>
          <option value="full">Full width</option>
          <option value="half">Half width</option>
        </select>
      </div>

      {/* Options (for select/radio/checkbox) */}
      {hasOptions && (
        <div>
          <label className="block text-[11px] font-medium mb-1" style={{ color: "var(--text-muted)" }}>Options</label>
          {(field.options ?? []).map((opt, i) => (
            <div key={i} className="flex items-center gap-1 mb-1">
              <GripVertical size={12} style={{ color: "var(--text-faint)" }} />
              <input
                className={`${inputClass} flex-1`}
                style={inputStyle}
                value={opt.label}
                placeholder="Label"
                onChange={(e) => {
                  const newOpts = [...(field.options ?? [])];
                  newOpts[i] = { label: e.target.value, value: e.target.value.toLowerCase().replace(/\s+/g, "_") };
                  onUpdate({ options: newOpts });
                }}
              />
              <button
                className="cursor-pointer border-none bg-transparent p-0.5"
                style={{ color: "var(--text-muted)" }}
                onClick={() => {
                  const newOpts = (field.options ?? []).filter((_, idx) => idx !== i);
                  onUpdate({ options: newOpts });
                }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          <Button
            variant="ghost"
            size="sm"
            icon={<Plus size={12} />}
            onClick={() => onUpdate({ options: [...(field.options ?? []), { label: "", value: "" }] })}
          >
            Add option
          </Button>
        </div>
      )}

      {/* File validation */}
      {field.type === "file" && (
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="block text-[11px] font-medium mb-0.5" style={{ color: "var(--text-muted)" }}>Max files</label>
            <input
              type="number"
              className={inputClass}
              style={inputStyle}
              value={field.validation?.maxFiles ?? 10}
              onChange={(e) => onUpdate({ validation: { ...field.validation, maxFiles: Number(e.target.value) || 10 } })}
            />
          </div>
          <div className="flex-1">
            <label className="block text-[11px] font-medium mb-0.5" style={{ color: "var(--text-muted)" }}>Max size (MB)</label>
            <input
              type="number"
              className={inputClass}
              style={inputStyle}
              value={field.validation?.maxFileSizeMB ?? 10}
              onChange={(e) => onUpdate({ validation: { ...field.validation, maxFileSizeMB: Number(e.target.value) || 10 } })}
            />
          </div>
        </div>
      )}
    </div>
  );
}
