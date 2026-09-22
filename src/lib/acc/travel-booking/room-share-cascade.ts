/**
 * What happens to a room-share guest when its host dies or moves — AP-17
 * package E.
 *
 * Two triggers, both decided here and both applied inside the host's own
 * transaction by the caller (`approval.ts`, Task 6) — this module makes no
 * database call and takes no transaction, it only decides:
 *
 * - **the host is cancelled or rejected** (`cascadeForHostDeath`): every live
 *   guest that has been FILED is cancelled too, whatever its own status,
 *   including `Completed`; a guest whose own request is still **editable**
 *   (`Draft`/`Returned`) is **detached** instead. See that function for why
 *   the line falls exactly there, and why it must be `EDITABLE_STATUSES`
 *   rather than a second spelling of the same pair.
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
 * Pure and import-free of anything reaching a database — there are exactly
 * **two** imports, `DEAD` from `room-share-policy.ts` and `EDITABLE_STATUSES`
 * from `request-acl-policy.ts`, and both of those modules are themselves free
 * of one — so the cascade's decisions are unit-tested directly, with no pool,
 * no transaction and no `@/env`. Both are reused rather than retyped for the
 * same reason, and the second is load-bearing: see `cascadeForHostDeath`.
 */

import { EDITABLE_STATUSES } from "@/lib/acc/request-acl-policy";
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
  /**
   * The guest is **detached** rather than cancelled, because its own request
   * is still editable — see `cascadeForHostDeath` for why the two outcomes
   * exist. The binding row goes; the request keeps its status, its running
   * number and its per-diem figure, and is left at an unanswered
   * accommodation field for its owner to fill in.
   */
  | { kind: "detach"; requestId: number; previousStatus: string }
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
 * The host was cancelled, rejected or hard-deleted. Every live guest that has
 * been **filed** is cancelled, regardless of its own status — a `Completed`
 * guest included, per spec §2. An already-dead guest is skipped rather than
 * re-cancelled.
 *
 * A host with no guests returns `[]`, not a throw — the common case, since
 * most requests are not hosting anyone.
 *
 * ## Why an EDITABLE guest is DETACHED instead, and why that gives up nothing
 *
 * Cancelling a `Draft` or `Returned` guest **bricked its whole booking
 * group** (final review C1, reproduced 2026-09-22). All three AP-17 group
 * operations — `saveTravelBookingDraft`, `deleteTravelBookingDraft` and
 * `submitTravelBookingGroup` — loop every tab sharing the `GroupKey` and
 * throw on any whose status is not `Draft` or `Returned`. One
 * cascade-cancelled tab therefore made the group unsavable, unsubmittable
 * **and undeletable**, with no in-app remedy at all. And it was the ordinary
 * path rather than an edge: a guest is normally `Draft` at the moment it
 * attaches. *(The reason given here until 2026-09-22 was that
 * `RoomShareControl` refused to open until the draft was saved. That gate is
 * gone — the picker opens on an unsaved tab now — and the conclusion is
 * **stronger** without it, not weaker: the binding is written by
 * `saveTravelBookingDraft` itself, which admits `Draft` and `Returned` and
 * nothing else, so a guest is `Draft` or `Returned` at the moment it attaches
 * by construction rather than by habit.)*
 *
 * Spec §2's "cancelled too, in every case" was written to protect a **filed,
 * and possibly paid, position**: a guest who is travelling, or approved, or
 * already paid, must not keep a room that no longer exists. A `Draft` holds
 * no such position — nothing has been filed, approved or paid — and a
 * `Returned` one has been handed back to its owner precisely so they can
 * change it. Detaching costs neither of them anything that rule was
 * defending, and it leaves the person able to act: the binding goes, the
 * request keeps its status and its running number, and the accommodation
 * field it must now answer is empty (`applyRoomShareSelection` cleared it when
 * the share was saved), so `validateTravelBookingTab` refuses the submit until
 * they pick one.
 *
 * **The line is `EDITABLE_STATUSES`, imported rather than re-spelled, and
 * that is the load-bearing part.** The brick lives exactly where the two sets
 * disagree: any status the three group guards admit but this function
 * cancels is a status that bricks a group. Reusing the one constant those
 * guards are the hardcoded expression of — `request-acl-policy.ts`'s
 * `Draft`/`Returned` pair, the same one `requireEditableGuest` and
 * `decideRequestMutate` apply — makes the two agree by construction rather
 * than by coincidence. `room-share-cascade.test.ts` pins the correspondence
 * in both directions, and `room-share-cascade-guard.test.ts` pins that the
 * three group guards still spell that same pair.
 *
 * **Nothing is repriced on a detach**, deliberately, and it is exactly what
 * the guest clearing the choice themselves already does — that path is now
 * `applyRoomShareSelection` with a null host, inside the tab's own save: the
 * stale figure cannot be
 * paid without passing back through `submitTravelBookingGroup`, which
 * recomputes per diem from scratch, so inventing a money write nobody asked
 * for — on a request that is by definition still being edited — is the more
 * expensive direction to be wrong in.
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
    // Still editable by its own owner, so there is no filed position to
    // protect and cancelling it would strand the whole group — see the
    // docblock above. Detach and tell them; they answer the accommodation
    // question again before they can submit.
    if (EDITABLE_STATUSES.indexOf(g.status) !== -1) {
      actions.push({ kind: "detach", requestId: g.requestId, previousStatus: g.status });
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
