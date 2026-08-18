import { getAccPool, sql } from "@/lib/acc/pool";
import { writeBothPools } from "@/lib/acc/dual-write";
import { AP1_FORM_CODE } from "@/features/accounting/constants";
import { getAllowedBrands } from "@/lib/acc/brand-options";

async function assertClaimBrandAllowed(
  brandCode: string,
  formCode: string = AP1_FORM_CODE,
): Promise<void> {
  const allowed = await getAllowedBrands(formCode);
  const ok = allowed.some(
    (b) => b.brandCode.toUpperCase() === brandCode.toUpperCase(),
  );
  if (!ok) throw new Error(`แบรนด์นี้ไม่ได้เปิดใช้ใน ${formCode}`);
}

export type BrandAccountKind = "gl" | "bank";

export interface BrandAccountRow {
  id: number;
  brandCode: string;
  accountNo: string;
  displayName: string | null;
  erpDescription?: string | null;
  isActive: boolean;
  sortOrder: number;
}

const TABLE: Record<BrandAccountKind, string> = {
  gl: "AccBrandGlAccount",
  bank: "AccBrandBankAccount",
};

function mapRow(
  kind: BrandAccountKind,
  x: Record<string, unknown>,
): BrandAccountRow {
  const row: BrandAccountRow = {
    id: x.Id as number,
    brandCode: x.BrandCode as string,
    accountNo: x.AccountNo as string,
    displayName: (x.DisplayName as string) ?? null,
    isActive: !!x.IsActive,
    sortOrder: x.SortOrder as number,
  };
  if (kind === "gl") {
    row.erpDescription = (x.ErpDescription as string) ?? null;
  }
  return row;
}

export async function listBrandAccounts(
  kind: BrandAccountKind,
  brandCode?: string | null,
  formCode?: string | null,
): Promise<BrandAccountRow[]> {
  const pool = await getAccPool();
  const table = TABLE[kind];
  const req = pool.request();
  const conds: string[] = [];
  if (brandCode) {
    req.input("brand", sql.NVarChar, brandCode);
    conds.push("BrandCode = @brand");
  }
  // FormCode lives only on the G/L table (per-form config). Bank accounts are
  // per-brand and shared across forms, so they are never filtered by form.
  if (kind === "gl" && formCode) {
    req.input("formCode", sql.NVarChar, formCode);
    conds.push("FormCode = @formCode");
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const r = await req.query(`
    SELECT Id, BrandCode, AccountNo, DisplayName${kind === "gl" ? ", ErpDescription" : ""}, IsActive, SortOrder
    FROM [dbo].[${table}]
    ${where}
    ORDER BY BrandCode, SortOrder, AccountNo
  `);
  return r.recordset.map((x) => mapRow(kind, x as Record<string, unknown>));
}

export async function upsertBrandAccount(
  kind: BrandAccountKind,
  input: {
    id?: number;
    brandCode: string;
    accountNo: string;
    displayName?: string | null;
    erpDescription?: string | null;
    isActive?: boolean;
    sortOrder?: number;
    /** G/L only — which form this account belongs to. Defaults to AP-1. */
    formCode?: string;
  },
  userId: number,
): Promise<void> {
  const accountNo = input.accountNo.trim();
  const brandCode = input.brandCode.trim().toUpperCase();
  if (!brandCode) throw new Error("กรุณาเลือกแบรนด์");
  // FormCode scopes G/L config per form; bank accounts are shared per-brand.
  const formCode = kind === "gl" ? (input.formCode?.trim() || AP1_FORM_CODE) : null;
  await assertClaimBrandAllowed(brandCode, formCode ?? AP1_FORM_CODE);
  if (!accountNo) throw new Error("กรุณาระบุเลขบัญชี");

  const pool = await getAccPool();
  const table = TABLE[kind];
  // Resolve the target row once, against production, so both databases update
  // the same id rather than each picking its own "first row for this brand".
  // For G/L the row is scoped by form, so AP-2 never grabs AP-1's row.
  let rowId = input.id;
  if (rowId == null) {
    const findReq = pool.request().input("brand", sql.NVarChar, brandCode);
    if (formCode) findReq.input("formCode", sql.NVarChar, formCode);
    const existing = await findReq.query(`
        SELECT TOP 1 Id FROM [dbo].[${table}]
        WHERE BrandCode = @brand${formCode ? " AND FormCode = @formCode" : ""}
        ORDER BY SortOrder, Id
      `);
    rowId = (existing.recordset[0] as { Id: number } | undefined)?.Id;
  }

  await writeBothPools(async (tx) => {
    const req = tx
      .request()
      .input("brand", sql.NVarChar, brandCode)
      .input("accountNo", sql.NVarChar, accountNo)
      .input("displayName", sql.NVarChar, input.displayName?.trim() || null)
      .input("active", sql.Bit, input.isActive === false ? 0 : 1)
      .input("sort", sql.Int, input.sortOrder ?? 0)
      .input("user", sql.Int, userId || null);

    if (kind === "gl") {
      req.input(
        "erpDescription",
        sql.NVarChar,
        input.erpDescription?.trim() || null,
      );
      req.input("formCode", sql.NVarChar, formCode);
    }

    if (rowId) {
      req.input("id", sql.Int, rowId);
      await req.query(`
      UPDATE [dbo].[${table}]
      SET BrandCode = @brand,
          AccountNo = @accountNo,
          DisplayName = @displayName,
          ${kind === "gl" ? "ErpDescription = @erpDescription, FormCode = @formCode," : ""}
          IsActive = @active,
          SortOrder = @sort,
          UpdatedAt = SYSDATETIME()
      WHERE Id = @id
    `);
    } else {
      await req.query(`
      INSERT INTO [dbo].[${table}]
        (BrandCode, AccountNo, DisplayName${kind === "gl" ? ", ErpDescription, FormCode" : ""}, IsActive, SortOrder, CreatedBy)
      VALUES (@brand, @accountNo, @displayName${kind === "gl" ? ", @erpDescription, @formCode" : ""}, @active, @sort, @user)
    `);
    }
  });
}
