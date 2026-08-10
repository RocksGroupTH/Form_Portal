"use client";

import { FieldRenderer } from "./FieldRenderer";
import { FileUploadField } from "./FileUploadField";
import { RoutePicker } from "./RoutePicker";
import type { OfficeFormSubmission, FormFieldDef, OfficeFormFile, OfficeFormLog } from "../types";
import type { RouteData } from "./RoutePicker";
import { format } from "date-fns";
import { Avatar } from "@/components/ui";

interface SubmissionDetailProps {
  submission: OfficeFormSubmission;
  fields: FormFieldDef[];
  files: OfficeFormFile[];
  logs: OfficeFormLog[];
}

export function SubmissionDetail({ submission, fields, files, logs }: SubmissionDetailProps) {
  const filesByKey: Record<string, OfficeFormFile[]> = {};
  files.forEach((f) => {
    if (!filesByKey[f.fieldKey]) filesByKey[f.fieldKey] = [];
    filesByKey[f.fieldKey].push(f);
  });

  return (
    <div>
      {/* Form data */}
      <div
        className="rounded-xl p-4 mb-4"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
      >
        <div className="flex flex-wrap gap-3">
          {fields.map((field) => (
            <div key={field.id} className={field.width === "half" ? "w-full md:w-[calc(50%-8px)]" : "w-full"}>
              {field.type === "file" ? (
                <div>
                  <label className="block text-[12px] font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
                    {field.label}
                  </label>
                  <FileUploadField
                    fieldKey={field.key}
                    submissionId={submission.id}
                    files={filesByKey[field.key] ?? []}
                    onUploaded={() => {}}
                    readOnly
                  />
                </div>
              ) : field.type === "route" ? (
                <div>
                  <label className="block text-[12px] font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
                    {field.label}
                  </label>
                  <RoutePicker
                    value={submission.data[field.key] as RouteData | null}
                    onChange={() => {}}
                    readOnly
                  />
                </div>
              ) : (
                <FieldRenderer
                  field={field}
                  value={submission.data[field.key]}
                  readOnly
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Activity log */}
      {logs.length > 0 && (
        <div>
          <h2 className="text-[14px] font-bold mb-2" style={{ color: "var(--text-heading)" }}>
            Activity
          </h2>
          <div className="flex flex-col gap-2">
            {logs.map((log) => (
              <div key={log.id} className="flex items-start gap-2">
                <Avatar name={log.authorName ?? "?"} size={24} />
                <div>
                  <p className="text-[12px]" style={{ color: "var(--text-primary)" }}>
                    <span className="font-medium">{log.authorName}</span>
                    {" · "}
                    <span style={{ color: "var(--text-muted)" }}>{log.logType}</span>
                  </p>
                  {log.note && (
                    <p className="text-[12px]" style={{ color: "var(--text-secondary)" }}>{log.note}</p>
                  )}
                  <p className="text-[10px]" style={{ color: "var(--text-faint)" }}>
                    {format(new Date(log.createdAt), "dd MMM yyyy HH:mm")}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
