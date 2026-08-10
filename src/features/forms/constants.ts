import type { FieldType, SubmissionStatus } from "./types";

/* ── Field type definitions for the builder palette ── */

export interface FieldTypeDef {
  type: FieldType;
  label: string;
  icon: string; // lucide icon name
  isLayout: boolean; // section/info are layout-only, no data
}

export const FIELD_TYPES: FieldTypeDef[] = [
  { type: "text", label: "Text", icon: "Type", isLayout: false },
  { type: "textarea", label: "Long Text", icon: "AlignLeft", isLayout: false },
  { type: "number", label: "Number", icon: "Hash", isLayout: false },
  { type: "date", label: "Date", icon: "Calendar", isLayout: false },
  { type: "select", label: "Dropdown", icon: "ChevronDown", isLayout: false },
  { type: "radio", label: "Radio", icon: "Circle", isLayout: false },
  { type: "checkbox", label: "Checkbox", icon: "CheckSquare", isLayout: false },
  { type: "file", label: "File Upload", icon: "Upload", isLayout: false },
  { type: "route", label: "Route Picker", icon: "Navigation", isLayout: false },
  { type: "section", label: "Section", icon: "Minus", isLayout: true },
  { type: "info", label: "Info Text", icon: "Info", isLayout: true },
];

/* ── Status colors (maps to CSS variables or hex) ── */

export const SUBMISSION_STATUS_COLORS: Record<SubmissionStatus, { color: string; bg: string }> = {
  Draft:     { color: "var(--text-muted)",       bg: "var(--bg-badge)" },
  Submitted: { color: "var(--color-action)",     bg: "rgba(37,99,235,0.1)" },
  InReview:  { color: "var(--color-purple)",     bg: "rgba(124,58,237,0.1)" },
  Approved:  { color: "var(--color-success)",    bg: "rgba(22,163,74,0.1)" },
  Rejected:  { color: "var(--color-danger)",     bg: "rgba(220,38,38,0.1)" },
  Returned:  { color: "var(--color-warning)",    bg: "rgba(217,119,6,0.1)" },
  Cancelled: { color: "var(--text-faint)",       bg: "var(--bg-badge)" },
};

/* ── Form categories ── */

export const FORM_CATEGORIES = [
  "Finance",
  "HR",
  "Operations",
  "IT",
  "Marketing",
  "General",
] as const;
