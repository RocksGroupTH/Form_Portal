import { loadErpJournalBuildContext } from "@/lib/acc/erp-journal-context";
import { resolveErpTargetProfile } from "@/lib/acc/erp-target-profile";
import { loadDepartmentErpMapsByTarget } from "@/lib/acc/department-map-service";
import { listBrandAccounts } from "@/lib/acc/brand-account-service";
import { listBrandBranches } from "@/lib/acc/brand-branch-service";
import { listBrandJournalBatches } from "@/lib/acc/brand-journal-batch-service";
import { listClrInterfaceConfig } from "@/lib/clr/clear-advance-interface-config-service";
import { loadBuGlAccounts, loadBranchGlAccounts } from "@/lib/clr/clr-bu-gl-map-service";
import { loadBranchLookup, type BranchLookup } from "@/lib/erp/location-lookup";
import type { ErpBcEnvironment } from "@/lib/acc/erp-environment";
import type { ReimburseJournalConfig } from "./reimburse-erp-payload";
import type { ErpConfigCheck } from "./erp-queue-policy";
import { AP4_FORM_CODE } from "@/features/reimburse/constants";

/**
 * AP-4 — the configuration one claim's journal is built from.
 *
 * The IO half of `./reimburse-erp-payload.ts`. It answers one question per
 * source, and **which source answers which question is the whole content of
 * this file** — the user's instruction was *ข้อมูลจำเป็น … ใช้ข้อมูลเดียวกับของ
 * AP-3 แต่จะอ่าน Journal Batch จากของ AP-4*, and read against the code that names
 * four sources and changes exactly one of them:
 *
 * | Value | Where from |
 * |---|---|
 * | VAT input, WHT payable | **AP-3's `AccClearAdvanceInterfaceConfig`** — the same rows. A company's input-tax account does not depend on which form asks. |
 * | Journal Batch | **AP-4's own**, `listBrandJournalBatches(claimBrand, "AP-4")` |
 * | Bank, branch, ERP department, BC target | AP-4's per-form rows, falling back to the `FormCode IS NULL` default |
 * | BU → G/L, Branch → G/L | AP-3's `AccClrBuGlMap` / `AccClrBranchGlMap`, keyed on the Company |
 *
 * **The Journal Batch must never come from `ctx.brandAccounts`.**
 * `resolveJournalBatchName` (`erp-journal-context.ts`) looks a claim brand's
 * batch up by its *interface* brand FIRST, so a target-keyed row beats every
 * claim-brand row including AP-4's own override. That is the AP-2 failure this
 * repository has already shipped once — the screen displayed `TRAVELING` while
 * the payload sent `BEE` — and it is why this file reads the per-form table
 * directly, exactly as `loadAdvanceErpContext` does for AP-2.
 *
 * **Every lookup is keyed on the interface COMPANY, not the claim brand**, from
 * the Locations to the two G/L maps: `ROCKS` posts into `PCTH`, and a map read
 * under `ROCKS` answers empty rather than wrong, which is the quieter failure.
 */

export interface ReimburseErpTarget {
  interfaceTarget: string;
  bcConnectionId: number;
  bcId: string;
  baseUrl: string;
  environment: ErpBcEnvironment;
}

export interface ReimburseErpContext {
  config: ReimburseJournalConfig;
  target: ReimburseErpTarget;
  /** ERP department code for the journal — the requester's HR dept, mapped. */
  departmentCode: string;
  /** The brand's configured BRANCH, or null to fall back to the department. */
  branchCode: string | null;
  buGlAccounts: Record<string, string>;
  branchGlAccounts: Record<string, string>;
  branchBu: BranchLookup;
}

/**
 * The ERP department for this claim.
 *
 * A brand that fixes its department (`deptAsBranch` with a fixed code) uses
 * that; otherwise the requester's HR department is mapped through
 * `DepartmentErpMap` **keyed on the interface target**, which is why a ROCKS
 * claim resolves at all — PCTH holds all fourteen rows and ROCKS holds none.
 *
 * An unmapped department is refused by name rather than sent empty: a journal
 * line with no DEPT dimension is rejected by BC per line, and the per-line
 * reason does not survive the response.
 */
async function resolveReimburseDept(
  fixedDept: string | null,
  deptAsBranch: boolean,
  interfaceTarget: string,
  interfaceByClaim: Record<string, string>,
  hrDeptCode: string | null,
): Promise<string> {
  const fixed = (fixedDept ?? "").trim();
  if (deptAsBranch && fixed) return fixed;

  const hr = (hrDeptCode ?? "").trim();
  const deptMaps = await loadDepartmentErpMapsByTarget(new Map(Object.entries(interfaceByClaim)));
  const mapped = hr ? deptMaps.get(interfaceTarget)?.get(hr) ?? null : null;
  if (!mapped) {
    throw new Error(
      `ยังไม่ได้ map แผนก${hr ? ` "${hr}"` : "ของผู้ขอ"} เป็น Department ของ ERP (${interfaceTarget}) — ` +
        `ตั้งค่าที่ Accounting → Interface ERP → แผนก (HR ↔ ERP)`,
    );
  }
  return mapped;
}

