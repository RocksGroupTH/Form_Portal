import { getAccPool, sql } from "@/lib/acc/pool";
import { AccConflictError } from "@/lib/acc/request-errors";
import {
  computeRewardStock,
  isRewardSelectable,
  qtyReductionShortfall,
  todayYmd,
} from "@/lib/acc/reward/stock";
import type { RewardOfficer, RewardOption, RewardUpsertInput } from "@/features/reward/types";

/**
 * The AP-11 reward catalogue and the Assist AP roster.
 *
 * Neither table is dual-written, unlike the 19 shared masters in
 * `src/lib/acc/dual-write.ts`. Those are configuration; `AccReward.Qty` is
 * inventory. Mirroring it would mean a UAT test draining the production count,
 * or a production edit resetting a tester's stock — and the stock CHECK would
 * make some perfectly legitimate production edits fail because of test data.
 * Each database therefore holds its own catalogue, and a tester seeds a couple
 * of rewards in UAT by hand, which is what UAT is for.
 */

/** Date column → 'YYYY-MM-DD' with local getters. Server is Thai time; never toISOString. */
function ymd(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === "string") return v.slice(0, 10);
  const d = v as Date;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mapReward(x: Record<string, unknown>, today: string): RewardOption {
  const base = {
    qty: (x.Qty as number) ?? 0,
    lockedQty: (x.LockedQty as number) ?? 0,
    issuedQty: (x.IssuedQty as number) ?? 0,
    startDate: ymd(x.StartDate),
    expireDate: ymd(x.ExpireDate),
    isActive: !!x.IsActive,
  };
  const stock = computeRewardStock(base, today);

  return {
    id: x.Id as number,
    brandCode: x.BrandCode as string,
    code: x.Code as string,
    name: x.Name as string,

    qty: stock.qty,
    lockedQty: stock.lockedQty,
    issuedQty: stock.issuedQty,
    requestQty: stock.requestQty,
    expiredQty: stock.expiredQty,
    balanceQty: stock.balanceQty,

    unitActualValue: num(x.UnitActualValue),
    unitBookValue: num(x.UnitBookValue),
    totalActualValue: num(x.TotalActualValue),
    totalBookValue: num(x.TotalBookValue),

    startDate: base.startDate,
    expireDate: base.expireDate,
    poNo: (x.PoNo as string) ?? null,
    pinNo: (x.PinNo as string) ?? null,
    prepaymentNo: (x.PrepaymentNo as string) ?? null,

    isActive: base.isActive,
    sortOrder: (x.SortOrder as number) ?? 0,
    selectable: isRewardSelectable(base, today),
  };
}

const REWARD_COLUMNS = `Id, BrandCode, Code, Name, Qty, LockedQty, IssuedQty,
  UnitActualValue, UnitBookValue, TotalActualValue, TotalBookValue,
  StartDate, ExpireDate, PoNo, PinNo, PrepaymentNo, IsActive, SortOrder`;

/**
 * The catalogue.
 *
 * `selectableOnly` is what the form's card list asks for; the settings page and
 * the report ask for everything, because a closed or exhausted reward still has
 * to be visible to whoever manages it.
 */
export async function listRewards(opts: {
  brandCode?: string | null;
  selectableOnly?: boolean;
} = {}): Promise<RewardOption[]> {
  const pool = await getAccPool();
  const req = pool.request();
  const where: string[] = [];

  if (opts.brandCode) {
    req.input("brand", sql.NVarChar, opts.brandCode);
    where.push("BrandCode = @brand");
  }

  const r = await req.query(
    `SELECT ${REWARD_COLUMNS} FROM [dbo].[AccReward]
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY SortOrder, Name`,
  );

  const today = todayYmd();
  const rows = r.recordset.map((x: Record<string, unknown>) => mapReward(x, today));
  return opts.selectableOnly ? rows.filter((row) => row.selectable) : rows;
}

/** One reward by id, or null. Used by the draft save and the submit path. */
export async function getReward(id: number): Promise<RewardOption | null> {
  const pool = await getAccPool();
  const r = await pool
    .request()
    .input("id", sql.Int, id)
    .query(`SELECT ${REWARD_COLUMNS} FROM [dbo].[AccReward] WHERE Id = @id`);
  if (!r.recordset.length) return null;
  return mapReward(r.recordset[0] as Record<string, unknown>, todayYmd());
}

