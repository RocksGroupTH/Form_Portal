/**
 * Applying a room-share cascade — the pool half of AP-17 package E's §4.
 *
 * `room-share-cascade.ts` decides **what** happens to each guest and touches
 * no database; this module **does it**, inside the transaction the caller is
 * already holding open on the host.
 *
 * ## Why this is its own file rather than living in `approval.ts`
 *
 * There are two triggers and they are in two different files. The death
 * cascade belongs in `approval.ts` (`recomputeAfterDeath`, which all four
 * public cancel/reject paths already reach) and in `request-service.ts`'s
 * `collectAndDeleteRequestArtifacts`; the date cascade belongs in
 * `request-service.ts`'s draft save, `BOOKING_SET` being the only writer of
 * `DepartDate`/`ReturnDate` in `src/`. **`approval.ts` already imports
 * `request-service.ts`** (`getTravelBookingRequest`), so `request-service.ts`
 * cannot import back from it without a cycle. A third module both can import
 * is the only home that does not create one.
 *
 * ## The safety property, and it is the whole feature
 *
 * Every function here takes a **runner** — a pool or, in practice, the
 * caller's open transaction — and issues every write on it. Spec §4: *"The
 * cascade runs in the host's transaction. If it fails, the host's own
 * cancellation rolls back."* A host cancelled while its guests survive is the
 * state this feature exists to prevent, and it is worse than a cancellation
 * the user has to retry. **Nothing here may grow a `try`/`catch` that
 * degrades gracefully** — a swallowed failure is exactly the silent survival
 * the transaction boundary is there to make impossible.
 *
 * ## Why nothing here recurses
 *
 * A cancelled guest is not itself re-entered into the death cascade. It does
 * not need to be — `canAttach` refuses a guest that is already hosting anyone
 * (one hop, spec §3) — and more importantly, not recursing is what makes
 * termination **structural** rather than dependent on that invariant holding
 * in the data. A hand-made pair of rows forming A→B→A cannot hang a
 * cancellation here, because the cascade is never re-entered at all. What the
 * guest *does* get is the same per-diem give-back any cancellation gets, via
 * `recomputeGroupPerDiem` on its own group — which is where `recomputeAfterDeath`
 * would have sent it too.
 */

import { getAccPool, sql } from "@/lib/acc/pool";
import { EDITABLE_STATUSES } from "@/lib/acc/request-acl-policy";
import {
  CASCADE_CANCEL_ACTION,
  CASCADE_DETACH_ACTION,
  CASCADE_REDATE_ACTION,
} from "@/lib/acc/travel-booking/room-share-actions";
import { loadGuestsOf } from "@/lib/acc/travel-booking/room-share-service";
import {
  cascadeForHostDates,
  cascadeForHostDeath,
  type GuestAction,
} from "@/lib/acc/travel-booking/room-share-cascade";
import { recomputeGroupPerDiem } from "@/lib/acc/travel-booking/perdiem-recompute";
import { queueRoomShareCascadeMails } from "@/lib/acc/travel-booking/room-share-notify";

type AccPool = Awaited<ReturnType<typeof getAccPool>>;
/**
 * Anything with `.request()` — the caller's open transaction in every real
 * use. The same structural type `loadGuestsOf`, `perdiem-dependency-load.ts`
 * and `requester-trips.ts` already declare, copied rather than invented so a
 * transaction object is handed straight through with no cast.
 */
type SqlRunner = { request: () => ReturnType<AccPool["request"]> };

/**
 * The three activity actions this cascade writes.
 *
 * **The literals live in `room-share-actions.ts`**, which imports nothing, so
 * the detail page's renderer can share them without dragging `@/env` through
 * `@/lib/acc/pool` into the client bundle — the build break CLAUDE.md records
 * for `src/lib/api-keys/codes.ts`. Re-exported here because this is where
 * every server-side caller already looks for them.
 */
