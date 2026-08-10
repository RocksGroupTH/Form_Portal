"use client";

import React from "react";
import type { FormFieldDef } from "../types";

interface FieldRendererProps {
  field: FormFieldDef;
  value: unknown;
  onChange?: (value: unknown) => void;
  readOnly?: boolean;
  error?: string;
}

const inputClass = "w-full rounded-lg px-3 py-2 text-[13px] outline-none transition-colors";
const inputStyle: React.CSSProperties = {
  background: "var(--bg-input)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-input)",
};

export function FieldRenderer({ field, value, onChange, readOnly, error }: FieldRendererProps) {
  const handleChange = (v: unknown) => onChange?.(v);

  /* ── Layout fields ── */
  if (field.type === "section") {
    return (
      <div className="pt-4 pb-1">
        <h3 className="text-[14px] font-bold" style={{ color: "var(--text-heading)" }}>
          {field.label}
        </h3>
        {field.helpText && (
          <p className="text-[12px] mt-0.5" style={{ color: "var(--text-muted)" }}>{field.helpText}</p>
        )}
      </div>
    );
  }

  if (field.type === "info") {
    return (
      <div className="rounded-lg px-3 py-2" style={{ background: "var(--bg-info-yellow)", border: "1px solid var(--border-info-yellow)" }}>
        <p className="text-[12px]" style={{ color: "var(--text-info-yellow)" }}>{field.label}</p>
        {field.helpText && (
          <p className="text-[11px] mt-1" style={{ color: "var(--text-info-yellow)", opacity: 0.8 }}>{field.helpText}</p>
        )}
      </div>
    );
  }

  /* ── Data fields ── */
  const strVal = (value ?? "") as string;
  const numVal = value as number | undefined;
  const arrVal = (Array.isArray(value) ? value : []) as string[];

  return (
    <div className={field.width === "half" ? "w-full md:w-[calc(50%-8px)]" : "w-full"}>
      <label className="block text-[12px] font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
        {field.label}
        {field.required && <span style={{ color: "var(--color-danger)" }}> *</span>}
      </label>

      {field.helpText && !readOnly && (
        <p className="text-[11px] mb-1" style={{ color: "var(--text-muted)" }}>{field.helpText}</p>
      )}

      {/* Text */}
      {field.type === "text" && (
        readOnly ? (
          <p className="text-[13px]" style={{ color: "var(--text-primary)" }}>{strVal || "—"}</p>
        ) : (
          <input
            type="text"
            className={inputClass}
            style={inputStyle}
            value={strVal}
            placeholder={field.placeholder}
            onChange={(e) => handleChange(e.target.value)}
          />
        )
      )}

      {/* Textarea */}
      {field.type === "textarea" && (
        readOnly ? (
          <p className="text-[13px] whitespace-pre-wrap" style={{ color: "var(--text-primary)" }}>{strVal || "—"}</p>
        ) : (
          <textarea
            className={`${inputClass} min-h-[80px] resize-y`}
            style={inputStyle}
            value={strVal}
            placeholder={field.placeholder}
            onChange={(e) => handleChange(e.target.value)}
          />
        )
      )}

      {/* Number */}
      {field.type === "number" && (
        readOnly ? (
          <p className="text-[13px]" style={{ color: "var(--text-primary)" }}>{numVal ?? "—"}</p>
        ) : (
          <input
            type="number"
            className={inputClass}
            style={inputStyle}
            value={numVal ?? ""}
            placeholder={field.placeholder}
            min={field.validation?.min}
            max={field.validation?.max}
            onChange={(e) => handleChange(e.target.value ? Number(e.target.value) : undefined)}
          />
        )
      )}

      {/* Date */}
      {field.type === "date" && (
        readOnly ? (
          <p className="text-[13px]" style={{ color: "var(--text-primary)" }}>{strVal || "—"}</p>
        ) : (
          <input
            type="date"
            className={inputClass}
            style={inputStyle}
            value={strVal}
            onChange={(e) => handleChange(e.target.value)}
          />
        )
      )}

      {/* Select (Dropdown) */}
      {field.type === "select" && (
        readOnly ? (
          <p className="text-[13px]" style={{ color: "var(--text-primary)" }}>
            {(field.options?.find((o) => o.value === strVal)?.label ?? strVal) || "—"}
          </p>
        ) : (
          <select
            className={inputClass}
            style={inputStyle}
            value={strVal}
            onChange={(e) => handleChange(e.target.value)}
          >
            <option value="">{field.placeholder || "Select..."}</option>
            {field.options?.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        )
      )}

      {/* Radio */}
      {field.type === "radio" && (
        readOnly ? (
          <p className="text-[13px]" style={{ color: "var(--text-primary)" }}>
            {(field.options?.find((o) => o.value === strVal)?.label ?? strVal) || "—"}
          </p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {field.options?.map((opt) => (
              <label key={opt.value} className="flex items-center gap-1.5 text-[12px] cursor-pointer" style={{ color: "var(--text-secondary)" }}>
                <input
                  type="radio"
                  name={field.key}
                  value={opt.value}
                  checked={strVal === opt.value}
                  onChange={() => handleChange(opt.value)}
                />
                {opt.label}
              </label>
            ))}
          </div>
        )
      )}

      {/* Checkbox */}
      {field.type === "checkbox" && (
        readOnly ? (
          <p className="text-[13px]" style={{ color: "var(--text-primary)" }}>
            {arrVal.length > 0 ? arrVal.map((v) => field.options?.find((o) => o.value === v)?.label ?? v).join(", ") : "—"}
          </p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {field.options?.map((opt) => (
              <label key={opt.value} className="flex items-center gap-1.5 text-[12px] cursor-pointer" style={{ color: "var(--text-secondary)" }}>
                <input
                  type="checkbox"
                  checked={arrVal.includes(opt.value)}
                  onChange={(e) => {
                    const next = e.target.checked ? [...arrVal, opt.value] : arrVal.filter((v) => v !== opt.value);
                    handleChange(next);
                  }}
                />
                {opt.label}
              </label>
            ))}
          </div>
        )
      )}

      {/* File — placeholder for FileUploadField */}
      {field.type === "file" && (
        readOnly ? (
          <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
            {arrVal.length > 0 ? `${arrVal.length} file(s)` : "No files"}
          </p>
        ) : (
          <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
            File upload handled by FileUploadField component
          </p>
        )
      )}

      {/* Route — placeholder for RoutePicker */}
      {field.type === "route" && (
        readOnly ? (
          <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
            {value ? "Route selected" : "No route"}
          </p>
        ) : (
          <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
            Route picker handled by RoutePicker component
          </p>
        )
      )}

      {/* Error */}
      {error && (
        <p className="text-[11px] mt-0.5" style={{ color: "var(--color-danger)" }}>{error}</p>
      )}
    </div>
  );
}
