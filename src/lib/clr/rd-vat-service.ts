import { getAccPool, sql } from "@/lib/acc/pool";
import {
  RD_VAT_ENDPOINT,
  RD_VAT_SOAP_ACTION,
  buildRdVatRequest,
  parseRdVatResponse,
  type RdVatRegistrant,
} from "./rd-vat-core";

export interface VatLookup {
  taxId: string;
  /** Null when the RD holds no VAT registration for this number. */
  registrant: RdVatRegistrant | null;
  /** True when the answer came from our own table rather than the RD. */
  cached: boolean;
}

/** How long a stored answer stands before we ask again. */
const CACHE_DAYS = 90;

/**
 * What the Revenue Department says about a tax id, from our table when we have
 * it and from the RD when we do not.
 *
 * A number that is not on the VAT register is stored as such. That is the
 * expensive question to keep re-asking — a small seller will never be there, and
 * without recording the "no" every upload would ask the RD about them again.
 *
 * The RD being unreachable is not the same as an unregistered seller, so a
 * failed call returns null and stores nothing: the next attempt should ask
 * again, not inherit a silence.
 */
export async function lookupVatRegistrant(taxId: string): Promise<VatLookup | null> {
  const tin = (taxId ?? "").replace(/\D/g, "");
  if (tin.length !== 13) return null;

  const cached = await readCache(tin);
  if (cached) return cached;

  let xml: string;
  try {
    const res = await fetch(RD_VAT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: RD_VAT_SOAP_ACTION,
      },
      body: buildRdVatRequest(tin),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    xml = await res.text();
  } catch {
    // Unreachable, slow, or refused. Nothing is written: an outage must not
    // become a stored "not registered" that outlives it.
    return null;
  }

  const registrant = parseRdVatResponse(xml);
  await writeCache(tin, registrant);
  return { taxId: tin, registrant, cached: false };
}

async function readCache(tin: string): Promise<VatLookup | null> {
  const pool = await getAccPool();
  const r = await pool
    .request()
    .input("tin", sql.NVarChar, tin)
    .input("days", sql.Int, CACHE_DAYS)
    .query(`
      SELECT TaxId, NotRegistered, TitleName, [Name], BranchNumber, BranchCode,
             VatRegisteredOn, [Address]
      FROM [dbo].[AccVatRegistrant]
      WHERE TaxId = @tin AND CheckedAt > DATEADD(day, -@days, SYSDATETIME())
    `);
  const row = (r.recordset as Record<string, unknown>[])[0];
  if (!row) return null;

  if (row.NotRegistered === true || row.NotRegistered === 1) {
    return { taxId: tin, registrant: null, cached: true };
  }
  return {
    taxId: tin,
    cached: true,
    registrant: {
      nid: String(row.TaxId ?? tin),
      titleName: (row.TitleName as string) ?? null,
      name: (row.Name as string) ?? null,
      branchNumber: row.BranchNumber == null ? null : Number(row.BranchNumber),
      branchCode: (row.BranchCode as string) ?? null,
      vatRegisteredOn:
        row.VatRegisteredOn instanceof Date
          ? row.VatRegisteredOn.toISOString().slice(0, 10)
          : ((row.VatRegisteredOn as string) ?? null),
      address: (row.Address as string) ?? null,
    },
  };
}

async function writeCache(tin: string, r: RdVatRegistrant | null): Promise<void> {
  const pool = await getAccPool();
  await pool
    .request()
    .input("tin", sql.NVarChar, tin)
    .input("notReg", sql.Bit, r ? 0 : 1)
    .input("title", sql.NVarChar, r?.titleName ?? null)
    .input("name", sql.NVarChar, r?.name ?? null)
    .input("brNo", sql.Int, r?.branchNumber ?? null)
    .input("brCode", sql.NVarChar, r?.branchCode ?? null)
    .input("regOn", sql.Date, r?.vatRegisteredOn || null)
    .input("addr", sql.NVarChar, r?.address ?? null)
    .query(`
      MERGE [dbo].[AccVatRegistrant] AS t
      USING (SELECT @tin AS TaxId) AS s ON t.TaxId = s.TaxId
      WHEN MATCHED THEN UPDATE SET
        NotRegistered = @notReg, TitleName = @title, [Name] = @name,
        BranchNumber = @brNo, BranchCode = @brCode, VatRegisteredOn = @regOn,
        [Address] = @addr, CheckedAt = SYSDATETIME()
      WHEN NOT MATCHED THEN
        INSERT (TaxId, NotRegistered, TitleName, [Name], BranchNumber, BranchCode, VatRegisteredOn, [Address], CheckedAt)
        VALUES (@tin, @notReg, @title, @name, @brNo, @brCode, @regOn, @addr, SYSDATETIME());
    `);
}