export {
  CASCADE_CANCEL_ACTION,
  CASCADE_DETACH_ACTION,
  CASCADE_REDATE_ACTION,
} from "@/lib/acc/travel-booking/room-share-actions";

/** Date column → 'YYYY-MM-DD' using local getters (server is Thai time, never toISOString). */
function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** A guest's running number as the timeline should read it — never the string "null". */
function label(requestNo: string | null, requestId: number): string {
  return requestNo ?? `#${requestId}`;
}

/**
 * The host's own running number, read inside the caller's transaction.
 *
 * Always read here rather than accepted as a parameter, even though
 * `recomputeAfterDeath` has already read it a few lines earlier. One
 * self-contained read means no caller can hand the cascade the *wrong*
 * number — which would put a false request number on a guest's audit row, the
 * one field somebody reconciling a surprise cancellation will look at first —
 * and it costs one indexed lookup on a path that has already established the
 * host has guests.
 */
async function hostRequestNo(runner: SqlRunner, hostRequestId: number): Promise<string | null> {
  const r = await runner
    .request()
    .input("hid", sql.Int, hostRequestId)
    .query(`SELECT RequestNo FROM [dbo].[AccRequest] WHERE Id = @hid`);
  return (r.recordset[0]?.RequestNo as string | null) ?? null;
}

/**
 * Each guest's own `GroupKey`, so its per diem can be given back to *its*
 * group — never the host's, which belongs to a different person's calendar.
 *
 * One batched read rather than one per guest: this runs inside a transaction
 * holding locks, and a guest count of one is the common case but not the only
 * one (spec §8 deliberately does not cap how many attach to a host).
 */
async function groupKeysOf(
  runner: SqlRunner,
  requestIds: readonly number[],
): Promise<Map<number, string | null>> {
  const out = new Map<number, string | null>();
  if (requestIds.length === 0) return out;

  const req = runner.request();
  const params: string[] = [];
  requestIds.forEach((id, i) => {
    req.input(`gk${i}`, sql.Int, id);
    params.push(`@gk${i}`);
  });

  const res = await req.query(`SELECT t.RequestId, t.GroupKey
                                 FROM [dbo].[AccTravelBooking] t
                                WHERE t.RequestId IN (${params.join(", ")})`);
  for (const row of res.recordset as { RequestId: number; GroupKey: string | null }[]) {
    out.set(row.RequestId, row.GroupKey ?? null);
  }
  return out;
}

/** The current depart date of one request, as stored — the "before" half of a re-date's anchor. */
async function storedDepart(runner: SqlRunner, requestId: number): Promise<string | null> {
  const r = await runner
    .request()
    .input("rid", sql.Int, requestId)
    .query(`SELECT DepartDate FROM [dbo].[AccTravelBooking] WHERE RequestId = @rid`);
  const d = r.recordset[0]?.DepartDate as Date | null | undefined;
  return d ? toYmd(d) : null;
}

/**
 * One `detach` decision, applied — the C1 half of the death cascade.
 *
 * **The `DELETE`'s status predicate is built from `EDITABLE_STATUSES`
 * itself**, not from two hand-typed literals, for the same reason
 * `cascadeForHostDeath` imports that constant to make the decision: the
 * decision and the write have to agree about which guests are detachable, and
 * two spellings of one rule is how they stop agreeing. The bound parameters
 * are generated from the array, so adding a status to it moves both halves at
 * once.
 *
 * **Why the predicate is there at all.** `loadGuestsOf` is a plain `SELECT`
 * whose shared lock READ COMMITTED releases at statement end, so the guest
 * could have been submitted between the decision and this statement — and a
 * just-filed guest has had its per diem priced on the strength of the share.
 * Stripping it then would leave a `Submitted` request paid for a room it no
 * longer has any claim to. `rowsAffected === 0` means exactly that (or that
 * the guest detached themselves first), and the action is downgraded to a
 * `skip` — the same downgrade, for the same reason, the `cancel` arm makes.
 *
 * The residual is stated rather than hidden: in that race the binding
 * survives, pointing at a host that is dead or about to be deleted. It is the
 * same class of residue a lost `cancel` race leaves, it is recorded in the
 * returned action list, and on the hard-delete path it cannot outlive the
 * transaction anyway — `collectAndDeleteRequestArtifacts` removes every
 * binding naming the host a few statements later.
 */