export async function loadReimburseErpContext(
  brandCode: string,
  hrDeptCode?: string | null,
): Promise<ReimburseErpContext> {
  const code = (brandCode ?? "").trim().toUpperCase();
  if (!code) throw new Error("ใบนี้ไม่มีแบรนด์ — ส่ง ERP ไม่ได้");

  const [ctx, bankRows, branchRows, batchRows, clrMap] = await Promise.all([
    loadErpJournalBuildContext(AP4_FORM_CODE),
    listBrandAccounts("bank", code, AP4_FORM_CODE),
    listBrandBranches(code, AP4_FORM_CODE),
    listBrandJournalBatches(code, AP4_FORM_CODE),
    listClrInterfaceConfig(),
  ]);

  // Prefer the AP-4 row, fall back to the picked NULL-default. That fallback is
  // why AP-4 needed no re-entry of what AP-1 already holds.
  const bank = bankRows.find((r) => r.formCode === AP4_FORM_CODE) ?? bankRows[0] ?? null;
  const batch = batchRows.find((r) => r.formCode === AP4_FORM_CODE) ?? batchRows[0] ?? null;
  // Branch is the exception and AP-4 self-owns it, like AP-2: only an explicit
  // AP-4 row counts, so an inherited default (AP-1's shared HQ) is treated as
  // "no branch" and the requester's mapped department answers instead.
  const branch = branchRows.find((r) => r.formCode === AP4_FORM_CODE) ?? null;

  const interfaceTarget = (ctx.interfaceByClaim[code] ?? code).toUpperCase();
  const profile = await resolveErpTargetProfile(interfaceTarget, AP4_FORM_CODE);
  if (!profile?.profileComplete || !profile.bcConnectionId || !profile.bcId || !profile.baseUrl) {
    throw new Error(
      `การตั้งค่า BC สำหรับ ${interfaceTarget} ยังไม่ครบ — ตรวจสอบที่ ตั้งค่า → Interface ERP`,
    );
  }

  const departmentCode = await resolveReimburseDept(
    branch?.fixedErpDeptCode ?? null,
    branch?.deptAsBranch ?? false,
    interfaceTarget,
    ctx.interfaceByClaim,
    hrDeptCode ?? null,
  );

  // The two G/L maps and the Locations are all the Company's, not the claim
  // brand's. Loaded after the target is known for exactly that reason.
  const [buGlAccounts, branchGlAccounts, branchBu] = await Promise.all([
    loadBuGlAccounts(interfaceTarget),
    loadBranchGlAccounts(interfaceTarget),
    loadBranchLookup(interfaceTarget),
  ]);

  const clr = clrMap[code] ?? clrMap[interfaceTarget] ?? {
    journalBatchName: null,
    vatInputGlAccountNo: null,
    whtPayableGlAccountNo: null,
  };

  return {
    config: {
      bankAccountNo: bank?.accountNo?.trim() ?? "",
      // Shared with AP-3 on purpose — see the table above. Null here is not an
      // error yet: it only matters on a claim that actually carries VAT or
      // withholding, and the payload refuses at that point with a message
      // naming which.
      vatInputGlAccountNo: clr.vatInputGlAccountNo?.trim() || null,
      whtPayableGlAccountNo: clr.whtPayableGlAccountNo?.trim() || null,
      // AP-4's own, read from the per-form table and never through
      // ctx.brandAccounts — see the module note.
      journalBatchName: batch?.batchName?.trim() ?? "",
    },
    target: {
      interfaceTarget,
      bcConnectionId: profile.bcConnectionId,
      bcId: profile.bcId,
      baseUrl: profile.baseUrl,
      environment: profile.environment,
    },
    departmentCode,
    branchCode: branch?.branchCode?.trim() || null,
    buGlAccounts,
    branchGlAccounts,
    branchBu,
  };
}

/**
 * The Interface ERP settings of several brands at once, for the queue's
 * readiness column.
 *
 * **Not `loadReimburseErpContext` in a loop.** That one resolves the BC target
 * profile and the requester's ERP department, both of which THROW when
 * unconfigured — correct when a journal is about to be built, fatal on a list
 * whose whole job is to say which claims are not ready yet. This reads only the
 * four values `erpReadiness` checks and reports absence as a value.
 *
 * One read of the shared AP-3 config for all brands; the per-form bank and
 * batch rows are per brand, so those are per brand. The claim brand is the key
 * throughout — these four are keyed on the claim, not on the Company, which is
 * the opposite of the Locations and the two G/L maps above.
 */
export async function loadReimburseErpConfigByBrand(
  brandCodes: readonly string[],
): Promise<ReadonlyMap<string, ErpConfigCheck>> {
  const out = new Map<string, ErpConfigCheck>();
  if (brandCodes.length === 0) return out;

  const clrMap = await listClrInterfaceConfig();

  for (const raw of brandCodes) {
    const code = raw.trim().toUpperCase();
    if (!code || out.has(code)) continue;
    try {
      const [bankRows, batchRows] = await Promise.all([
        listBrandAccounts("bank", code, AP4_FORM_CODE),
        listBrandJournalBatches(code, AP4_FORM_CODE),
      ]);
      const bank = bankRows.find((r) => r.formCode === AP4_FORM_CODE) ?? bankRows[0] ?? null;
      const batch = batchRows.find((r) => r.formCode === AP4_FORM_CODE) ?? batchRows[0] ?? null;
      const clr = clrMap[code] ?? {
        journalBatchName: null,
        vatInputGlAccountNo: null,
        whtPayableGlAccountNo: null,
      };
      out.set(code, {
        bankAccountNo: bank?.accountNo?.trim() ?? null,
        journalBatchName: batch?.batchName?.trim() ?? null,
        vatInputGlAccountNo: clr.vatInputGlAccountNo?.trim() || null,
        whtPayableGlAccountNo: clr.whtPayableGlAccountNo?.trim() || null,
      });
    } catch {
      // A brand whose rows cannot be read is left OUT of the map, which
      // `erpReadiness` reads as null and reports. Inserting a blank record
      // would say "configured, and empty" — a different and wronger claim.
    }
  }
  return out;
}
