/**
 * The pool-reaching half of `mail-form-name.ts` — read `AccFormMaster` at
 * send time, so a rename made at Settings → Form Environment reaches the very
 * next mail rather than whatever was baked into a build.
 *
 * **`getProductionFormPool()`, never `getFormPool()`/`getAccPool()`.**
 * `AccFormMaster` is dual-written (`form-names-service.ts`'s `setFormNames`),
 * so both databases already agree on the name — production is the stable
 * answer that does not vary with which database the request that triggered
 * this mail happened to resolve to. Same reasoning `mail-form-name-lookup`'s
 * sibling reads (`form-names-service.ts`'s own `listFormNames`, for Home) and
 * `team-member/service.ts` already give for identity.
 *
 * **Every failure is swallowed**, `fx-rate-cache.ts`'s rule: a header naming
 * the form is worth nothing next to the mail failing to send at all, so a
 * missing table, a dead pool or a permissions problem all degrade to the
 * hardcoded `MAIL_FORM_NAMES` label rather than throwing out of an approval
 * action whose database work has already committed.
 */
import { getProductionFormPool, sql } from "@/lib/db/mssql";
import { mailFormName, type CanonicalFormName } from "@/lib/acc/mail-form-name";
import type { MailFormCode } from "@/lib/acc/mail-copy";

async function loadCanonicalFormName(code: string): Promise<CanonicalFormName | null> {
  try {
    const pool = await getProductionFormPool();
    const res = await pool
      .request()
      .input("code", sql.NVarChar, code)
      .query<{ FormNameTh: string; FormNameEn: string }>(
        `SELECT FormNameTh, FormNameEn FROM [dbo].[AccFormMaster] WHERE FormCode = @code`,
      );
    const row = res.recordset[0];
    return row ? { nameTh: row.FormNameTh, nameEn: row.FormNameEn } : null;
  } catch {
    // Table missing, pool down, anything: the caller falls back to its own
    // hardcoded label. See the module header.
    return null;
  }
}

/**
 * `ชื่อไทย (English)`, read once for the mail this call is about to build.
 *
 * Callers that build several mails naming the same form in one action (AP-2's
 * and AP-3's submit, which mail both the approver and the requester's own
 * acknowledgement) call this once and pass the result into both builders,
 * rather than reading it again per mail.
 */
export async function resolveMailFormName(code: MailFormCode): Promise<string> {
  const canonical = await loadCanonicalFormName(code);
  return mailFormName(code, canonical);
}