async function applyOneDetach(
  runner: SqlRunner,
  hostRequestId: number,
  hostNo: string | null,
  action: Extract<GuestAction, { kind: "detach" }>,
): Promise<GuestAction> {
  const req = runner
    .request()
    .input("gid", sql.Int, action.requestId)
    .input("hid", sql.Int, hostRequestId);
  const statusParams: string[] = [];
  EDITABLE_STATUSES.forEach((status, i) => {
    req.input(`es${i}`, sql.NVarChar, status);
    statusParams.push(`@es${i}`);
  });

  const del = await req.query(`DELETE s
                                 FROM [dbo].[AccTravelRoomShare] s
                                 INNER JOIN [dbo].[AccRequest] r ON r.Id = s.GuestRequestId
                                WHERE s.GuestRequestId=@gid AND s.HostRequestId=@hid
                                  AND r.Status IN (${statusParams.join(", ")});
                               SELECT @@ROWCOUNT AS n`);
  if (((del.recordset[0]?.n as number) ?? 0) === 0) {
    return {
      kind: "skip",
      requestId: action.requestId,
      reason: "no longer an editable guest of this host by the time the cascade claimed it — not detached",
    };
  }

  const note =
    `ยกเลิกการพักห้องร่วมอัตโนมัติ เนื่องจากคำขอที่พักห้องร่วม ${label(hostNo, hostRequestId)}` +
    ` ถูกยกเลิก/ไม่อนุมัติ/ถูกลบ — คำขอนี้ยังแก้ไขได้ (สถานะ ${action.previousStatus})` +
    ` จึงไม่ถูกยกเลิก กรุณาเลือกที่พักค้างคืนใหม่ก่อนส่งคำขอ`;

  await runner
    .request()
    .input("gid", sql.Int, action.requestId)
    .input("action", sql.NVarChar(50), CASCADE_DETACH_ACTION)
    .input("note", sql.NVarChar, note.slice(0, 2000))
    .input("meta", sql.NVarChar, JSON.stringify({
      hostRequestId,
      hostRequestNo: hostNo,
      previousStatus: action.previousStatus,
    }))
    .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note, MetadataJson)
            VALUES (@gid, NULL, @action, @note, @meta)`);

  return action;
}

/**
 * The host was cancelled, rejected, or hard-deleted. Cancel every live guest
 * that has been filed, and **detach** — rather than cancel — every one whose
 * own request is still editable.
 *
 * The split is `cascadeForHostDeath`'s and its whole argument lives there:
 * cancelling a `Draft` or `Returned` guest left its entire booking group
 * unsavable, unsubmittable and undeletable, because all three AP-17 group
 * operations throw on a tab that is neither. What the apply layer adds is the
 * race guard below — the DELETE is conditional on the guest still being
 * editable, so a guest filed between the decision and this statement is not
 * stripped of a share its per diem was just priced on.
 *
 * Returns what was actually applied — the decisions from
 * `cascadeForHostDeath`, with any `cancel` **or `detach`** that lost a race
 * downgraded to a `skip`. **Task 8 consumes this**: `wasCompleted` on a
 * surviving `cancel` is
 * what tells it to mail accounting, which is the entire mitigation for the
 * cost spec §2 accepted (a guest whose per diem has already been paid is
 * cancelled anyway, and the system must say so rather than leave a
 * reconciliation to be discovered).
 *
 * Per guest, in this order and all on `runner`:
 *
 * 1. a **guarded** `UPDATE` claiming the row out of a live status. The
 *    decision was made from a `SELECT` whose shared lock READ COMMITTED
 *    released at statement end, so a concurrent action could have killed the
 *    guest in between; `rowsAffected === 0` means exactly that, and the action
 *    is downgraded to a `skip` rather than having a false "cancelled by the
 *    host" row written about it;
 * 2. any pending `AccApproval` row closed as `Returned` — `CK_AccApproval_Status`
 *    admits no `Cancelled`, which is why `cancelByRequester` does the same;
 * 3. the audit row, `cancelled_by_room_share_host`, naming the host's running
 *    number and the guest's own previous status;
 * 4. the per-diem give-back on the guest's **own** group.
 *
 * Per **detached** guest there are only two steps, and the omissions are the
 * point: the guarded `DELETE` of the binding, and the audit row
 * `detached_by_room_share_host`. **No status change, no approval is closed
 * and nothing is repriced** — the guest's request is untouched apart from
 * losing a share it can no longer have, exactly as the guest clearing the
 * choice themselves leaves it (`applyRoomShareSelection` with a null host,
 * inside their own tab save since 2026-09-22), and the figure it keeps cannot
 * be paid without passing back through the submit, which prices it again from
 * scratch.
 *
 * `CancelledBy` and `AuthorId` are both left NULL, deliberately and for the
 * same reason `perdiem_recalculated` leaves `AuthorId` NULL: **nobody did
 * this.** The host's owner cancelled their own request; they did not act on
 * the guest's, they have never seen it, and stamping their user id on it would
 * claim they did. `MetadataJson` names the host instead, which is who to look
 * at.
 */
export async function applyRoomShareDeath(
  runner: SqlRunner,
  hostRequestId: number,
): Promise<GuestAction[]> {
  const guests = await loadGuestsOf(runner, hostRequestId);
  // The overwhelmingly common case: one indexed read on `IX_AccTravelRoomShare_Host`
  // and out, on every cancellation of every AP-17 request in the system.
  if (guests.length === 0) return [];

  const decided = cascadeForHostDeath(guests);
  const hostNo = await hostRequestNo(runner, hostRequestId);
  const cancelIds = decided
    .filter((a): a is Extract<GuestAction, { kind: "cancel" }> => a.kind === "cancel")
    .map((a) => a.requestId);
  const groupKeys = await groupKeysOf(runner, cancelIds);
  const byId = new Map<number, (typeof guests)[number]>();
  for (const g of guests) byId.set(g.requestId, g);

  const applied: GuestAction[] = [];

  for (const action of decided) {
    if (action.kind === "detach") {
      applied.push(await applyOneDetach(runner, hostRequestId, hostNo, action));
      continue;
    }
    if (action.kind !== "cancel") {
      applied.push(action);
      continue;
    }

    const guest = byId.get(action.requestId);
    const upd = await runner
      .request()
      .input("gid", sql.Int, action.requestId)
      .query(`UPDATE [dbo].[AccRequest]
                 SET Status='Cancelled', CurrentStepCode=NULL,
                     CancelledBy=NULL, CancelledAt=SYSDATETIME(), UpdatedAt=SYSDATETIME()
               WHERE Id=@gid AND Status NOT IN ('Cancelled','Rejected');
              SELECT @@ROWCOUNT AS n`);
    if (((upd.recordset[0]?.n as number) ?? 0) === 0) {
      applied.push({
        kind: "skip",
        requestId: action.requestId,
        reason: "already dead by the time the cascade claimed it — not re-cancelled",
      });
      continue;
    }

    await runner
      .request()
      .input("gid", sql.Int, action.requestId)
      .query(`UPDATE [dbo].[AccApproval] SET Status='Returned', ActionedAt=SYSDATETIME()
               WHERE RequestId=@gid AND Status='Pending'`);

    const note =
      `ยกเลิกอัตโนมัติ เนื่องจากคำขอที่พักห้องร่วม ${label(hostNo, hostRequestId)}` +
      ` ถูกยกเลิก/ไม่อนุมัติ — สถานะเดิมของคำขอนี้: ${action.previousStatus}` +
      (action.wasCompleted ? " (คำขอนี้ผ่าน HR แล้ว — แจ้ง HR ตรวจสอบ)" : "");

    await runner
      .request()
      .input("gid", sql.Int, action.requestId)
      .input("action", sql.NVarChar(50), CASCADE_CANCEL_ACTION)
      .input("note", sql.NVarChar, note.slice(0, 2000))
      .input("meta", sql.NVarChar, JSON.stringify({
        hostRequestId,
        hostRequestNo: hostNo,
        previousStatus: action.previousStatus,
        wasCompleted: action.wasCompleted,
      }))
      .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note, MetadataJson)
              VALUES (@gid, NULL, @action, @note, @meta)`);

    // The guest's own group gives its day back, exactly as it would had the
    // guest been cancelled directly — its status now reads `Cancelled` inside
    // this same transaction, so `continuationFlags` sees it as dead without
    // any special case. A guest with no booking row (impossible for AP-17, but
    // the join is a LEFT JOIN upstream) skips silently, as `recomputeAfterDeath`
    // does for the same reason.
    const gk = groupKeys.get(action.requestId) ?? null;
    if (gk) {
      await recomputeGroupPerDiem(runner, gk, {
        requestId: action.requestId,
        requestNo: guest?.requestNo ?? null,
        kind: "cancelled",
      });
    }

    applied.push(action);
  }

  // Told, in the same transaction that did it (spec §5). Driven by `applied`
  // rather than `decided`, so a guest whose cancel lost the race above is not
  // mailed about a cancellation that did not happen. No `try`/`catch`, for
  // this module's stated reason: notification is the ENTIRE mitigation for a
  // host who was never asked, so a cascade that commits while its notice does
  // not is the silent survival the transaction boundary exists to prevent.
  await queueRoomShareCascadeMails(runner, hostRequestId, applied);

  return applied;
}

