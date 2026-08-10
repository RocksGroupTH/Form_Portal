"use client";

import useSWR from "swr";
import type { OfficeFormSubmission, FormFieldDef, OfficeFormFile, OfficeFormLog } from "../types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface ApprovalStep {
  id: number;
  stepName: string;
  stepOrder: number;
  assignedTo: number | null;
  assignedToName: string | null;
  status: string;
  comment: string | null;
  actionAt: string | null;
  createdAt: string;
  dueAt: string | null;
}

interface SubmissionDetailData {
  submission: OfficeFormSubmission;
  fields: FormFieldDef[];
  files: OfficeFormFile[];
  logs: OfficeFormLog[];
  approvals: ApprovalStep[];
}

/** Single submission with fields, files, activity logs, and approvals */
export function useSubmission(submissionId: number | null) {
  const { data, error, isLoading, mutate } = useSWR<{ ok: boolean; data: SubmissionDetailData }>(
    submissionId ? `/api/forms/submissions/${submissionId}` : null,
    fetcher,
  );
  return {
    submission: data?.data?.submission ?? null,
    fields: data?.data?.fields ?? [],
    files: data?.data?.files ?? [],
    logs: data?.data?.logs ?? [],
    approvals: data?.data?.approvals ?? [],
    error,
    isLoading,
    mutate,
  };
}

export type { ApprovalStep };
