"use client";

import { errInputStyle, errLabelStyle, inputClass, inputStyle, labelClass, requiredStar } from "./shared";

/** ข้อ11 — easy time picker: native time input, 15-minute step. */
export function TimeField({
  label,
  value,
  onChange,
  required,
  hasError,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  required?: boolean;
  hasError?: boolean;
}) {
  return (
    <div>
      <label className={labelClass} style={errLabelStyle(!!hasError)}>
        {label}{required && requiredStar}
      </label>
      <input
        type="time"
        step={900}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className={inputClass}
        style={{ ...inputStyle, ...errInputStyle(!!hasError) }}
      />
    </div>
  );
}
