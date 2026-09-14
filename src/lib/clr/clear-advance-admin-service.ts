import { getAccPool, sql } from "@/lib/acc/pool";
import { isDimensionType, type DimensionType } from "./gl-dimension";
import { getAppPool } from "@/lib/db/mssql";
import { loadErpJournalBuildContext } from "@/lib/acc/erp-journal-context";
import { AP3_FORM_CODE } from "@/features/clear-advance/constants";

/** DB holding the synced BC chart of accounts (per Brand/Company). */
/**
 * The companies a G/L category rule can exist for.
 *
 * The four with a Business Central profile — `ERP_INTERFACE_BRANDS` says the
 * same thing and is what the settings screen offers. Written out here rather
 * than imported so this server module keeps no dependency on a constant that
 * exists for the browser-side brand picker; `gl-company-guard.test.ts` asserts
 * the two lists agree.
 */
export const GL_RULE_COMPANIES: readonly string[] = ["PCTH", "KSI", "PCMY", "UNO"];

const ERP_DATA_DB = process.env.MSSQL_ERP_DATA_DATABASE || "Rocks_ERP_Data";

export interface ErpGlOption { accountNo: string; displayName: string | null }

/**
 * Active GL accounts for a claim brand, read from Rocks_ERP_Data.dbo.ErpAccounts.
 * The brand resolves to its target Company via AP-1's interfaceByClaim map
 * (e.g. ROCKS → PCTH), since ErpAccounts is keyed by Company.
 */
/**
 * G/L accounts for an already-resolved target Company (e.g. PCTH) — no brand
 * resolution, and therefore no form pinned into it.
 *
 * The form-agnostic half of `listClrErpGlOptions` below, split out the same way
 * `listClrErpBranchesForCompany` was: that one hard-codes `"AP-3"` when it
 * resolves a claim brand, so calling it from another form would resolve that
 * form's brand through AP-3's interface map.
 *
 * **No category filter, deliberately.** A BU → G/L rule points a franchised
 * store's spend at a RECEIVABLE, not an expense account, so the expense-only
 * list AP-4's line picker uses (`listExpenseAccounts`) would not contain
 * `110721001` — the very account those rules already use today.
 */
export async function listClrErpGlOptionsForCompany(company: string): Promise<ErpGlOption[]> {
  const c = company.trim().toUpperCase();
  if (!c) return [];
  const pool = await getAppPool(ERP_DATA_DB);
  const r = await pool.request()
    .input("company", sql.NVarChar, c)
    .query(`
      SELECT AccountNo, DisplayName FROM [dbo].[ErpAccounts]
      WHERE AccountCategory = 'GL' AND BrandCode = @company
        AND IsActive = 1 AND (IsBlocked = 0 OR IsBlocked IS NULL)
      ORDER BY AccountNo
    `);
  return (r.recordset as Record<string, unknown>[]).map((x) => ({
    accountNo: x.AccountNo as string,
    displayName: (x.DisplayName as string) ?? null,
  }));
}

export async function listClrErpGlOptions(brandCode: string): Promise<ErpGlOption[]> {
  const brand = brandCode.trim().toUpperCase();
  if (!brand) return [];
  const ctx = await loadErpJournalBuildContext("AP-3");
  const company = (ctx.interfaceByClaim[brand] ?? brand).toUpperCase();
  return listClrErpGlOptionsForCompany(company);
}

export interface ErpJournalBatchOption { batchName: string; displayName: string | null; templateName: string | null }

/**
 * Active General Journal Batches for a claim brand, read from
 * Rocks_ERP_Data.dbo.ErpGeneralJournalBatch (keyed by Company). Brand resolves to
 * its target Company via interfaceByClaim (e.g. ROCKS → PCTH).
 */
/**
 * Journal Batches for an already-resolved target Company (e.g. PCTH), read
 * directly from Rocks_ERP_Data — no brand→Company resolution. AP-3's settings
 * card passes the Company it inherits from AP-2 (interfaceTarget) so the batch
 * list always matches the Company shown on the card.
 */
