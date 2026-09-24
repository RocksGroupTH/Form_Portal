"use client";

import { useFormEnvironments } from "@/lib/hooks/useFormEnvironments";
import { formOwnerNotice } from "@/lib/form-environment/form-owner-text";

/**
 * "กรณีต้องการยกเลิกติดต่อเจ้าของฟอร์ม: ชื่อ (อีเมล)" — one line, one
 * component, on every form (the user, 2026-09-24).
 *
 * It reads the owners off `/api/form-environment`, which every form page
 * already fetches for its environment chip, so this costs no request of its
 * own. `useFormEnvironments` shares one SWR key across the page.
 *
 * **It always renders something.** With no owner named — which is every form
 * the day migration 163 lands, since it seeds nothing — it falls back to the
 * bare sentence the forms carried before, because the instruction still holds
 * even while the page cannot say who to ask. The same fallback covers a
 * payload that failed to load: a contact line must never be the reason a form
 * renders an error.
 *
 * Returns the text rather than a styled block, because the five forms print
 * their footer notes differently — AP-1 maps an array of strings through one
 * `<p>`, and the others do not all have a footer at all.
 */
export function useFormOwnerNotice(formCode: string): string {
  const { data } = useFormEnvironments();
  return formOwnerNotice(data?.forms?.[formCode]?.owners);
}

/** The same line as a rendered note, for a form with nowhere to put a string. */
export function FormOwnerNotice({
  formCode,
  className,
}: {
  formCode: string;
  className?: string;
}) {
  const text = useFormOwnerNotice(formCode);
  return (
    <p
      className={className ?? "text-[12px] leading-relaxed"}
      style={{ color: "var(--text-muted)" }}
    >
      • {text}
    </p>
  );
}