/**
 * The host's travel dates changed. Rewrite every live guest's dates to follow.
 *
 * `hostDates` must be a **complete** pair of `YYYY-MM-DD` strings, and an
 * incomplete one is refused **here** rather than only at the call site. A
 * draft save legitimately passes through a half-filled state, so this is
 * reachable in ordinary use; following a host into a blank range would null
 * out dates the guest chose and then re-price them at zero days. The call site
 * checks it too — that check is what avoids the query at all — but the rule
 * belongs where it cannot be bypassed by the next caller.
 *
 * It returns `[]` rather than throwing because there is no failure here:
 * nothing has gone wrong, the host simply has no range to follow yet. That is
 * the one no-op in this module, and it is not the "degrade gracefully" the
 * rest of it forbids — no cascade was skipped, because there was no change to
 * cascade.
 *
 * Per re-dated guest, on `runner`:
 *
 * 1. the `AccTravelBooking` `UPDATE`. **Status and approvals are untouched** —
 *    spec §2 accepted that a manager who approved 20–24 may find the trip has
 *    become 25–30 with nobody re-reviewing it, for throughput. Adding a status
 *    reset here would be reversing a decision the user took;
 * 2. the audit row, `dates_followed_room_share_host`, recording **both**
 *    ranges. That is what lets the manager who approved the first range see
 *    what it became;
 * 3. the reprice, through the **existing** `recomputeGroupPerDiem` rather than
 *    a second copy of the pricing rules.
 *
 * **Two options are passed to that recompute and neither is optional in
 * practice** — see `RecomputeGroupOptions` for the full argument:
 * `repriceRequestIds` because a span change moves the days count without
 * necessarily moving the continuation flag, which is the only thing the
 * recompute's own early return looks at; and `affectedFromDate` because a
 * re-date, unlike a cancellation, is not directional — a guest moved
 * *earlier* affects trips that sit before its current depart date, which the
 * default anchor would silently exclude.
 *
 * **An overlap the guest's own calendar would have refused at submit is NOT an
 * error here** (spec §4). The guest did not choose the change, and blocking
 * the host's date move over a collision in somebody else's calendar would be
 * worse than the collision. `cascadeForHostDates` cannot refuse on that basis
 * — it is never handed the guest's other trips — and nothing is added here to
 * let it.
 */
