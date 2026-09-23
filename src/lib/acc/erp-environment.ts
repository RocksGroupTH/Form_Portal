import type { ErpBcEnvironment } from "@/lib/acc/erp-environment-shared";
import { headers } from "next/headers";
import { resolveFormEnvironment } from "@/lib/form-environment";

export type { ErpBcEnvironment } from "@/lib/acc/erp-environment-shared";
export { erpEnvironmentLabel, isErpSandboxHostAllowed } from "@/lib/acc/erp-environment-shared";

export async function getRequestHost(): Promise<string | null> {
  const h = await headers();
  return h.get("host");
}

/**
 * Which Business Central instance this request targets.
 *
 * One switch decides it: the form's own environment. A form flagged UAT at
 * Settings → Form Environment reads and writes the UAT database, and its
 * journals go to BC Sandbox. There is deliberately no separate ERP toggle —
 * two switches sharing the word "UAT" is how a test request ends up in the
 * real ERP.
 *
 * Code with no request scope — scripts, the background email drain — resolves
 * to Production, exactly as its database does.
 */
export async function resolveEffectiveErpEnvironment(): Promise<ErpBcEnvironment> {
  const formEnvironment = await resolveFormEnvironment();
  return formEnvironment === "UAT" ? "Sandbox" : "Production";
}

/**
 * **Which Business Central the SETTINGS screens are configuring — read from the
 * navbar's PRO/UAT switch, not from the route's path.**
 *
 * The user's rule, 2026-09-24: *"UAT หรือ PRO ไม่ต้องเปลี่ยนตรงนี้ เพราะ
 * เปลี่ยนจากด้านบน navbar อยู่แล้ว"*. One switch, where it already is.
 *
 * ## Why these routes cannot just call `resolveEffectiveErpEnvironment()`
 *
 * They would always answer **Production**, however the navbar is set.
 * `/api/request/accounting/settings` and its AP-2 twin are pinned to `null` in
 * `ROUTE_RULES`, deliberately — a config-row id in the path must not be read as
 * an `AccRequest` id — and a `null` class resolves Production outright, before
 * the viewer's UAT mode is ever consulted.
 *
 * **That pin is about which DATABASE answers, and this is a different
 * question.** Since migration 161 the per-brand Interface ERP settings are told
 * apart by a `Environment` COLUMN rather than by which database they sit in, so
 * the two can now disagree honestly: the rows are read from Production's form
 * database, as the pin requires, while the half of them on screen follows the
 * person's own switch. Keying on a column is precisely what made that possible.
 *
 * ## It asks membership, not the cookie
 *
 * `viewerIsTesting()` requires an active `UatTester` row beside the cookie and
 * re-checks it on every resolve, so a forged cookie changes nothing — the same
 * rule the resolver applies everywhere else. With no request scope (scripts,
 * the mail drain) it is false, so this answers Production, exactly as its
 * database does.
 *
 * ## What it must NOT be used for
 *
 * Anything that posts, sends or prices. Those run on the form's own routes,
 * where `resolveEffectiveErpEnvironment()` already answers correctly from the
 * form's environment — and where the answer must come from the record and the
 * form's switches rather than from a switch the viewer can flip mid-flight.
 * This is for reading and writing CONFIGURATION only.
 */
export async function resolveSettingsErpEnvironment(): Promise<ErpBcEnvironment> {
  const { viewerIsTesting } = await import("@/lib/form-environment");
  return (await viewerIsTesting()) ? "Sandbox" : "Production";
}