function assertRewardInput(input: RewardUpsertInput): void {
  if (!input.brandCode?.trim()) throw new Error("กรุณาเลือกบริษัท (Brand)");
  if (!input.code?.trim()) throw new Error("กรุณากรอกรหัสของรางวัล (Code)");
  if (!input.name?.trim()) throw new Error("กรุณากรอกชื่อของรางวัล (Name)");
  const qty = Number(input.qty);
  if (!Number.isInteger(qty) || qty < 0) throw new Error("จำนวน (Qty) ต้องเป็นจำนวนเต็มไม่ติดลบ");
  if (input.startDate && input.expireDate && input.expireDate < input.startDate) {
    throw new Error("วันหมดอายุต้องไม่ก่อนวันเริ่ม");
  }
}

/**
 * Create or update a reward.
 *
 * The counters are never in the statement — an admin types `Qty` and the value
 * fields, and `LockedQty`/`IssuedQty` belong to the request lifecycle alone. On
 * an update, a `Qty` below what is already committed is refused here with a 409
 * naming the shortfall rather than left to surface as a raw 547 from
 * `CK_AccReward_Stock`.
 */
export async function upsertReward(
  input: RewardUpsertInput,
  userId: number,
): Promise<RewardOption> {
  assertRewardInput(input);
  const pool = await getAccPool();

  if (input.id) {
    const existing = await getReward(input.id);
    if (!existing) throw new Error("ไม่พบของรางวัลนี้");

    const shortfall = qtyReductionShortfall(existing, input.qty);
    if (shortfall > 0) {
      throw new AccConflictError(
        `ลดจำนวนไม่ได้ — มีการล็อกหรือจ่ายไปแล้ว ${existing.requestQty} ชิ้น ` +
          `(ตั้งได้ต่ำสุด ${existing.requestQty})`,
      );
    }
  }

  const req = pool
    .request()
    .input("id", sql.Int, input.id ?? null)
    .input("brand", sql.NVarChar(20), input.brandCode.trim())
    .input("code", sql.NVarChar(50), input.code.trim())
    .input("name", sql.NVarChar(200), input.name.trim())
    .input("qty", sql.Int, Math.trunc(Number(input.qty)))
    .input("unitActual", sql.Decimal(18, 2), input.unitActualValue ?? null)
    .input("unitBook", sql.Decimal(18, 2), input.unitBookValue ?? null)
    .input("startDate", sql.Date, input.startDate || null)
    .input("expireDate", sql.Date, input.expireDate || null)
    .input("po", sql.NVarChar(100), input.poNo?.trim() || null)
    .input("pin", sql.NVarChar(100), input.pinNo?.trim() || null)
    .input("prepay", sql.NVarChar(100), input.prepaymentNo?.trim() || null)
    .input("active", sql.Bit, input.isActive ? 1 : 0)
    .input("sort", sql.Int, input.sortOrder ?? 0)
    .input("uid", sql.Int, userId);

  let id = input.id ?? 0;
  try {
    if (input.id) {
      await req.query(
        `UPDATE [dbo].[AccReward]
            SET BrandCode=@brand, Code=@code, Name=@name, Qty=@qty,
                UnitActualValue=@unitActual, UnitBookValue=@unitBook,
                StartDate=@startDate, ExpireDate=@expireDate,
                PoNo=@po, PinNo=@pin, PrepaymentNo=@prepay,
                IsActive=@active, SortOrder=@sort,
                UpdatedBy=@uid, UpdatedAt=SYSDATETIME()
          WHERE Id=@id`,
      );
    } else {
      const ins = await req.query(
        `INSERT INTO [dbo].[AccReward]
           (BrandCode, Code, Name, Qty, UnitActualValue, UnitBookValue,
            StartDate, ExpireDate, PoNo, PinNo, PrepaymentNo, IsActive, SortOrder,
            CreatedBy, UpdatedBy)
         OUTPUT inserted.Id AS Id
         VALUES (@brand, @code, @name, @qty, @unitActual, @unitBook,
                 @startDate, @expireDate, @po, @pin, @prepay, @active, @sort,
                 @uid, @uid)`,
      );
      id = ins.recordset[0].Id as number;
    }
  } catch (e) {
    // UX_AccReward_Brand_Code — a duplicate code within the same brand.
    if (e instanceof Error && /UX_AccReward_Brand_Code|duplicate key/i.test(e.message)) {
      throw new AccConflictError("รหัสของรางวัลนี้มีอยู่แล้วในบริษัทเดียวกัน");
    }
    throw e;
  }

  const saved = await getReward(id);
  if (!saved) throw new Error("บันทึกไม่สำเร็จ");
  return saved;
}

