/**
 * Pure shaping rules for TeamMember rows — no database, no `@/env`, no request
 * scope, no I/O of any kind.
 *
 * They sit beside `service.ts` rather than inside it so `service.test.ts` can
 * exercise them directly: importing `service.ts` would pull in
 * `@/lib/db/mssql` → `@/env`, whose schema validation throws outside a Next
 * runtime and would make the whole test file unrunnable. Every function here is
 * a total function of its arguments.
 */

import { normalizeRole } from "@/lib/roles";
import type { Role } from "@/lib/types";

/**
 * Fallback avatar colour. It is the `Color` column default, restated here so a
 * row that predates the default — or one read through a projection that missed
 * it — still renders as something other than a blank swatch.
 */
export const DEFAULT_MEMBER_COLOR = "#6c757d";

/** One person, as the rest of the app sees them. */
export interface TeamMemberRow {
  id: number;
  fullName: string;
  nickname: string;
  email: string;
  appRole: string;
  position: string | null;
  color: string;
  photo: string | null;
  managerId: number | null;
  isActive: boolean;
}

/** The same row as MSSQL hands it back: PascalCase columns, `bit` as boolean. */
export interface RawTeamMemberRow {
  Id: number;
  FullName: string | null;
  Nickname: string | null;
  Email: string | null;
  AppRole: string | null;
  Position: string | null;
  Color: string | null;
  Photo: string | null;
  ManagerId: number | null;
  IsActive: boolean | number | null;
}

/**
 * The form an email is compared in.
 *
 * Every lookup normalises in TypeScript and compares against
 * `LOWER(LTRIM(RTRIM(Email)))` in SQL, so a login id that differs from the
 * stored address only by case or padding still finds its row. Doing the
 * normalisation here rather than in each query keeps the rule in one testable
 * place — an address that normalises to "" is not a lookup key and callers
 * must refuse it rather than matching the first blank row.
 */
export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/** DB row → app row. Column defaults are re-applied for anything null. */
export function mapTeamMemberRow(raw: RawTeamMemberRow): TeamMemberRow {
  return {
    id: Number(raw.Id),
    fullName: (raw.FullName ?? "").trim(),
    nickname: (raw.Nickname ?? "").trim(),
    email: (raw.Email ?? "").trim(),
    // Not run through normalizeRole(): that maps anything unrecognised to
    // "Staff", and a data layer should hand back what the row says. Callers
    // that need a Role (auth, the role gates) normalise at the point of use.
    appRole: (raw.AppRole ?? "").trim(),
    position: raw.Position ?? null,
    color: (raw.Color ?? "").trim() || DEFAULT_MEMBER_COLOR,
    photo: raw.Photo ?? null,
    managerId: raw.ManagerId == null ? null : Number(raw.ManagerId),
    // Drivers have returned bit as 0/1 as well as false/true; treat both.
    isActive: raw.IsActive === true || raw.IsActive === 1,
  };
}

/**
 * True only for a role spelled exactly as the `CK_TeamMember_AppRole` check
 * constraint expects.
 *
 * Deliberately stricter than `normalizeRole`, and expressed through it so the
 * four strings are not restated: "staff" is a value a caller guessed at, and
 * quietly accepting it would let the API grant a role the request never asked
 * for in those words. Anything unrecognised is rejected outright rather than
 * being coerced down to "Staff", so a typo in an admin request is an error the
 * caller sees instead of a silent demotion.
 */
export function isValidRole(value: string | null | undefined): value is Role {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return false;
  return normalizeRole(trimmed) === trimmed;
}

/**
 * The nickname to store for a newly added person.
 *
 * The directory modal usually sends none, and a blank nickname shows up as an
 * empty label in the navbar and on every approval card, so the first word of
 * the full name stands in until someone curates one.
 */
export function resolveNickname(fullName: string, nickname?: string | null): string {
  const given = (nickname ?? "").trim();
  if (given) return given;
  return fullName.trim().split(/\s+/)[0] ?? "";
}