export async function applyRoomShareDates(
  runner: SqlRunner,
  hostRequestId: number,
  hostDates: { depart: string; return: string },
): Promise<GuestAction[]> {
  if (!hostDates.depart || !hostDates.return) return [];

  const guests = await loadGuestsOf(runner, hostRequestId);
  if (guests.length === 0) return [];

  const decided = cascadeForHostDates(guests, hostDates);
  const redateIds = decided
    .filter((a): a is Extract<GuestAction, { kind: "redate" }> => a.kind === "redate")
    .map((a) => a.requestId);
  if (redateIds.length === 0) return decided;

  const hostNo = await hostRequestNo(runner, hostRequestId);
  const groupKeys = await groupKeysOf(runner, redateIds);
  const byId = new Map<number, (typeof guests)[number]>();
  for (const g of guests) byId.set(g.requestId, g);

  for (const action of decided) {
    if (action.kind !== "redate") continue;
    const guest = byId.get(action.requestId);

    // Read BEFORE the UPDATE: the anchor for the outside-trip arm is the
    // earlier of where this trip was and where it is going, and after the
    // write the earlier one is no longer recoverable from the row.
    const beforeDepart = await storedDepart(runner, action.requestId);

    await runner
      .request()
      .input("gid", sql.Int, action.requestId)
      .input("dep", sql.Date, hostDates.depart)
      .input("ret", sql.Date, hostDates.return)
      .query(`UPDATE [dbo].[AccTravelBooking]
                 SET DepartDate=@dep, ReturnDate=@ret, UpdatedAt=SYSDATETIME()
               WHERE RequestId=@gid`);

    const note =
      `เปลี่ยนวันเดินทางอัตโนมัติตามคำขอที่พักห้องร่วม ${label(hostNo, hostRequestId)}` +
      ` — เดิม ${action.from.depart} ถึง ${action.from.return}` +
      ` เป็น ${action.to.depart} ถึง ${action.to.return}`;

    await runner
      .request()
      .input("gid", sql.Int, action.requestId)
      .input("action", sql.NVarChar(50), CASCADE_REDATE_ACTION)
      .input("note", sql.NVarChar, note.slice(0, 2000))
      .input("meta", sql.NVarChar, JSON.stringify({
        hostRequestId,
        hostRequestNo: hostNo,
        from: action.from,
        to: action.to,
      }))
      .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note, MetadataJson)
              VALUES (@gid, NULL, @action, @note, @meta)`);

    const gk = groupKeys.get(action.requestId) ?? null;
    if (gk) {
      // The earlier of the two departs, compared as 'YYYY-MM-DD' strings —
      // which sort lexicographically exactly as they sort chronologically, the
      // same comparison `recomputeGroupPerDiem`'s own `>= causeDepart` makes.
      const anchor =
        beforeDepart && beforeDepart < action.to.depart ? beforeDepart : action.to.depart;
      await recomputeGroupPerDiem(
        runner,
        gk,
        {
          requestId: action.requestId,
          requestNo: guest?.requestNo ?? null,
          kind: "host_redated",
        },
        { repriceRequestIds: [action.requestId], affectedFromDate: anchor },
      );
    }
  }

  // Told, in the same transaction that moved the dates (spec §5) — and this
  // is the arm that carries the user's 2026-09-22 ruling: `perDiemWritable`
  // refuses to reprice a `Completed` guest, so its dates move while its paid
  // figure does not. `queueRoomShareCascadeMails` re-reads each guest's status
  // and tells accounting when that has happened, because the conservative
  // choice about the money must not also be the silent one.
  await queueRoomShareCascadeMails(runner, hostRequestId, decided);

  return decided;
}
