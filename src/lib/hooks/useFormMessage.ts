"use client";

import { useFormEnvironments } from "@/lib/hooks/useFormEnvironments";

/**
 * A form's notice bullets, already expanded server-side.
 *
 * Rides on the payload every form page already fetches — one SWR key shared
 * across the page, so this costs no request of its own. `FormOwnerNotice`'s
 * own hook is the model.
 *
 * `[]` while loading and `[]` on a failed fetch: a notice box that flashes in
 * and out is worse than one that appears a moment late, and a form must never
 * fail to render because its copy could not be read.
 */
export function useFormMessage(formCode: string): string[] {
  const { data } = useFormEnvironments();
  return data?.forms?.[formCode]?.message ?? [];
}
