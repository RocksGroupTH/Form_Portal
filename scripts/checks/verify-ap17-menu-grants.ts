/* eslint-disable no-console */
/**
 * Who can actually work each part of AP-17 — and whether anything is still
 * stored where it used to be.
 *
 * Read-only, both form databases.
 *
 * AP-17's menu grants are `CanQueue` / `CanAccount` / `CanReport` on the
 * `AccBookingApprover` row (migration 124), and **ACC Portal reads and writes
 * those same rows**. Between 2026-08-27 and 2026-09-24 this application kept a
 * second answer of its own as `AccBookingApproverTab` rows keyed
 * `bookingQueue` / `accountApproval`, and the two disagreed badly: measured
 * 2026-09-24, the columns said six people could work the booking queue and six
 * the sign-off while our rows held two in total. Worse, ACC Portal's own tab
 * writer replaces an approver's whole tab set through a filter that knows
 * settings tabs alone, so every menu row this app stored was deleted the next
 * time an admin ticked a settings tab over there — which, once the tick became
 * real authority, silently revoked approval rights.
 *
 * This is what to run when somebody reports "I ticked it and it did nothing",
 * or when the รออนุมัติโดย card names fewer people than the grid shows.
 *
 * tsx does not auto-load .env.local or resolve the "@/" alias, so run it as
 *   npx tsx --env-file=.env.local scripts/checks/verify-ap17-menu-grants.ts
 */
import { getProductionFormPool, getUatFormPool, closeDatabasePools } from "../../src/lib/db/mssql";
import {
  BOOKING_AREAS,
  BOOKING_AREA_COLUMN,
} from "../../src/lib/acc/travel-booking/booking-areas";
import type { ConnectionPool } from "mssql";

/** Rows still sitting under the retired vocabulary. They grant nothing. */
const RETIRED_KEYS = ["bookingQueue", "accountApproval"];

let problems = 0;

async function report(label: string, pool: ConnectionPool): Promise<void> {
  console.log(`\n================ ${label} ================`);

  const columns = BOOKING_AREAS.map((a) => BOOKING_AREA_COLUMN[a.key]);
  const rows = (
    await pool.request().query<Record<string, string | number | boolean>>(
      `SELECT Id, StaffId, DisplayName, Email, IsActive, ${columns.join(", ")}
         FROM [dbo].[AccBookingApprover] ORDER BY DisplayName, Email`,
    )
  ).recordset;

  const brands = (
    await pool
      .request()
      .query<{ ApproverId: number; BrandCode: string }>(
        `SELECT ApproverId, BrandCode FROM [dbo].[AccBookingApproverBrand]`,
      )
  ).recordset;
  const brandOf = new Map<number, string[]>();
  for (const b of brands) {
    const l = brandOf.get(b.ApproverId) ?? [];
    l.push(String(b.BrandCode ?? "").trim().toUpperCase());
    brandOf.set(b.ApproverId, l);
  }

  console.log(`roster: ${rows.length} rows, ${rows.filter((r) => r.IsActive).length} active\n`);
  for (const r of rows) {
    const name = String(r.DisplayName ?? "").trim() || String(r.Email);
    const held = BOOKING_AREAS.filter((a) => !!r[BOOKING_AREA_COLUMN[a.key]]).map((a) => a.key);
    const bs = brandOf.get(Number(r.Id)) ?? [];
    console.log(
      `  ${r.IsActive ? "on " : "OFF"} ${name.padEnd(30)}` +
        `menus=[${held.join(",") || "NONE"}]`.padEnd(32) +
        `brands=[${bs.join(",") || "ทุกแบรนด์"}]`,
    );
  }

  /* Who can actually act on each step today — the same answer the รออนุมัติโดย
     card draws and `requireBookingMenu` enforces. Admins pass both without a
     row and are not counted here; see that module. */
  console.log("");
  for (const area of BOOKING_AREAS) {
    const who = rows
      .filter((r) => r.IsActive && !!r[BOOKING_AREA_COLUMN[area.key]])
      .map((r) => String(r.DisplayName ?? "").trim() || String(r.Email));
    console.log(`  ${area.label.padEnd(14)} ${who.length}: ${who.join(", ") || "(ไม่มีใคร)"}`);
    if (who.length === 0) {
      // Not a failure on its own — an admin still passes — but it is the state
      // that leaves AP-17 stuck with its queue visible and its buttons at 403.
      console.log(`     ^ nobody on the roster holds ${area.key}; only admins can work it`);
      problems++;
    }
  }

  /* Leftovers from the retired vocabulary. Inert — the reader filters them and
     the next tab save deletes them — but their presence dates a database. */
  const stale = (
    await pool
      .request()
      .query<{ ApproverId: number; TabKey: string }>(
        `SELECT ApproverId, TabKey FROM [dbo].[AccBookingApproverTab]
          WHERE TabKey IN (${RETIRED_KEYS.map((k) => `'${k}'`).join(", ")})`,
      )
  ).recordset;
  if (stale.length > 0) {
    console.log(
      `\n  note: ${stale.length} row(s) still carry the retired menu keys ` +
        `(${RETIRED_KEYS.join(", ")}). They grant nothing — the reader drops them and the ` +
        "next settings-tab save for that person removes them.",
    );
  }
}

async function main(): Promise<void> {
  for (const [label, get] of [
    ["Rocks_Portal_Form (PRO)", getProductionFormPool],
    ["Rocks_Portal_Form_UAT", getUatFormPool],
  ] as const) {
    try {
      await report(label, await get());
    } catch (e) {
      console.log(`${label} FAILED:`, e instanceof Error ? e.message : e);
      problems++;
    }
  }
  console.log(
    problems === 0
      ? "\nPASS — every AP-17 menu has at least one non-admin who can work it."
      : `\n${problems} thing(s) worth a look — read the lines marked ^ above.`,
  );
  await closeDatabasePools();
}

void main();