/**
 * Open or close a reward.
 *
 * Closing is the nearest thing to deletion AP-11 offers. There is no hard
 * delete: `AccRewardRequest` keeps a value snapshot rather than a foreign key,
 * so a removed row would not break history — but it would erase the audit
 * question "what was this reward when we handed it out", and the counters are
 * the only record of how much stock ever existed.
 */
export async function setRewardActive(id: number, isActive: boolean, userId: number): Promise<void> {
  const pool = await getAccPool();
  await pool
    .request()
    .input("id", sql.Int, id)
    .input("active", sql.Bit, isActive ? 1 : 0)
    .input("uid", sql.Int, userId)
    .query(
      `UPDATE [dbo].[AccReward]
          SET IsActive=@active, UpdatedBy=@uid, UpdatedAt=SYSDATETIME()
        WHERE Id=@id`,
    );
}

/* ── Assist AP roster ── */

function mapOfficer(x: Record<string, unknown>): RewardOfficer {
  return {
    id: x.Id as number,
    staffId: (x.StaffId as number) ?? null,
    email: x.Email as string,
    displayName: (x.DisplayName as string) ?? null,
    photoUrl: (x.PhotoUrl as string) ?? null,
    isActive: !!x.IsActive,
  };
}

export async function listOfficers(activeOnly = false): Promise<RewardOfficer[]> {
  const pool = await getAccPool();
  const r = await pool.request().query(
    `SELECT Id, StaffId, Email, DisplayName, PhotoUrl, IsActive
       FROM [dbo].[AccRewardOfficer]
      ${activeOnly ? "WHERE IsActive = 1" : ""}
      ORDER BY DisplayName, Email`,
  );
  return r.recordset.map((x: Record<string, unknown>) => mapOfficer(x));
}

/**
 * Add an officer, or reactivate one who was removed before.
 *
 * Reactivation rather than insert, because removal is a soft delete and
 * `UX_AccRewardOfficer_Email` would reject the second insert — the same shape
 * `UatTester` uses.
 */
export async function addOrReactivateOfficer(
  input: { email: string; staffId?: number | null; displayName?: string | null; photoUrl?: string | null },
  userId: number,
): Promise<RewardOfficer> {
  const email = input.email?.trim();
  if (!email) throw new Error("กรุณาระบุอีเมล");

  const pool = await getAccPool();
  const r = await pool
    .request()
    .input("email", sql.NVarChar(200), email)
    .input("staff", sql.Int, input.staffId ?? null)
    .input("name", sql.NVarChar(200), input.displayName?.trim() || null)
    .input("photo", sql.NVarChar(sql.MAX), input.photoUrl ?? null)
    .input("uid", sql.Int, userId)
    .query(
      `MERGE [dbo].[AccRewardOfficer] WITH (HOLDLOCK) AS t
       USING (SELECT @email AS Email) AS s ON LOWER(t.Email) = LOWER(s.Email)
       WHEN MATCHED THEN UPDATE SET
         IsActive = 1,
         StaffId = COALESCE(@staff, t.StaffId),
         DisplayName = COALESCE(@name, t.DisplayName),
         PhotoUrl = COALESCE(@photo, t.PhotoUrl),
         UpdatedAt = SYSDATETIME()
       WHEN NOT MATCHED THEN
         INSERT (StaffId, Email, DisplayName, PhotoUrl, IsActive, CreatedBy)
         VALUES (@staff, @email, @name, @photo, 1, @uid)
       OUTPUT inserted.Id, inserted.StaffId, inserted.Email,
              inserted.DisplayName, inserted.PhotoUrl, inserted.IsActive;`,
    );
  return mapOfficer(r.recordset[0] as Record<string, unknown>);
}

/** Soft delete, so the audit trail keeps naming whoever actioned past requests. */
export async function removeOfficer(id: number): Promise<void> {
  const pool = await getAccPool();
  await pool
    .request()
    .input("id", sql.Int, id)
    .query(`UPDATE [dbo].[AccRewardOfficer] SET IsActive=0, UpdatedAt=SYSDATETIME() WHERE Id=@id`);
}
