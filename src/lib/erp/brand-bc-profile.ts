import { getBrandConfig } from "@/lib/brand-config";
import { listErpTargetSettings } from "@/lib/acc/erp-target-setting-service";
import { getBcConnectionById } from "@/lib/bc/bc-connection";
import type { ErpBcEnvironment } from "@/lib/acc/erp-environment-shared";

/**
 * **Which Business Central company a brand talks to, in a given environment —
 * for syncing data IN and for sending journals OUT.**
 *
 * The user asked for this on 2026-09-23, as a PRO/UAT switch under Config BC on
 * Settings → Brand Configuration: *"ภายใต้ Config BC ให้มี button ให้เลือก
 * ระหว่าง PRO & UAT เพื่อที่จะเอาไว้ใช้ในการ sync data or Send data to ERP"*.
 *
 * ## Two homes, one question, and neither of them moved
 *
 * The two halves were already stored, in different places and edited on
 * different screens, and this module is the first thing that asks them as one
 * question:
 *
 * - **Production** is `Fast_Core.dbo.BrandConfig` — `BcId`, `BcName`,
 *   `BcConnectionId` — the Config BC section of Brand Configuration.
 * - **Sandbox** is `AccBrandErpTargetSetting` — `BcUatId`, `BcUatName`,
 *   `BcUatConnectionId` — Settings → ERP Interface Environment.
 *
 * **Neither was migrated into the other, deliberately.** A third copy of a BC
 * company id is a third thing to keep in step, and both screens are in use:
 * the toggle edits whichever half it is showing, and the ERP Interface
 * Environment page goes on editing the same Sandbox rows it always did. What
 * changes is that one resolver now answers for both, so the sync, the send and
 * the screens cannot disagree about which company a brand posts into.
 *
 * ## `null` is a refusal, and callers must treat it as one
 *
 * An incomplete profile answers `null` rather than falling back to the other
 * environment. **Falling back is the one thing that must never happen here**:
 * a tester whose brand has no Sandbox company configured would otherwise sync
 * from — and post into — the real company, which is precisely what running UAT
 * beside production exists to prevent. A brand with no Sandbox profile simply
 * cannot be synced or sent in UAT until somebody configures one, and the
 * caller says so.
 *
 * The inverse matters too: a Production sync does not fall back to a Sandbox
 * company. Both directions are the same rule — the environment asked for is
 * the environment answered, or nothing.
 */

/** A brand's BC identity in one environment, complete enough to call with. */
export interface BrandBcProfile {
  brandCode: string;
  environment: ErpBcEnvironment;
  bcCompanyId: string;
  bcCompanyName: string;
  bcConnectionId: number;
  baseUrl: string;
}

/**
 * Resolve a brand's BC company for `environment`, or `null` if it is not
 * configured, not complete, or its connection is switched off.
 *
 * `null` covers every incomplete state rather than distinguishing them, because
 * every caller does the same thing with all of them — refuses, and names the
 * brand. The screens are where an admin is told which field is missing.
 */
export async function resolveBrandBcProfile(
  brandCode: string,
  environment: ErpBcEnvironment,
): Promise<BrandBcProfile | null> {
  const code = brandCode.trim().toUpperCase();
  if (!code) return null;

  let companyId: string | null = null;
  let companyName: string | null = null;
  let connectionId: number | null = null;

  if (environment === "Production") {
    const brand = await getBrandConfig(code);
    companyId = brand?.bcId?.trim() || null;
    companyName = brand?.bcName?.trim() || null;
    connectionId = brand?.bcConnectionId ?? null;
  } else {
    /* The DEFAULT row (`FormCode IS NULL`), which answers every form. The UAT
       company is a property of the brand rather than of a form — the same row
       Settings → ERP Interface Environment has always edited — so no form is
       named here, and `listErpTargetSettings()` with no argument is
       defaults-only by design (`per-form-config.ts`). */
    const rows = await listErpTargetSettings();
    const row = rows.find((r) => r.brandCode.trim().toUpperCase() === code);
    companyId = row?.bcUatId?.trim() || null;
    companyName = row?.bcUatName?.trim() || null;
    connectionId = row?.bcUatConnectionId ?? null;
  }

  if (!companyId || !companyName || !connectionId) return null;

  const connection = await getBcConnectionById(connectionId);
  // A switched-off connection is not a usable profile. Checked here rather than
  // at each call site, because a sync that discovers it halfway through has
  // already written rows against a company it cannot finish reading.
  if (!connection?.IsActive || !connection.BaseUrl) return null;

  return {
    brandCode: code,
    environment,
    bcCompanyId: companyId,
    bcCompanyName: companyName,
    bcConnectionId: connectionId,
    baseUrl: connection.BaseUrl,
  };
}

/**
 * The refusal a sync or a send shows when a brand has no profile for the
 * environment being worked in.
 *
 * It names the environment, because "not configured" on its own sends an admin
 * to the wrong screen — the Production company is on Brand Configuration and
 * the Sandbox one is on ERP Interface Environment, and a brand that works in
 * production and fails in UAT looks like a fault rather than a gap.
 */
export function missingBcProfileMessage(
  brandCode: string,
  environment: ErpBcEnvironment,
): string {
  return environment === "Production"
    ? `แบรนด์ ${brandCode} ยังไม่ได้ตั้งค่า Config BC (PRO) — ตั้งที่ Settings → Brand Configuration`
    : `แบรนด์ ${brandCode} ยังไม่ได้ตั้งค่า Config BC (UAT) — ตั้งที่ Settings → Brand Configuration หรือ ERP Interface Environment`;
}
