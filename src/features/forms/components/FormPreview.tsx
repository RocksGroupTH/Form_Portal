"use client";

import { FullScreenModal } from "@/components/ui";
import { FieldRenderer } from "./FieldRenderer";
import type { FormFieldDef } from "../types";

interface FormPreviewProps {
  open: boolean;
  onClose: () => void;
  formName: string;
  fields: FormFieldDef[];
}

export function FormPreview({ open, onClose, formName, fields }: FormPreviewProps) {
  return (
    <FullScreenModal open={open} onClose={onClose} title={`Preview: ${formName}`}>
      <div className="max-w-[700px] mx-auto py-6 px-4">
        <div className="flex flex-wrap gap-3">
          {fields.map((field) => (
            <FieldRenderer key={field.id} field={field} value="" readOnly={false} />
          ))}
        </div>
      </div>
    </FullScreenModal>
  );
}
