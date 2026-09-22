/**
 * What happens to a room-share guest when its host dies or moves — AP-17
 * package E.
 *
 * Two triggers, both decided here and both applied inside the host's own
 * transaction by the caller (`approval.ts`, Task 6) — this module makes no
 * database call and takes no transaction, it only decides:
 *
 * - **the host is cancelled or rejected** (`cascadeForHostDeath`): every live
 *   guest is cancelled too, whatever its own status, including `Completed`.
 *   That is the direction `perdiem-window.ts` exists to prevent — its
 *   allow-list is deliberately `Draft`/`Submitted`/`ManagerApproved`/`Returned`
 *   precisely because "overwriting a figure somebody has already been paid on
 *   is the expensive direction to be wrong in" — and the user chose it
 *   knowingly (spec §2). It is not silent: `wasCompleted` on the `cancel`
 *   action is what lets Task 8 mail accounting the moment it happens, rather
 *   than leaving a reconciliation to be discovered later.
 *
 * - **the host's travel dates change** (`cascadeForHostDates`): every live
 *   guest's dates are rewritten to the host's. A guest already sitting on the
 *   host's exact new dates is `skip`, not a no-op `redate` that would write a
 *   pointless activity row claiming something changed. **A date change that
 *   would create an overlap in the guest's own calendar is still a `redate`,
 *   never a refusal** (spec §4) — the guest did not choose the change, and
 *   blocking the host's date move over a collision in somebody else's
 *   calendar would be worse than the collision itself. This module is never
 *   handed the guest's other trips, so there is nothing here that even could
 *   refuse on that basis; the guarantee is structural, not a branch that has
 *   to remember to allow it.
 *
 * **A guest already `Cancelled` or `Rejected` is skipped, not re-cancelled or
 * re-dated**, by both functions — the same `alive` test `room-share-policy.ts`
 * uses, reused rather than redefined (see that module's `DEAD` for why a
 * seventh expression of "which statuses count as alive" would be the bug).
 *
 * Pure and import-free of anything reaching a database — `DEAD` is the one
 * import, from a sibling module that is itself free of one — so the cascade's
 * decisions are unit-tested directly, with no pool, no transaction and no
 * `@/env`.
 */

import { DEAD } from "./room-share-policy";

export interface GuestState {
  requestId: number;
  requestNo: string | null;
  status: string;
  departDate: string; // YYYY-MM-DD
  returnDate: string; // YYYY-MM-DD
}

export type GuestAction =
  | { kind: "cancel"; requestId: number; previousStatus: string; wasCompleted: boolean }
  | {
      kind: "redate";
      requestId: number;
      from: { depart: string; return: string };
      to: { depart: string; return: string };
    }
  | { kind: "skip"; requestId: number; reason: string };

/** The same exclusion `room-share-policy.ts`'s `canHost`/`canAttach` use. */
function isAlive(status: string): boolean {
  return DEAD.indexOf(status) === -1;
}

/**
 * The host was cancelled or rejected. Every live guest is cancelled,
 * regardless of its own status — a `Completed` guest included, per spec §2.
 * An already-dead guest is skipped rather than re-cancelled.
 *
 * A host with no guests returns `[]`, not a throw — the common case, since
 * most requests are not hosting anyone.
 */
export function cascadeForHostDeath(guests: readonly GuestState[]): GuestAction[] {
  const actions: GuestAction[] = [];
  for (const g of guests) {
    if (!isAlive(g.status)) {
      actions.push({
        kind: "skip",
        requestId: g.requestId,
        reason: `already ${g.status} — not re-cancelled`,
      });
      continue;
    }
    actions.push({
      kind: "cancel",
      requestId: g.requestId,
      previousStatus: g.status,
      // The case spec §2 names explicitly: a Completed guest's per diem may
      // already be paid, and it is cancelled anyway. This is what tells the
      // caller (Task 8) to mail accounting rather than leave it silent.
      wasCompleted: g.status === "Completed",
    });
  }
  return actions;
}

/**
 * The host's travel dates changed. Every live guest's depart/return are
 * rewritten to the host's dates. A guest already on those exact dates is
 * `skip`, not a no-op `redate`. A dead guest is skipped, same as above.
 *
 * Status and approvals are untouched by this decision (spec §4) — this
 * function only ever produces `redate`/`skip` actions, never a status change;
 * applying a `redate` is the caller's job, alongside recomputing per diem
 * through the existing `recomputeGroupPerDiem`.
 */
export function cascadeForHostDates(
  guests: readonly GuestState[],
  hostDates: { depart: string; return: string },
): GuestAction[] {
  const actions: GuestAction[] = [];
  for (const g of guests) {
    if (!isAlive(g.status)) {
      actions.push({
        kind: "skip",
        requestId: g.requestId,
        reason: `already ${g.status} — not re-dated`,
      });
      continue;
    }
    if (g.departDate === hostDates.depart && g.returnDate === hostDates.return) {
      actions.push({
        kind: "skip",
        requestId: g.requestId,
        reason: "dates already match the host",
      });
      continue;
    }
    // No check against the guest's other trips, and deliberately none is
    // possible here: this function is never given them. See the module
    // doc comment — a redate is produced unconditionally once the dates
    // actually differ, whatever downstream overlap that may create.
    actions.push({
      kind: "redate",
      requestId: g.requestId,
      from: { depart: g.departDate, return: g.returnDate },
      to: { depart: hostDates.depart, return: hostDates.return },
    });
  }
  return actions;
}
