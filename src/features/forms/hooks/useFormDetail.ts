"use client";

import useSWR from "swr";
import type { OfficeForm, FormFieldDef } from "../types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface FormDetailData {
  form: OfficeForm;
  fields: FormFieldDef[];
}

/** Single form with its current version's fields */
export function useFormDetail(formId: number | null) {
  const { data, error, isLoading, mutate } = useSWR<{ ok: boolean; data: FormDetailData }>(
    formId ? `/api/forms/${formId}` : null,
    fetcher,
  );
  return {
    form: data?.data?.form ?? null,
    fields: data?.data?.fields ?? [],
    error,
    isLoading,
    mutate,
  };
}

/** Fetch form by slug (for the fill page) */
export function useFormBySlug(slug: string | null) {
  const { data, error, isLoading, mutate } = useSWR<{ ok: boolean; data: FormDetailData }>(
    slug ? `/api/forms?slug=${slug}` : null,
    fetcher,
  );
  return {
    form: data?.data?.form ?? null,
    fields: data?.data?.fields ?? [],
    error,
    isLoading,
    mutate,
  };
}