export async function listClrErpJournalBatchesForCompany(company: string): Promise<ErpJournalBatchOption[]> {
  const c = company.trim().toUpperCase();
  if (!c) return [];
  const pool = await getAppPool(ERP_DATA_DB);
  const r = await pool.request()
    .input("company", sql.NVarChar, c)
    .query(`
      SELECT BatchName, DisplayName, TemplateName FROM [dbo].[ErpGeneralJournalBatch]
      WHERE BrandCode = @company AND IsActive = 1 AND (IsBlocked = 0 OR IsBlocked IS NULL)
      ORDER BY BatchName
    `);
  return (r.recordset as Record<string, unknown>[]).map((x) => ({
    batchName: x.BatchName as string,
    displayName: (x.DisplayName as string) ?? null,
    templateName: (x.TemplateName as string) ?? null,
  }));
}

export async function listClrErpJournalBatches(brandCode: string): Promise<ErpJournalBatchOption[]> {
  const brand = brandCode.trim().toUpperCase();
  if (!brand) return [];
  const ctx = await loadErpJournalBuildContext("AP-3");
  const company = (ctx.interfaceByClaim[brand] ?? brand).toUpperCase();
  return listClrErpJournalBatchesForCompany(company);
}

export interface ErpBranchOption { code: string; displayName: string | null }

/** Active, non-blocked BRANCH dimension values for a Company, from Rocks_ERP_Data. */
export async function listClrErpBranchesForCompany(company: string): Promise<ErpBranchOption[]> {
  const c = company.trim().toUpperCase();
  if (!c) return [];
  const pool = await getAppPool(ERP_DATA_DB);
  const r = await pool.request()
    .input("company", sql.NVarChar, c)
    .query(`
      SELECT Code, DisplayName FROM [dbo].[ErpDimensionValue]
      WHERE BrandCode = @company AND DimensionCode = 'BRANCH'
        AND IsActive = 1 AND (IsBlocked = 0 OR IsBlocked IS NULL)
      ORDER BY Code
    `);
  return (r.recordset as Record<string, unknown>[]).map((x) => ({
    code: x.Code as string,
    displayName: (x.DisplayName as string) ?? null,
  }));
}

/**
 * BRANCH options for a claim brand — resolves brand → target Company via
 * interfaceByClaim (e.g. ROCKS → PCTH), then reads Rocks_ERP_Data.ErpDimensionValue.
 */
export async function listClrErpBranchOptions(brandCode: string): Promise<ErpBranchOption[]> {
  const brand = brandCode.trim().toUpperCase();
  if (!brand) return [];
  const ctx = await loadErpJournalBuildContext("AP-3");
  const company = (ctx.interfaceByClaim[brand] ?? brand).toUpperCase();
  return listClrErpBranchesForCompany(company);
}

/**
 * Claim brand → the Business Central company whose books it posts into
 * (ROCKS → PCTH), for AP-3.
 *
 * Exported because THREE separate readers of the G/L category rules need the
 * same answer — the picker, the AI suggestion and the submit guard — and three
 * inline copies of `ctx.interfaceByClaim[brand] ?? brand` is three places for
 * one of them to be given the claim brand by mistake, which answers an empty
 * list rather than an error.
 */
export async function resolveClrCompany(brandCode: string | null | undefined): Promise<string> {
  const brand = (brandCode ?? "").trim().toUpperCase();
  if (!brand) return "";
  const ctx = await loadErpJournalBuildContext("AP-3");
  return (ctx.interfaceByClaim[brand] ?? brand).toUpperCase();
}

