"use client";

import { useState, useCallback } from "react";
import type { FormFieldDef, FieldType } from "../types";

let fieldCounter = 0;
function genId() {
  return `field_${Date.now()}_${++fieldCounter}`;
}

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 80) || "field";
}

export function useFormBuilder(initialFields: FormFieldDef[] = []) {
  const [fields, setFields] = useState<FormFieldDef[]>(initialFields);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  const selected = fields.find((f) => f.id === selectedId) ?? null;

  const addField = useCallback((type: FieldType, atIndex?: number) => {
    const id = genId();
    const newField: FormFieldDef = {
      id,
      key: `${type}_${id.slice(-6)}`,
      type,
      label: type === "section" ? "Section" : type === "info" ? "Info" : `New ${type} field`,
      required: false,
      order: 0,
      width: "full",
    };
    setFields((prev) => {
      const next = [...prev];
      const idx = atIndex ?? next.length;
      next.splice(idx, 0, newField);
      return next.map((f, i) => ({ ...f, order: i }));
    });
    setSelectedId(id);
    setIsDirty(true);
  }, []);

  const removeField = useCallback((id: string) => {
    setFields((prev) => prev.filter((f) => f.id !== id).map((f, i) => ({ ...f, order: i })));
    setSelectedId((prev) => (prev === id ? null : prev));
    setIsDirty(true);
  }, []);

  const updateField = useCallback((id: string, updates: Partial<FormFieldDef>) => {
    setFields((prev) =>
      prev.map((f) => {
        if (f.id !== id) return f;
        const updated = { ...f, ...updates };
        if (updates.label && !updates.key) {
          updated.key = slugify(updates.label);
        }
        return updated;
      }),
    );
    setIsDirty(true);
  }, []);

  const moveField = useCallback((fromIndex: number, toIndex: number) => {
    setFields((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next.map((f, i) => ({ ...f, order: i }));
    });
    setIsDirty(true);
  }, []);

  const resetFields = useCallback((newFields: FormFieldDef[]) => {
    setFields(newFields);
    setSelectedId(null);
    setIsDirty(false);
  }, []);

  return {
    fields,
    selected,
    selectedId,
    isDirty,
    addField,
    removeField,
    updateField,
    moveField,
    setSelectedId,
    resetFields,
  };
}
