/* ── Field Definition (stored in FieldsJson) ── */

export type FieldType =
  | "text" | "textarea" | "number" | "date"
  | "select" | "radio" | "checkbox"
  | "file" | "route" | "section" | "info";

export interface FieldOption {
  label: string;
  value: string;
}

export interface FieldValidation {
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  maxFiles?: number;
  maxFileSizeMB?: number;
  acceptedTypes?: string[];
}

export interface FieldCondition {
  fieldId: string;
  operator: "eq" | "neq" | "in";
  value: string | string[];
}

export interface FormFieldDef {
  id: string;
  key: string;
  type: FieldType;
  label: string;
  required: boolean;
  placeholder?: string;
  helpText?: string;
  options?: FieldOption[];
  validation?: FieldValidation;
  conditionalOn?: FieldCondition;
  order: number;
  width?: "full" | "half";
}

/* ── Form ── */

export type FormStatus = "Draft" | "Published" | "Archived";

export interface OfficeForm {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  category: string | null;
  icon: string | null;
  status: FormStatus;
  currentVersion: number;
  createdBy: number;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
}

/* ── Form Version ── */

export interface OfficeFormVersion {
  id: number;
  formId: number;
  version: number;
  fields: FormFieldDef[];
  publishedAt: string | null;
  publishedBy: number | null;
  createdAt: string;
}

/* ── Submission ── */

export type SubmissionStatus =
  | "Draft" | "Submitted" | "InReview"
  | "Approved" | "Rejected" | "Returned" | "Cancelled";

export interface OfficeFormSubmission {
  id: number;
  formId: number;
  formVersionId: number;
  formName?: string;
  formSlug?: string;
  submittedBy: number;
  submittedByName?: string;
  status: SubmissionStatus;
  data: Record<string, unknown>;
  submittedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ── File ── */

export interface OfficeFormFile {
  id: number;
  submissionId: number;
  fieldKey: string;
  fileName: string;
  fileSize: number;
  contentType: string;
  storagePath: string;
  storageBackend: string;
  uploadedBy: number;
  uploadedAt: string;
}

/* ── Activity Log ── */

export type LogType =
  | "Created" | "Submitted" | "Approved" | "Rejected"
  | "Returned" | "Cancelled" | "Revised" | "Published"
  | "Archived" | "Comment";

export interface OfficeFormLog {
  id: number;
  entityType: string;
  entityId: number;
  authorId: number;
  authorName?: string;
  logType: LogType;
  note: string | null;
  createdAt: string;
}
