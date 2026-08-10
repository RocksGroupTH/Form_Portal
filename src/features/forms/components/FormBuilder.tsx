"use client";

import React, { useCallback } from "react";
import { Button } from "@/components/ui";
import { SidePanel } from "@/components/ui/SidePanel";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { GripVertical, Trash2, Eye, Save, Settings } from "lucide-react";
import { FieldPalette } from "./FieldPalette";
import { FieldEditor } from "./FieldEditor";
import { useFormBuilder } from "../hooks/useFormBuilder";
import type { FormFieldDef } from "../types";
import { FIELD_TYPES } from "../constants";
import { toast } from "sonner";

interface FormBuilderProps {
  formId: number;
  initialFields: FormFieldDef[];
  formName: string;
  onSave: (fields: FormFieldDef[]) => Promise<void>;
  onPublish: () => Promise<void>;
  onPreview: () => void;
}

export function FormBuilder({ formId, initialFields, formName, onSave, onPublish, onPreview }: FormBuilderProps) {
  const {
    fields, selected, selectedId, isDirty,
    addField, removeField, updateField, moveField, setSelectedId, resetFields,
  } = useFormBuilder(initialFields);

  const handleSave = useCallback(async () => {
    try {
      await onSave(fields);
      resetFields(fields);
      toast.success("Saved!");
    } catch {
      toast.error("Failed to save");
    }
  }, [fields, onSave, resetFields]);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.setData("text/plain", String(index));
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDrop = (e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    const fromIndex = Number(e.dataTransfer.getData("text/plain"));
    if (!isNaN(fromIndex) && fromIndex !== toIndex) {
      moveField(fromIndex, toIndex);
    }
  };

  return (
    <div>
      <PageHeaderBar
        icon={Settings}
        title={formName}
        backHref="/forms/admin"
        right={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" icon={<Eye size={14} />} onClick={onPreview}>
              Preview
            </Button>
            <Button variant="secondary" size="sm" icon={<Save size={14} />} onClick={handleSave} disabled={!isDirty}>
              Save
            </Button>
            <Button variant="primary" size="sm" onClick={onPublish}>
              Publish
            </Button>
          </div>
        }
      />

      <div className="flex gap-4 min-h-[calc(100vh-120px)]">
        {/* Left: Palette */}
        <div
          className="w-48 shrink-0 rounded-xl p-3 hidden md:block"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
        >
          <FieldPalette onAdd={addField} />
        </div>

        {/* Center: Field list */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-col gap-2">
            {fields.length === 0 && (
              <div
                className="rounded-xl p-8 text-center"
                style={{ background: "var(--bg-card)", border: "2px dashed var(--border-card)" }}
              >
                <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
                  Add fields from the palette on the left
                </p>
              </div>
            )}

            {fields.map((field, index) => {
            const typeDef = FIELD_TYPES.find((ft) => ft.type === field.type);
            const isSelected = selectedId === field.id;

            return (
              <div
                key={field.id}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => handleDrop(e, index)}
                onClick={() => setSelectedId(field.id)}
                className="flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-colors"
                style={{
                  background: isSelected ? "var(--bg-selected)" : "var(--bg-card)",
                  border: isSelected ? "1px solid var(--nav-active-text)" : "1px solid var(--border-card)",
                }}
              >
                <GripVertical size={14} className="cursor-grab shrink-0" style={{ color: "var(--text-faint)" }} />
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium truncate" style={{ color: "var(--text-primary)" }}>
                    {field.label}
                  </p>
                  <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                    {typeDef?.label ?? field.type} · {field.key}
                    {field.required && " · Required"}
                  </p>
                </div>
                <button
                  className="cursor-pointer border-none bg-transparent p-1 shrink-0 opacity-50 hover:opacity-100"
                  style={{ color: "var(--color-danger)" }}
                  onClick={(e) => { e.stopPropagation(); removeField(field.id); }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

        {/* Right: Field editor panel */}
        <SidePanel open={!!selected} onClose={() => setSelectedId(null)} width="360px">
          {selected && (
            <FieldEditor
              field={selected}
              onUpdate={(updates) => updateField(selected.id, updates)}
              onRemove={() => removeField(selected.id)}
            />
          )}
        </SidePanel>
      </div>
    </div>
  );
}
