"use client";

import React, { useRef } from "react";
import { Upload, X, FileIcon } from "lucide-react";
import type { OfficeFormFile } from "../types";

interface FileUploadFieldProps {
  fieldKey: string;
  submissionId: number | null;
  files: OfficeFormFile[];
  maxFiles?: number;
  acceptedTypes?: string[];
  onUploaded: (files: OfficeFormFile[]) => void;
  readOnly?: boolean;
}

export function FileUploadField({
  fieldKey, submissionId, files, maxFiles = 10, acceptedTypes, onUploaded, readOnly,
}: FileUploadFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (fileList: FileList) => {
    if (!submissionId) return;
    const remaining = maxFiles - files.length;
    const toUpload = Array.from(fileList).slice(0, remaining);

    const formData = new FormData();
    formData.append("fieldKey", fieldKey);
    toUpload.forEach((f) => formData.append("file", f));

    const res = await fetch(`/api/forms/submissions/${submissionId}/files`, {
      method: "POST",
      body: formData,
    });
    if (res.ok) {
      const json = await res.json();
      onUploaded(json.data);
    }
  };

  if (readOnly) {
    return (
      <div className="flex flex-wrap gap-2">
        {files.length === 0 && (
          <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>No files</p>
        )}
        {files.map((f) => (
          <a
            key={f.id}
            href={`/api/forms/files/${f.id}`}
            target="_blank"
            rel="noopener"
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] no-underline"
            style={{ background: "var(--bg-badge)", color: "var(--text-secondary)", border: "1px solid var(--border-card)" }}
          >
            <FileIcon size={12} />
            {f.fileName}
          </a>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-2">
        {files.map((f) => (
          <div
            key={f.id}
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px]"
            style={{ background: "var(--bg-badge)", color: "var(--text-secondary)", border: "1px solid var(--border-card)" }}
          >
            <FileIcon size={12} />
            {f.fileName}
            <button
              className="cursor-pointer border-none bg-transparent p-0"
              style={{ color: "var(--text-muted)" }}
              onClick={() => {
                onUploaded(files.filter((x) => x.id !== f.id));
              }}
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>

      {files.length < maxFiles && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] cursor-pointer transition-colors"
          style={{
            background: "var(--bg-input)",
            color: "var(--text-muted)",
            border: "1px dashed var(--border-input)",
          }}
        >
          <Upload size={14} />
          Upload file{maxFiles > 1 ? "s" : ""} ({files.length}/{maxFiles})
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        multiple={maxFiles > 1}
        accept={acceptedTypes?.join(",")}
        className="hidden"
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