function num(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

/* ─────────────────────────── AP-3.2 G/L master ─────────────────────────── */

/** One category as one company sees it — the shared half plus that company's rule. */
export interface GlCompanyRow {
  id: number;
  glAccountNo: string;
  nameTh: string | null;
  nameEn: string | null;
  sortOrder: number;
  /** The stored Thai override, or `null` where `nameTh` is Business Central's. */
  nameThCustom: string | null;
  /** Business Central's own wording, which `nameTh` falls back to. */
  nameErp: string | null;
  /** `null` = this company has no rule for the category yet. */
  dimensionType: DimensionType | null;
  isActive: boolean;
  /**
   * The account is not in this company's synced chart of accounts — removed,
   * blocked, or made non-postable in Business Central since a rule was set on
   * it. Listed anyway: the rule is still live, and one nobody can see is one
   * nobody can turn off.
   */
  missingFromErp?: boolean;
}


/**
 * One company's whole AP-3.2 category list, for the settings screen.
 *
 * The **category** — its number and its two names — comes from
 * `AccClearAdvanceGl` and is shared by every company; the **rule** — which
 * dimension a line charging it must carry, and whether it is offered at all —
 * comes from `AccClearAdvanceGlCompany` and is this company's alone.
 * Migration 151's header says why the two are separate tables.
 *
 * **A LEFT JOIN, so a category with no rule for this company still lists.**
 * That is the state a company added after the backfill is in, and the state
 * every company is in for a category created from another company's screen.
 * It reads as "not configured" rather than vanishing — an invisible category
 * cannot be switched on.
 *
 * `company` is the BUSINESS CENTRAL company (PCTH/KSI/PCMY/UNO), never the
 * claim brand: ROCKS claims post into PCTH's books and read PCTH's rules.
 */
export async function listGlAccountsForCompany(company: string): Promise<GlCompanyRow[]> {
  const co = (company ?? "").trim().toUpperCase();
  if (!co) return [];

  // **Two reads, merged here, rather than one cross-database join.** The chart
  // of accounts lives in Rocks_ERP_Data and the rules in the form database, and
  // a three-part join would have to interpolate MSSQL_ERP_DATA_DATABASE into
  // the SQL — the env-drift hazard CLAUDE.md records for that very variable.
  const [erp, form] = await Promise.all([
    (async () => {
      const pool = await getAppPool(ERP_DATA_DB);
      const r = await pool.request().input("co", sql.NVarChar, co).query(`
        SELECT AccountNo, DisplayName
        FROM [dbo].[ErpAccounts]
        WHERE BrandCode = @co
          AND AccountCategory = 'GL'
          AND IsActive = 1
          AND (IsBlocked = 0 OR IsBlocked IS NULL)
          -- POSTABLE ONLY. Measured 2026-09-14: PCTH has 1,126 active G/L
          -- accounts and only 584 can be posted to; the rest are headings and
          -- totals. Offering one is offering a choice BC refuses every time.
          AND JSON_VALUE(RawJson, '$.accountType') = 'Posting'
          AND JSON_VALUE(RawJson, '$.directPosting') = 'true'
        ORDER BY AccountNo
      `);
      return r.recordset as Record<string, unknown>[];
    })(),
    (async () => {
      const pool = await getAccPool();
      const r = await pool.request().input("co", sql.NVarChar, co).query(`
        SELECT g.Id, g.GlAccountNo, g.NameTh, g.NameEn, g.SortOrder,
               c.DimensionType, c.IsActive
        FROM [dbo].[AccClearAdvanceGl] AS g
        LEFT JOIN [dbo].[AccClearAdvanceGlCompany] AS c
          ON c.GlAccountNo = g.GlAccountNo AND c.Company = @co
      `);
      return r.recordset as Record<string, unknown>[];
    })(),
  ]);

  const configured = new Map(form.map((r) => [String(r.GlAccountNo ?? "").trim(), r]));

  const rows: GlCompanyRow[] = erp.map((a) => {
    const no = String(a.AccountNo ?? "").trim();
    const cfg = configured.get(no);
    return {
      id: (cfg?.Id as number) ?? 0,
      glAccountNo: no,
      // A configured Thai name WINS over Business Central's. The forty-three
      // were named by accounting for this screen; BC's DisplayName is the
      // chart's own wording and is what everything else falls back to.
      nameTh: ((cfg?.NameTh as string) ?? "").trim() || ((a.DisplayName as string) ?? null),
      // What is actually STORED, as against what is shown. The screen fills its
      // Thai box with `nameTh` and decides against `nameErp` whether typing
      // changed anything, so tabbing through a row saves nothing and today's
      // Business Central wording is never frozen into the register by accident.
      nameThCustom: ((cfg?.NameTh as string) ?? "").trim() || null,
      // Business Central's own wording for this account, or null for a rule on
      // an account the sync no longer returns.
      nameErp: ((a.DisplayName as string) ?? "").trim() || null,
      // BC carries ONE name and it is Thai (measured: 610301001 =
      // "เงินเดือนและค่าจ้างพนักงาน"), so there is nothing to fall back to here.
      nameEn: ((cfg?.NameEn as string) ?? "").trim() || null,
      sortOrder: (cfg?.SortOrder as number) ?? 0,
      dimensionType: isDimensionType(cfg?.DimensionType)
        ? (cfg?.DimensionType as DimensionType)
        : null,
      isActive: cfg?.IsActive === null || cfg?.IsActive === undefined ? false : !!cfg.IsActive,
    };
  });

  // A rule on an account the sync no longer returns still lists, at the end:
  // it is live — the picker and the submit guard both still honour it — and a
  // rule nobody can see is a rule nobody can turn off.
  for (const entry of Array.from(configured.entries())) {
    const [no, cfg] = entry;
    if (rows.some((r) => r.glAccountNo === no)) continue;
    rows.push({
      id: (cfg.Id as number) ?? 0,
      glAccountNo: no,
      nameTh: (cfg.NameTh as string) ?? null,
      nameThCustom: (cfg.NameTh as string) ?? null,
      // Not in the synced chart at all — there is no BC wording to compare with.
      nameErp: null,
      nameEn: (cfg.NameEn as string) ?? null,
      sortOrder: (cfg.SortOrder as number) ?? 0,
      dimensionType: isDimensionType(cfg.DimensionType)
        ? (cfg.DimensionType as DimensionType)
        : null,
      isActive: !!cfg.IsActive,
      missingFromErp: true,
    });
  }

  return rows;
}

/** `AccClearAdvanceGl`'s two name columns, at the bound the columns have. */
const NAME_MAX_LEN = 200;

/**
 * Rename one category.
 *
 * **The names are SHARED by every company** — one row in the register, which is
 * the whole reason the rules were split into a second table (migration 151's
 * header). An admin editing them from PCTH's screen is editing what KSI sees,
 * and the screen says so.
 *
 * A blank Thai name is stored as NULL rather than as an empty string, so the
 * list falls back to Business Central's own wording again; that is how an
 * override is REMOVED, and it is why the screen's input is empty rather than
 * pre-filled when there is no override.
 *
 * Bounded here rather than left to the column: `NVARCHAR(200)` truncates a
 * long value silently on some paths and raises an untranslated driver error on
 * others, and neither is a Thai message.
 */
export async function setGlAccountNames(input: {
  glAccountNo: string;
  nameTh?: string | null;
  nameEn?: string | null;
}): Promise<void> {
  const glNo = (input.glAccountNo ?? "").trim();
  if (!glNo) throw new Error("กรุณาระบุเลขที่บัญชี G/L");
  const th = (input.nameTh ?? "").trim();
  const en = (input.nameEn ?? "").trim();
  if (th.length > NAME_MAX_LEN || en.length > NAME_MAX_LEN) {
    throw new Error(`ชื่อยาวเกิน ${NAME_MAX_LEN} ตัวอักษร`);
  }

  const pool = await getAccPool();
  const exists = await pool.request().input("no", sql.NVarChar, glNo)
    .query(`SELECT TOP 1 Id FROM [dbo].[AccClearAdvanceGl] WHERE GlAccountNo=@no`);

  if (exists.recordset.length === 0) {
    // Naming an account nobody has ticked yet. The register row is created for
    // the name alone — it carries no company rule, so the account is offered to
    // nobody until somebody ticks a Dimension.
    //
    // **A blank Thai name is stored as NULL, not as Business Central's.** Typing
    // only an English name must not freeze today's BC wording into the register
    // as an override nobody asked for — measured doing exactly that before this
    // line changed. `setGlCompanyRule` fills the name in if and when the account
    // is ever ticked, which is the only moment the picker needs one.
    await pool.request()
      .input("no", sql.NVarChar, glNo)
      .input("th", sql.NVarChar, th || null)
      .input("en", sql.NVarChar, en || null)
      .query(`INSERT INTO [dbo].[AccClearAdvanceGl]
                (GlAccountNo, NameTh, NameEn, DimensionType, IsActive, SortOrder)
              VALUES (@no, @th, @en, 'Employee', 1, 0)`);
    return;
  }

  await pool.request()
    .input("no", sql.NVarChar, glNo)
    .input("th", sql.NVarChar, th || null)
    .input("en", sql.NVarChar, en || null)
    .query(`UPDATE [dbo].[AccClearAdvanceGl]
            SET NameTh=@th, NameEn=@en, UpdatedAt=SYSDATETIME()
            WHERE GlAccountNo=@no`);
}

/**
 * Remove one company's rule for one category, returning the account to
 * "ยังไม่ได้ตั้งค่า" — exactly where it was before anybody ticked it.
 *
 * **The register row is left alone.** It carries the account's names, which are
 * shared by every company, and another company may well still have a rule
 * pointing at it. Only this company's rule goes.
 *
 * Deleting rather than storing an empty dimension is what lets the screen offer
 * "untick everything": `DimensionType` has no value for "neither", and the
 * absence of a row already means precisely that.
 */
export async function clearGlCompanyRule(company: string, glAccountNo: string): Promise<void> {
  const co = (company ?? "").trim().toUpperCase();
  const glNo = (glAccountNo ?? "").trim();
  if (!co || !glNo) return;
  const pool = await getAccPool();
  await pool.request()
    .input("co", sql.NVarChar, co)
    .input("no", sql.NVarChar, glNo)
    .query(`DELETE FROM [dbo].[AccClearAdvanceGlCompany]
            WHERE Company=@co AND GlAccountNo=@no`);
}

/**
 * Set one company's rule for one category. Creates the row if this company has
 * none yet, which is how a category reaches a company it was not created from.
 *
 * **`isActive` cannot be true without a dimension** — there is no state where
 * a category is offered and nothing says what a line charging it must carry.
 * The screen cannot produce it either (unticking the last box is refused), so
 * this is the second of two layers rather than the only one.
 */
export async function setGlCompanyRule(input: {
  company: string;
  glAccountNo: string;
  dimensionType: DimensionType;
  isActive: boolean;
  /** Business Central's name, used only if this account has no register row yet. */
  nameTh?: string | null;
}): Promise<void> {
  const co = (input.company ?? "").trim().toUpperCase();
  const glNo = (input.glAccountNo ?? "").trim();
  if (!co) throw new Error("กรุณาเลือกบริษัท");
  if (!glNo) throw new Error("กรุณาระบุเลขที่บัญชี G/L");
  if (!isDimensionType(input.dimensionType)) throw new Error("ประเภท Dimension ไม่ถูกต้อง");

  const pool = await getAccPool();
  const exists = await pool.request().input("no", sql.NVarChar, glNo)
    .query(`SELECT TOP 1 Id, NameTh FROM [dbo].[AccClearAdvanceGl] WHERE GlAccountNo=@no`);

  // A register row created by a RENAME carries no Thai name unless somebody
  // typed one — see `setGlAccountNames`. This is the moment it needs one: from
  // here the account is in the form's picker, and the picker reads its names
  // from the register. Filled only when blank, so it never overwrites an
  // override somebody typed.
  const existingTh = String(exists.recordset[0]?.NameTh ?? "").trim();
  if (exists.recordset.length > 0 && existingTh === "" && (input.nameTh ?? "").trim() !== "") {
    await pool.request()
      .input("no", sql.NVarChar, glNo)
      .input("th", sql.NVarChar, (input.nameTh ?? "").trim())
      .query(`UPDATE [dbo].[AccClearAdvanceGl]
              SET NameTh=@th, UpdatedAt=SYSDATETIME()
              WHERE GlAccountNo=@no AND (NameTh IS NULL OR LTRIM(RTRIM(NameTh)) = '')`);
  }

  if (exists.recordset.length === 0) {
    // **The register row is created here, not refused.** The settings screen
    // now lists the company's whole postable chart of accounts, so the first
    // tick on an account is also the first time it has been a category — and
    // the register is where the form's PICKER reads its names from, so a rule
    // without one would be live and nameless. The name comes from the caller
    // because it comes from Business Central, which this function does not read.
    const name = (input.nameTh ?? "").trim() || glNo;
    await pool.request()
      .input("no", sql.NVarChar, glNo)
      .input("th", sql.NVarChar, name)
      .input("dim", sql.NVarChar, input.dimensionType)
      .query(`INSERT INTO [dbo].[AccClearAdvanceGl]
                (GlAccountNo, NameTh, NameEn, DimensionType, IsActive, SortOrder)
              VALUES (@no, @th, NULL, @dim, 1, 0)`);
  }

  await pool.request()
    .input("co", sql.NVarChar, co)
    .input("no", sql.NVarChar, glNo)
    .input("dim", sql.NVarChar, input.dimensionType)
    .input("active", sql.Bit, input.isActive ? 1 : 0)
    .query(`
      MERGE [dbo].[AccClearAdvanceGlCompany] AS t
      USING (SELECT @co AS Company, @no AS GlAccountNo) AS s
        ON t.Company = s.Company AND t.GlAccountNo = s.GlAccountNo
      WHEN MATCHED THEN
        UPDATE SET DimensionType=@dim, IsActive=@active, UpdatedAt=SYSDATETIME()
      WHEN NOT MATCHED THEN
        INSERT (Company, GlAccountNo, DimensionType, IsActive)
        VALUES (@co, @no, @dim, @active);
    `);
}

/*
 * `listGlAccountsAll` lived here and is deleted (2026-09-14).
 *
 * It returned `AccClearAdvanceGl.DimensionType` and `.IsActive`, which stopped
 * being the answer the moment migration 151 moved both onto the company. The
 * columns still exist — dropping a column under a running build is its own
 * outage — so a function that reads them would still compile, still run, and
 * quietly hand back the pre-151 answer to whoever called it next.
 * `listGlAccountsForCompany` above is the read.
 */

/** Create or update an AP-3.2 G/L account. */
export async function upsertGlAccount(
  input: {
    id?: number;
    glAccountNo: string;
    nameTh?: string | null;
    nameEn?: string | null;
    dimensionType: "Employee" | "Branch" | "Both";
    isActive?: boolean;
    sortOrder?: number;
    /** Which company's screen created it — the only one it starts switched on for. */
    company?: string | null;
  },
): Promise<void> {
  const glNo = input.glAccountNo.trim();
  if (!glNo) throw new Error("กรุณากรอกเลขที่บัญชี G/L");
  if (!["Employee", "Branch", "Both"].includes(input.dimensionType)) {
    throw new Error("ประเภท Dimension ไม่ถูกต้อง");
  }
  const pool = await getAccPool();
  const active = input.isActive === false ? 0 : 1;

  if (input.id) {
    await pool.request()
      .input("id", sql.Int, input.id)
      .input("no", sql.NVarChar, glNo)
      .input("th", sql.NVarChar, input.nameTh ?? null)
      .input("en", sql.NVarChar, input.nameEn ?? null)
      .input("dim", sql.NVarChar, input.dimensionType)
      .input("active", sql.Bit, active)
      .input("sort", sql.Int, input.sortOrder ?? 0)
      .query(`UPDATE [dbo].[AccClearAdvanceGl]
              SET GlAccountNo=@no, NameTh=@th, NameEn=@en, DimensionType=@dim,
                  IsActive=@active, SortOrder=@sort, UpdatedAt=SYSDATETIME()
              WHERE Id=@id`);
  } else {
    const dupe = await pool.request().input("no", sql.NVarChar, glNo)
      .query(`SELECT TOP 1 Id FROM [dbo].[AccClearAdvanceGl] WHERE GlAccountNo=@no`);
    if (dupe.recordset.length > 0) throw new Error("เลขที่บัญชีนี้มีอยู่แล้ว");
    await pool.request()
      .input("no", sql.NVarChar, glNo)
      .input("th", sql.NVarChar, input.nameTh ?? null)
      .input("en", sql.NVarChar, input.nameEn ?? null)
      .input("dim", sql.NVarChar, input.dimensionType)
      .input("active", sql.Bit, active)
      .input("sort", sql.Int, input.sortOrder ?? 0)
      .query(`INSERT INTO [dbo].[AccClearAdvanceGl] (GlAccountNo, NameTh, NameEn, DimensionType, IsActive, SortOrder)
              VALUES (@no, @th, @en, @dim, @active, @sort)`);

    // A new category reaches EVERY company, carrying the dimension it was
    // created with — but **switched on only for the company it was created
    // from**. Created active everywhere it would quietly widen what three
    // other companies may charge; created for one company only it would be
    // invisible to the rest, and an invisible category cannot be switched on.
    const createdFor = (input.company ?? "").trim().toUpperCase();
    for (const co of GL_RULE_COMPANIES) {
      await setGlCompanyRule({
        company: co,
        glAccountNo: glNo,
        dimensionType: input.dimensionType,
        isActive: co === createdFor,
      });
    }
  }
}

/* ─────────────────────────── approvals queue ─────────────────────────── */

export interface ClrQueueRow {
  id: number;
  requestNo: string | null;
  submittedAt: string | null;
  currentStepCode: string | null;
  stepLabel: string;
  requesterFullName: string | null;
  requesterDepartmentName: string | null;
  brandCode: string | null;
  advanceRequestNo: string | null;
  actualTotal: number | null;
  refundToCompany: number | null;
}

/* HEAD is kept only so a request still sitting on a pre-2026-09-11 row reads
   as a name rather than a code — nothing routes there any more. */
const STEP_LABEL: Record<string, string> = {
  MANAGER: "ผู้จัดการ", ACCOUNT: "บัญชี", HEAD: "หัวหน้าบัญชี",
};

/**
 * AP-3 requests currently in the approval flow (Status='Submitted').
 * `step` optionally narrows to one step (MANAGER / ACCOUNT) for a role's queue.
 */
export async function listApprovalQueue(step?: string | null): Promise<ClrQueueRow[]> {
  const pool = await getAccPool();
  const r = pool.request().input("form", sql.NVarChar, AP3_FORM_CODE);
  let stepClause = "";
  if (step === "ACCOUNT" || step === "MANAGER") {
    r.input("step", sql.NVarChar, step);
    stepClause = "AND req.CurrentStepCode = @step";
  }
  const res = await r.query(`
    SELECT req.Id, req.RequestNo, req.SubmittedAt, req.CurrentStepCode, req.BrandCode,
           req.RequesterFullName, req.RequesterDepartmentName,
           c.AdvanceRequestNo, c.ActualTotal, c.RefundToCompany
    FROM [dbo].[AccRequest] req
    LEFT JOIN [dbo].[AccClearAdvance] c ON c.RequestId = req.Id
    WHERE req.FormCode = @form AND req.Status = 'Submitted' ${stepClause}
    ORDER BY req.SubmittedAt ASC, req.Id ASC
  `);
  return (res.recordset as Record<string, unknown>[]).map((x) => {
    const stepCode = (x.CurrentStepCode as string) ?? null;
    return {
      id: x.Id as number,
      requestNo: (x.RequestNo as string) ?? null,
      submittedAt: x.SubmittedAt ? (x.SubmittedAt as Date).toISOString() : null,
      currentStepCode: stepCode,
      stepLabel: stepCode ? (STEP_LABEL[stepCode] ?? stepCode) : "-",
      requesterFullName: (x.RequesterFullName as string) ?? null,
      requesterDepartmentName: (x.RequesterDepartmentName as string) ?? null,
      brandCode: (x.BrandCode as string) ?? null,
      advanceRequestNo: (x.AdvanceRequestNo as string) ?? null,
      actualTotal: num(x.ActualTotal),
      refundToCompany: num(x.RefundToCompany),
    };
  });
}
