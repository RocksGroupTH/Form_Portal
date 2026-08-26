import { getErpDataPool, sql } from "@/lib/db/mssql";
import { getAccPool, sql as accSql } from "@/lib/acc/pool";
import { AP4_FORM_CODE } from "@/features/reimburse/constants";

/**
 * The G/L accounts an AP-4 line may be booked to — AP-4's `รายการ` column.
 *
 * Read from `Rocks_ERP_Data.dbo.ErpAccounts`, the Business Central mirror
 * (migrations 101/102), through `getErpDataPool()`. **One physical copy, no
 * UAT twin** — a tester picks from the same chart of accounts a production
 * user does, because it is a mirror of what exists in BC rather than a choice
 * this app makes.
 *
 * Two filters, and both matter:
 *
 * - **Expense and cost-of-sales only.** A reimbursement is somebody paying an
 *   expense out of pocket; offering the whole chart would put assets, income
 *   and equity in a picker where every one of them is wrong.
 * - **Postable accounts only.** BC's chart is a tree: `600000000 ค่าใช้จ่าย`
 *   is a heading, not somewhere a journal line can land. That is in `RawJson`
 *   (`accountType`, `directPosting`) rather than in a column of its own, so it
 *   is filtered in SQL against the JSON rather than after the fact — the
 *   difference is 423 rows offered versus 277, and the 146 extra are all
 *   accounts that would fail at posting time.
 */

/** One option in the picker. */
export interface ExpenseAccount {
  /** `ErpAccounts.AccountNo` — what `AccReimburseItem.Category` stores. */
  accountNo: string;
  displayName: string;
}

/**
 * BC's own category names, as they arrive in the mirror.
 *
 * `Cost of Goods Sold` reaches us OData-escaped, spaces and all
 * (`Cost_x0020_of_x0020_Goods_x0020_Sold`) — measured against the live table,
 * not guessed. Matching the escaped form is why this is a list rather than a
 * `LIKE 'Cost%'`, which would also catch anything else beginning that way.
 */
const EXPENSE_CATEGORIES = ["Expense", "Cost_x0020_of_x0020_Goods_x0020_Sold"] as const;

/**
 * Every account this brand may book a reimbursement to, ordered by number.
 *
 * `JSON_VALUE` against `RawJson` is what separates a postable account from a
 * heading; SQL Server has supported it since 2016 and the column is the one BC
 * sync writes verbatim.
 */
export async function listExpenseAccounts(brandCode: string): Promise<ExpenseAccount[]> {
  const brand = brandCode.trim();
  if (!brand) return [];

  const pool = await getErpDataPool();
  const r = await pool
    .request()
    .input("brand", sql.NVarChar(20), brand)
    .query(
      `SELECT AccountNo, DisplayName
       FROM [dbo].[ErpAccounts]
       WHERE BrandCode = @brand
         AND AccountCategory = 'GL'
         AND IsActive = 1
         AND IsBlocked = 0
         AND BcCategory IN (${EXPENSE_CATEGORIES.map((c) => `'${c}'`).join(", ")})
         AND JSON_VALUE(RawJson, '$.accountType') = 'Posting'
         AND JSON_VALUE(RawJson, '$.directPosting') = 'true'
       ORDER BY AccountNo`,
    );

  return (r.recordset as { AccountNo: string; DisplayName: string | null }[]).map((x) => ({
    accountNo: x.AccountNo,
    displayName: x.DisplayName ?? x.AccountNo,
  }));
}

/** How many previously-used accounts lead the list handed to the reader. */
const HISTORY_LIMIT = 60;

/**
 * Every account this brand can book to, **ordered with the ones AP-4 has
 * actually used first**.
 *
 * This is what the document reader chooses from. It used to be the history
 * *alone*, which had one consequence that turned out to matter more than the
 * token cost it saved: with no history there were no candidates, so nothing
 * was ever suggested, and nothing ever entered the history to break the
 * deadlock. The reader now always has the full list, and history only decides
 * what it sees first.
 *
 * Ordering is not decoration. The list runs to a few hundred rows, and the
 * accounts this company has actually reimbursed against are far likelier than
 * the rest of the chart — putting them at the top is a cheap prior that costs
 * nothing when it is wrong, because everything else is still there below.
 *
 * History is read from the form database (`getAccPool()`) and the names from
 * the ERP mirror (`getErpDataPool()`), so the two are joined here rather than
 * in SQL — different databases, and the mirror has no UAT twin while the form
 * database does. A history read that fails costs the ordering, never the list.
 */
export async function listSuggestedExpenseAccounts(brandCode: string): Promise<ExpenseAccount[]> {
  const valid = await listExpenseAccounts(brandCode);
  if (valid.length === 0) return [];

  let used: string[] = [];
  try {
    const pool = await getAccPool();
    const r = await pool
      .request()
      .input("form", accSql.NVarChar(20), AP4_FORM_CODE)
      .query(
        `SELECT TOP (${HISTORY_LIMIT}) i.Category AS accountNo
         FROM [dbo].[AccReimburseItem] i
         JOIN [dbo].[AccRequest] r ON r.Id = i.RequestId
         WHERE r.FormCode = @form
           AND i.Category IS NOT NULL
           AND LTRIM(RTRIM(i.Category)) <> ''
         GROUP BY i.Category
         ORDER BY COUNT(*) DESC`,
      );
    used = (r.recordset as { accountNo: string }[]).map((x) => String(x.accountNo).trim());
  } catch (e) {
    // The full list is still correct without it — only the order is worse.
    console.error("[expense-accounts] history unavailable; falling back to chart order", e);
  }

  // Intersected with what is valid *now*: an account used last year may since
  // have been blocked in BC, and leading with it would put something the
  // picker itself refuses at the top of the model's list.
  const byNo = new Map(valid.map((a) => [a.accountNo, a]));
  const seen = new Set<string>();
  const out: ExpenseAccount[] = [];
  for (const no of used) {
    const hit = byNo.get(no);
    if (hit && !seen.has(no)) {
      seen.add(no);
      out.push(hit);
    }
  }
  for (const a of valid) {
    if (!seen.has(a.accountNo)) out.push(a);
  }
  return out;
}
