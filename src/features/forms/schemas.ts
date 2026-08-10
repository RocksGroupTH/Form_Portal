import { z } from "zod";

/* ── Form CRUD ── */

export const createFormSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(200).regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
  description: z.string().max(1000).optional().nullable(),
  category: z.string().max(100).optional().nullable(),
  icon: z.string().max(50).optional().nullable(),
});

export const updateFormSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional().nullable(),
  category: z.string().max(100).optional().nullable(),
  icon: z.string().max(50).optional().nullable(),
  status: z.enum(["Draft", "Published", "Archived"]).optional(),
});

/* ── Field definition (stored as JSON) ── */

const fieldOptionSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
});

const fieldValidationSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  minLength: z.number().optional(),
  maxLength: z.number().optional(),
  pattern: z.string().optional(),
  maxFiles: z.number().optional(),
  maxFileSizeMB: z.number().optional(),
  acceptedTypes: z.array(z.string()).optional(),
}).optional();

const fieldConditionSchema = z.object({
  fieldId: z.string(),
  operator: z.enum(["eq", "neq", "in"]),
  value: z.union([z.string(), z.array(z.string())]),
}).optional();

export const formFieldDefSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1).max(100),
  type: z.enum(["text", "textarea", "number", "date", "select", "radio", "checkbox", "file", "route", "section", "info"]),
  label: z.string().min(1).max(500),
  required: z.boolean(),
  placeholder: z.string().max(500).optional(),
  helpText: z.string().max(1000).optional(),
  options: z.array(fieldOptionSchema).optional(),
  validation: fieldValidationSchema,
  conditionalOn: fieldConditionSchema,
  order: z.number().int().min(0),
  width: z.enum(["full", "half"]).optional(),
});

/* ── Save version (field schema) ── */

export const saveVersionSchema = z.object({
  fields: z.array(formFieldDefSchema),
});

/* ── Submission ── */

export const createSubmissionSchema = z.object({
  formId: z.number().int().positive(),
  data: z.record(z.string(), z.unknown()),
  isDraft: z.boolean().optional(),
});

export const updateSubmissionSchema = z.object({
  data: z.record(z.string(), z.unknown()),
});
