import { getAccPool, sql } from "@/lib/acc/pool";
import { writeBothPools } from "@/lib/acc/dual-write";
import { AP1_FORM_CODE } from "@/features/accounting/constants";
import { getAllowedBrands } from "@/lib/acc/brand-options";
import {
  defaultsOnly,
  perFormOrderBy,
  perFormPredicate,
  perFormWriteMatch,
  pickAllForForm,
} from "@/lib/acc/per-form-config";

async function assertClaimBrandAllowed(brandCode: string): Promise<void> {
  const allowed = await getAllowedBrands(AP1_FORM_CODE);
  const ok = allowed.some(
    (b) => b.brandCode.toUpperCase() === brandCode.toUpperCase(),
  );
  if (!ok) throw new Error("แบรนด์นี้ไม่ได้เปิดใช้ใน AP-1");
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
  /** `null` is the default, which answers every form. */
  formCode: string | null;
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
    // Never absent — see the note in brand-erp-interface-map-service.
    formCode: (x.FormCode as string | null) ?? null,
  };
  if (kind === "gl") {
    row.erpDescription = (x.ErpDescription as string) ?? null;
  }
  return row;
}

/**
 * With `formCode`, this form's G/L or bank accounts; without, the defaults
 * alone — which is what the settings editor edits.
 *
 * A brand keeps several accounts, so the pick is per `(BrandCode, AccountNo)`:
 * the table's unique index minus `FormCode`. A form overriding one account
 * still sees the defaults it did not override.
 */
export async function listBrandAccounts(
  kind: BrandAccountKind,
  brandCode?: string | null,
  formCode?: string,
): Promise<BrandAccountRow[]> {
  const pool = await getAccPool();
  const table = TABLE[kind];
  const req = pool.request();
  const conditions: string[] = [];
  if (brandCode) {
    req.input("brand", sql.NVarChar, brandCode);
    conditions.push("BrandCode = @brand");
  }
  if (formCode) {
    req.input("formCode", sql.NVarChar(20), formCode);
    conditions.push(perFormPredicate());
  } else {
    conditions.push("FormCode IS NULL");
  }
  const r = await req.query(`
    SELECT Id, BrandCode, AccountNo, DisplayName${kind === "gl" ? ", ErpDescription" : ""}, IsActive, SortOrder, FormCode
    FROM [dbo].[${table}]
    WHERE ${conditions.join(" AND ")}
    ORDER BY BrandCode, SortOrder, AccountNo, ${perFormOrderBy()}
  `);
  const rows = r.recordset.map((x) => mapRow(kind, x as Record<string, unknown>));
  return formCode
    ? pickAllForForm(
        rows,
        formCode,
        // JSON rather than a concatenation: no separator character can appear
        // inside a brand code or an account number and merge two distinct keys.
        (row) => JSON.stringify([row.brandCode.toUpperCase(), row.accountNo]),
      )
    : defaultsOnly(rows);
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
  },
  userId: number,
): Promise<void> {
  const accountNo = input.accountNo.trim();
  const brandCode = input.brandCode.trim().toUpperCase();
  if (!brandCode) throw new Error("กรุณาเลือกแบรนด์");
  await assertClaimBrandAllowed(brandCode);
  if (!accountNo) throw new Error("กรุณาระบุเลขบัญชี");

  const pool = await getAccPool();
  const table = TABLE[kind];
  // Resolve the target row once, against production, so both databases update
  // the same id rather than each picking its own "first row for this brand".
  // Bounded to the default: the editor has no form selector, and an unbounded
  // probe could land on an override and rewrite another form's account.
  let rowId = input.id;
  if (rowId == null) {
    const existing = await pool
      .request()
      .input("brand", sql.NVarChar, brandCode).query(`
        SELECT TOP 1 Id FROM [dbo].[${table}]
        WHERE BrandCode = @brand AND ${perFormWriteMatch(null)}
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
    }

    if (rowId) {
      req.input("id", sql.Int, rowId);
      await req.query(`
      UPDATE [dbo].[${table}]
      SET BrandCode = @brand,
          AccountNo = @accountNo,
          DisplayName = @displayName,
          ${kind === "gl" ? "ErpDescription = @erpDescription," : ""}
          IsActive = @active,
          SortOrder = @sort,
          UpdatedAt = SYSDATETIME()
      -- Bounded to the default as well as the id. The row id arrives from the
      -- request body, and this editor only ever edits the default, so an id
      -- naming an override must not be updatable through it.
      WHERE Id = @id AND ${perFormWriteMatch(null)}
    `);
    } else {
      await req.query(`
      INSERT INTO [dbo].[${table}]
        (BrandCode, AccountNo, DisplayName${kind === "gl" ? ", ErpDescription" : ""}, IsActive, SortOrder, FormCode, CreatedBy)
      VALUES (@brand, @accountNo, @displayName${kind === "gl" ? ", @erpDescription" : ""}, @active, @sort, NULL, @user)
    `);
    }
  });
}
