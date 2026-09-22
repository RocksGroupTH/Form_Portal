/**
 * One reader for AP-2's and AP-3's approver rosters, shared by the three
 * components that draw them.
 *
 * **Why it exists at all: SWR caches by KEY, not by fetcher.** Since
 * 2026-09-22 the สิทธิ์เข้าถึง grid carries an approver column group beside the
 * settings-tab and menu ticks, and each form's approver panel still sits below
 * it on the same tab — two controls over one `IsActive` flag, on screen
 * together. Left with their own `useState` + `fetch`, a tick in one left the
 * other showing the old answer until somebody reloaded the page: two checkboxes
 * for one fact, one of them lying. Pointing both at `useSWR(endpoint,
 * fetchApproverRoster)` makes them one cache entry, so either control's
 * `mutate()` revalidates both.
 *
 * That only holds while every consumer uses the **same** fetcher. Two
 * components sharing a key with different fetchers would each overwrite the
 * other's cached shape, which is worse than the staleness it was meant to fix —
 * so the normalised row below is deliberately a superset of what all three
 * screens need, rather than each one parsing the endpoint its own way.
 *
 * **The two endpoints answer different field names**, which is the other half
 * of the normalising: AP-2 returns `approverRole`, AP-3 returns `role`. Both
 * are `requireRole(["IT Admin", "System Admin"])`, the same gate the
 * สิทธิ์เข้าถึง route carries, so reading one from the grid opens no new door.
 *
 * This module imports nothing at runtime — `fetch` is global and `AdvClrForm`
 * is a type — so it can be reached from a client component without dragging
 * `@/env` into the browser bundle, the break CLAUDE.md records for
 * `api-keys/codes.ts`.
 */

import { advClrApproverEndpoint } from "@/lib/adv/approver-columns";
import type { AdvClrForm } from "@/lib/adv/settings-tabs";

/** One approver row, with both endpoints' spellings resolved to one shape. */
export interface ApproverRosterRow {
  id: number;
  /** `AccAdvanceApprover.ApproverRole` or `AccClearAdvanceApprover.Role`. */
  role: string;
  email: string;
  displayName: string | null;
  staffId: number | null;
  isActive: boolean;
  photoUrl: string | null;
}

export interface ApproverRosterResult {
  rows: ApproverRosterRow[];
  /**
   * The read itself succeeded. **`false` must never render as an empty
   * roster** — on this grid that would report "nobody approves anything" when
   * the truth is "the roster could not be read", and the commissioning line
   * below the table is drawn from exactly this count.
   */
  ok: boolean;
  /** A 403, so a caller can render the friendly state instead of an error. */
  forbidden: boolean;
}

function normalise(raw: unknown): ApproverRosterRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = Number(r.id);
  const email = typeof r.email === "string" ? r.email : "";
  // Either endpoint's spelling; see the module docblock.
  const role = typeof r.approverRole === "string"
    ? r.approverRole
    : typeof r.role === "string"
      ? r.role
      : "";
  if (!Number.isFinite(id) || !email || !role) return null;
  return {
    id,
    role,
    email,
    displayName: typeof r.displayName === "string" ? r.displayName : null,
    staffId: typeof r.staffId === "number" ? r.staffId : null,
    isActive: !!r.isActive,
    photoUrl: typeof r.photoUrl === "string" ? r.photoUrl : null,
  };
}

/** GET one form's approver roster, inactive rows included. */
export async function fetchApproverRoster(url: string): Promise<ApproverRosterResult> {
  const res = await fetch(url);
  if (res.status === 403) return { rows: [], ok: false, forbidden: true };
  const json = (await res.json().catch(() => null)) as
    | { ok?: boolean; data?: unknown[] }
    | null;
  if (!json || !json.ok || !Array.isArray(json.data)) {
    return { rows: [], ok: false, forbidden: false };
  }
  const rows: ApproverRosterRow[] = [];
  for (const raw of json.data) {
    const row = normalise(raw);
    if (row) rows.push(row);
  }
  return { rows, ok: true, forbidden: false };
}

/** The SWR key for a form's roster — one string, so one cache entry. */
export function approverRosterKey(form: AdvClrForm): string {
  return advClrApproverEndpoint(form);
}
