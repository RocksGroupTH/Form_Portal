"use client";

import React, { useState, useCallback } from "react";
import { Button } from "@/components/ui";
import { FieldRenderer } from "./FieldRenderer";
import { FileUploadField } from "./FileUploadField";
import { RoutePicker, type RouteData } from "./RoutePicker";
import type { FormFieldDef, OfficeFormFile } from "../types";
import { toast } from "sonner";
import { Send, Save } from "lucide-react";

interface FormFillerProps {
  formId: number;
  formName: string;
  fields: FormFieldDef[];
  submissionId: number | null;
  initialData?: Record<string, unknown>;
  initialFiles?: OfficeFormFile[];
  onSubmissionCreated?: (id: number) => void;
  onSubmitted?: () => void;
}

export function FormFiller({
  formId, formName, fields, submissionId: initialSubId,
  initialData = {}, initialFiles = [],
  onSubmissionCreated, onSubmitted,
}: FormFillerProps) {
  const [data, setData] = useState<Record<string, unknown>>(initialData);
  const [files, setFiles] = useState<Record<string, OfficeFormFile[]>>(() => {
    const map: Record<string, OfficeFormFile[]> = {};
    initialFiles.forEach((f) => {
      if (!map[f.fieldKey]) map[f.fieldKey] = [];
      map[f.fieldKey].push(f);
    });
    return map;
  });
  const [subId, setSubId] = useState(initialSubId);
  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleChange = useCallback((key: string, value: unknown) => {
    setData((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => { const n = { ...prev }; delete n[key]; return n; });
  }, []);

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    for (const field of fields) {
      if (field.type === "section" || field.type === "info") continue;
      if (field.required) {
        const val = data[field.key];
        if (val === undefined || val === null || val === "" || (Array.isArray(val) && val.length === 0)) {
          errs[field.key] = "This field is required";
        }
      }
      if (field.type === "file" && field.required) {
        const fieldFiles = files[field.key] ?? [];
        if (fieldFiles.length === 0) {
          errs[field.key] = "Please upload at least one file";
        }
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const ensureSubmission = async (isDraft: boolean): Promise<number | null> => {
    if (subId) return subId;
    const res = await fetch("/api/forms/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ formId, data, isDraft }),
    });
    if (!res.ok) { toast.error("Failed to create submission"); return null; }
    const json = await res.json();
    const newId = json.data.id;
    setSubId(newId);
    onSubmissionCreated?.(newId);
    return newId;
  };

  const handleSaveDraft = async () => {
    setSaving(true);
    try {
      const id = await ensureSubmission(true);
      if (!id) return;
      await fetch(`/api/forms/submissions/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data }),
      });
      toast.success("Draft saved");
    } catch { toast.error("Failed to save draft"); }
    finally { setSaving(false); }
  };

  const handleSubmit = async () => {
    if (!validate()) { toast.error("Please fix the errors before submitting"); return; }
    setSubmitting(true);
    try {
      const id = await ensureSubmission(false);
      if (!id) return;
      await fetch(`/api/forms/submissions/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data }),
      });
      const res = await fetch(`/api/forms/submissions/${id}/submit`, { method: "POST" });
      if (!res.ok) { toast.error("Failed to submit"); return; }
      toast.success("Submitted successfully!");
      onSubmitted?.();
    } catch { toast.error("Failed to submit"); }
    finally { setSubmitting(false); }
  };

  // Check conditional visibility
  const isVisible = (field: FormFieldDef): boolean => {
    if (!field.conditionalOn) return true;
    const { fieldId, operator, value } = field.conditionalOn;
    const refField = fields.find((f) => f.id === fieldId);
    if (!refField) return true;
    const refVal = data[refField.key];
    if (operator === "eq") return refVal === value;
    if (operator === "neq") return refVal !== value;
    if (operator === "in" && Array.isArray(value)) return value.includes(String(refVal ?? ""));
    return true;
  };

  return (
    <div className="max-w-[700px] mx-auto">
      <div className="flex flex-wrap gap-3">
        {fields.filter(isVisible).map((field) => (
          <React.Fragment key={field.id}>
            {field.type === "file" ? (
              <div className={field.width === "half" ? "w-full md:w-[calc(50%-8px)]" : "w-full"}>
                <label className="block text-[12px] font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
                  {field.label}
                  {field.required && <span style={{ color: "var(--color-danger)" }}> *</span>}
                </label>
                {field.helpText && (
                  <p className="text-[11px] mb-1" style={{ color: "var(--text-muted)" }}>{field.helpText}</p>
                )}
                <FileUploadField
                  fieldKey={field.key}
                  submissionId={subId}
                  files={files[field.key] ?? []}
                  maxFiles={field.validation?.maxFiles}
                  acceptedTypes={field.validation?.acceptedTypes}
                  onUploaded={(newFiles) => setFiles((prev) => ({ ...prev, [field.key]: newFiles }))}
                />
                {errors[field.key] && (
                  <p className="text-[11px] mt-0.5" style={{ color: "var(--color-danger)" }}>{errors[field.key]}</p>
                )}
              </div>
            ) : field.type === "route" ? (
              <div className={field.width === "half" ? "w-full md:w-[calc(50%-8px)]" : "w-full"}>
                <label className="block text-[12px] font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
                  {field.label}
                  {field.required && <span style={{ color: "var(--color-danger)" }}> *</span>}
                </label>
                {field.helpText && (
                  <p className="text-[11px] mb-1" style={{ color: "var(--text-muted)" }}>{field.helpText}</p>
                )}
                <RoutePicker
                  value={data[field.key] as RouteData | null}
                  onChange={(routeData) => {
                    handleChange(field.key, routeData);
                    // Auto-fill distance field if it exists
                    if (routeData) {
                      const distField = fields.find((f) => f.key === "total_distance_km" || f.key.includes("distance"));
                      if (distField) handleChange(distField.key, routeData.distanceKm);
                    }
                  }}
                />
                {errors[field.key] && (
                  <p className="text-[11px] mt-0.5" style={{ color: "var(--color-danger)" }}>{errors[field.key]}</p>
                )}
              </div>
            ) : (
              <FieldRenderer
                field={field}
                value={data[field.key]}
                onChange={(v) => handleChange(field.key, v)}
                error={errors[field.key]}
              />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 mt-6 pt-4" style={{ borderTop: "1px solid var(--border-main)" }}>
        <Button variant="secondary" size="md" icon={<Save size={14} />} onClick={handleSaveDraft} loading={saving}>
          Save Draft
        </Button>
        <Button variant="primary" size="md" icon={<Send size={14} />} onClick={handleSubmit} loading={submitting}>
          Submit
        </Button>
      </div>
    </div>
  );
}
