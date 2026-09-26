import { env } from "@/env";
import { documentButton, documentUrl } from "@/lib/acc/mail-link";
import {
  buildClearAdvanceEmailHtml,
  type ClrEmailData,
  type ClrEmailTrigger,
} from "@/lib/clr/clear-advance-email-core";

export type { ClrEmailData, ClrEmailTrigger };

/**
 * The layout in `clear-advance-email-core`, plus the one thing that needs the
 * environment: the link.
 *
 * AP-2 builds its own `<a href>` from `env.NEXT_PUBLIC_APP_URL ?? ""`, which is
 * the exact failure `@/lib/acc/mail-link` exists to prevent — AP-3's own
 * docblock records that it was the one form whose link was relative and dead.
 * Matching AP-2's layout is the point; matching that is not. `documentButton`
 * refuses a URL that is not absolute and emits nothing, so a misconfigured base
 * drops the button rather than shipping a link to nowhere.
 */
export function clearAdvanceDocumentButton(id: number): string {
  return documentButton(documentUrl(env.NEXT_PUBLIC_APP_URL, "/request/clear-advance", id));
}

export function buildClearAdvanceEmail(
  trigger: ClrEmailTrigger,
  d: ClrEmailData,
  /** Passed straight through to `buildClearAdvanceEmailHtml` — see its own doc. */
  formName?: string,
): { subject: string; html: string } {
  return buildClearAdvanceEmailHtml(trigger, d, clearAdvanceDocumentButton(d.id), formName);
}
