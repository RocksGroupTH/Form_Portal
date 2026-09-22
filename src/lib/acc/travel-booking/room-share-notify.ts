/**
 * Telling the host, the guest and accounting — AP-17 package E's §5.
 *
 * ## Why this file carries more weight than "three emails"
 *
 * Spec §2: **the host has no veto.** A guest attaches to a document they do
 * not own, draws per diem on the strength of it, and the host learns
 * afterwards. The user accepted that, and **notification is the entire
 * mitigation.** Two of the other three accepted costs are mitigated the same
 * way and by nothing else: a `Completed` guest is cancelled even after its per
 * diem has been paid, and a guest's dates move with no manager re-reviewing
 * them. Until this module existed, all three protections amounted to an
 * activity row nobody reads.
 *
 * ## Everything here queues on the CALLER'S RUNNER, inside their transaction
 *
 * `queueEmail`'s `on` parameter takes the open transaction, so the
 * `AccEmailQueue` row commits or rolls back with the cascade that caused it.
 * That is deliberate and it is the same argument `room-share-cascade-apply.ts`
 * makes for the cascade itself: a cancellation that commits while the mail
 * telling accounting about it does not is the silent failure this feature
 * cannot afford. **Nothing here may grow a `try`/`catch` that degrades
 * gracefully** — if the notification cannot be written, the host's own action
 * rolls back and is retried, which spec §4 states outright is the better
 * direction.
 *
 * `notify()` in `approval.ts` is best-effort and this is not, and the two are
 * not in conflict: that one wraps a *send* through Microsoft Graph, which can
 * fail for reasons nobody here controls. This one writes a row on a connection
 * that has already written five.
 *
 * ## Why it reads narrowly rather than calling `getTravelBookingRequest`
 *
 * That function opens its own pool connection. Called from inside the host's
 * transaction it would read state from *outside* it — missing the very change
 * it is reporting — and would block on rows that transaction has exclusively
 * locked while the transaction waits for the read, which is a deadlock rather
 * than a slow query. Every fact these mails render is therefore read on the
 * runner, in two batched queries, and handed to `buildRoomShareEmail`'s
 * explicit narrow input.
 *
 * `listBookingApprovers` is the one read that does take a second connection
 * from the pool. It is safe because it touches only `AccBookingApprover` and
 * its two grant tables, which no cascade transaction ever writes, so there is
 * no lock to wait on — the same shape as `recomputeGroupPerDiem`'s own
 * per-diem-override read, which already runs inside these transactions.
 */

import { sql } from "@/lib/acc/pool";
import { queueEmail, type EmailQueueRunner } from "@/lib/acc/email-queue";
import {
  buildRoomShareEmail,
  type RoomShareMailInput,
  type RoomShareMailParty,
} from "@/lib/acc/travel-booking/email-templates";
import type { GuestAction } from "@/lib/acc/travel-booking/room-share-cascade";
import { perDiemWritable } from "@/lib/acc/travel-booking/perdiem-window";
import { listBookingApprovers } from "@/lib/acc/booking-approver-service";
import { canActOnBookingBrand } from "@/lib/acc/travel-booking/booking-brand-access-shared";

/** The caller's open transaction in every real use — the same structural type the cascade uses. */
type SqlRunner = EmailQueueRunner;

/** Date column → 'YYYY-MM-DD' with local getters. The server runs Thai time; never `toISOString`. */
function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * What a mail needs about one request, and nothing else.
 *
 * `status` is read here rather than taken from a `GuestAction` on purpose, and
 * the two are used for different halves: a **cancelled** guest's status now
 * reads `Cancelled`, so its pre-cascade status comes from the action's
 * `previousStatus`; a **re-dated** guest's status is untouched by the cascade,
 * so the freshly-read value is the honest answer to "can this one's money
 * still move".
 */
interface RequestFacts {
  requestId: number;
  requestNo: string | null;
  personName: string | null;
  email: string | null;
  brandCode: string | null;
  status: string;
  departDate: string | null;
  returnDate: string | null;
  workLocation: string | null;
  perDiemDays: number | null;
  perDiemTotal: number | null;
}

/**
 * Two batched queries for however many requests the cascade touched, not two
 * per guest: this runs inside a transaction holding locks, and spec §8
 * deliberately does not cap how many guests attach to one host.
 *
 * `LEFT JOIN` to `AccTravelBooking` for the same reason `loadGuestsOf` uses
 * one — a guest the notifier cannot see is a guest nobody is told about, which
 * is the outcome this module exists to prevent. A missing booking row yields
 * null dates, which render as "-".
 */
async function loadFacts(
  runner: SqlRunner,
  requestIds: readonly number[],
): Promise<Map<number, RequestFacts>> {
  const out = new Map<number, RequestFacts>();
  if (requestIds.length === 0) return out;

  const req = runner.request();
  const ids = requestIds.map((id, i) => {
    req.input(`f${i}`, sql.Int, id);
    return `@f${i}`;
  });
  const res = await req.query(`
    SELECT r.Id, r.RequestNo, r.RequesterFullName, r.RequesterEmail, r.BrandCode, r.Status,
           t.DepartDate, t.ReturnDate, t.PerDiemDays, t.PerDiemTotal
      FROM [dbo].[AccRequest] r
      LEFT JOIN [dbo].[AccTravelBooking] t ON t.RequestId = r.Id
     WHERE r.Id IN (${ids.join(", ")})
  `);

  for (const row of res.recordset as {
    Id: number;
    RequestNo: string | null;
    RequesterFullName: string | null;
    RequesterEmail: string | null;
    BrandCode: string | null;
    Status: string | null;
    DepartDate: Date | null;
    ReturnDate: Date | null;
    PerDiemDays: number | null;
    PerDiemTotal: number | null;
  }[]) {
    out.set(row.Id, {
      requestId: row.Id,
      requestNo: row.RequestNo ?? null,
      personName: row.RequesterFullName ?? null,
      email: row.RequesterEmail ?? null,
      brandCode: row.BrandCode ?? null,
      status: String(row.Status ?? ""),
      departDate: row.DepartDate ? toYmd(row.DepartDate) : null,
      returnDate: row.ReturnDate ? toYmd(row.ReturnDate) : null,
      workLocation: null,
      perDiemDays: row.PerDiemDays == null ? null : Number(row.PerDiemDays),
      perDiemTotal: row.PerDiemTotal == null ? null : Number(row.PerDiemTotal),
    });
  }

  const locReq = runner.request();
  const locIds = requestIds.map((id, i) => {
    locReq.input(`w${i}`, sql.Int, id);
    return `@w${i}`;
  });
  const locs = await locReq.query(`
    SELECT t.RequestId, w.Name
      FROM [dbo].[AccTravelWorkLocation] w
      INNER JOIN [dbo].[AccTravelBooking] t ON t.Id = w.TravelBookingId
     WHERE t.RequestId IN (${locIds.join(", ")})
     ORDER BY w.SortOrder, w.Id
  `);
  const names = new Map<number, string[]>();
  for (const row of locs.recordset as { RequestId: number; Name: string | null }[]) {
    if (!row.Name) continue;
    const list = names.get(row.RequestId) ?? [];
    list.push(row.Name);
    names.set(row.RequestId, list);
  }
  names.forEach((list, requestId) => {
    const facts = out.get(requestId);
    if (facts) facts.workLocation = list.join(" · ");
  });

  return out;
}

/** A `RequestFacts` as the templates take it. Nothing is added; the email address is deliberately not part of it. */
function toParty(facts: RequestFacts | undefined, fallbackId: number): RoomShareMailParty {
  return {
    requestId: facts?.requestId ?? fallbackId,
    requestNo: facts?.requestNo ?? null,
    personName: facts?.personName ?? null,
    departDate: facts?.departDate ?? null,
    returnDate: facts?.returnDate ?? null,
    workLocation: facts?.workLocation ?? null,
    perDiemDays: facts?.perDiemDays ?? null,
    perDiemTotal: facts?.perDiemTotal ?? null,
  };
}

/**
 * Who "accounting" is for AP-17: the active `AccBookingApprover` roster,
 * narrowed to the brands each of them may act on.
 *
 * **Not `listApprovers`** — that reads `AccApprover`, AP-1's roster, and
 * `approval.ts` already carries two comments recording that reaching for it
 * from AP-17 mails people who cannot act and misses people who can.
 *
 * **Not filtered on the `accountApproval` menu tick either.** That grant
 * *opens a menu* for somebody who is not on the roster; membership is what
 * permits the action, and measured 2026-08-27 `AccBookingApproverTab` held
 * zero rows while the roster held two — so a tick-filtered list would have
 * mailed nobody at all.
 *
 * The brand narrowing follows `canActOnBookingBrand`, including its rule that
 * an unbranded request is invisible to a scoped approver: somebody who cannot
 * open the record cannot act on the problem, and the running number and amount
 * in these mails are exactly what the scope exists to withhold. An approver
 * with no `AccBookingApproverBrand` rows sees every brand, which is that
 * table's documented "no rows means no narrowing".
 */
async function accountingRecipients(brandCode: string | null): Promise<string[]> {
  const approvers = await listBookingApprovers(true);
  const out: string[] = [];
  const seen: Record<string, true> = {};
  for (const a of approvers) {
    const email = (a.email ?? "").trim();
    if (!email) continue;
    const allowed = canActOnBookingBrand(
      { allAccess: a.brandCodes === null, allowedCodes: a.brandCodes ?? [] },
      brandCode,
    );
    if (!allowed) continue;
    const key = email.toLowerCase();
    if (seen[key]) continue;
    seen[key] = true;
    out.push(email);
  }
  return out;
}

/**
 * One queued row, built and filed on the caller's runner.
 *
 * **The `AccEmailQueue.TriggerType` is `input.kind` and cannot be given
 * separately** — a second parameter for it would be a second place to name the
 * same thing, and the two would eventually disagree about which mail a queued
 * row is. Every kind fits `nvarchar(50)` comfortably.
 */
async function queueOne(
  runner: SqlRunner,
  toEmail: string | null,
  requestId: number,
  input: RoomShareMailInput,
): Promise<void> {
  if (!toEmail) return;
  const mail = buildRoomShareEmail(input);
  await queueEmail(
    { requestId, toEmail, subject: mail.subject, bodyHtml: mail.html, triggerType: input.kind },
    runner,
  );
}

/**
 * **Mail 1 — to the host, the moment a guest attaches.**
 *
 * Spec §5: *"naming the guest and the dates, so an unexpected one is visible
 * immediately rather than at check-in."* This is the only thing standing
 * between a host and a stranger in their room, because §2 declined to ask them
 * first.
 *
 * It goes to `AccRequest.RequesterEmail` of the **host** request — the
 * traveller whose room it is, not whoever filed the request on their behalf.
 * A host with no address on file is skipped silently by `queueEmail`; there is
 * nothing else to do with it, and failing the attach over a missing HR email
 * would punish the guest for the host's record.
 *
 * Called inside the transaction that records the binding — the tab save's own,
 * through `applyRoomShareSelection` — so the binding and the notice about it
 * commit together.
 */
export async function queueRoomShareAttachedMail(
  runner: SqlRunner,
  input: { guestRequestId: number; hostRequestId: number },
): Promise<void> {
  const facts = await loadFacts(runner, [input.guestRequestId, input.hostRequestId]);
  const host = facts.get(input.hostRequestId);
  const guest = facts.get(input.guestRequestId);

  await queueOne(runner, host?.email ?? null, input.hostRequestId, {
    kind: "RoomShareAttached",
    // The HOST's own request is what the CTA opens — the host may open it and
    // `decideRequestRead` would refuse them the guest's.
    subjectOf: toParty(host, input.hostRequestId),
    counterpart: toParty(guest, input.guestRequestId),
  });
}

/**
 * **Mails 2, 3 and 6 — to each affected guest, and to accounting when money
 * is already involved.**
 *
 * Three things can happen to a guest and each gets its own mail: cancelled
 * (its host died and it had been filed), **detached** (its host died while it
 * was still editable — final review C1) and re-dated. Only the first and the
 * last can also reach accounting, because only they can touch a figure
 * somebody has signed.
 *
 * Driven by the `GuestAction[]` the cascade actually applied, never by what it
 * decided: `applyRoomShareDeath` downgrades a `cancel` that lost a race to a
 * `skip`, and a mail telling somebody their request was cancelled when it was
 * not is worse than no mail.
 *
 * **Accounting is told for two different reasons, and both are the user's
 * ruling rather than the plan's:**
 *
 * - a cascade **cancelled** a request that had already reached `Completed` —
 *   spec §2's accepted cost. `wasCompleted` on the action is what says so,
 *   because by the time this runs the row reads `Cancelled`;
 * - a **`Completed` guest was re-dated and its money could not follow.**
 *   `perDiemWritable` refuses to reprice a figure accounting has signed, and
 *   that refusal stays — conservative on money already paid. The consequence
 *   is that the record ends up reading one range while the payment was
 *   computed on another, with only a `locked: true` activity row saying so.
 *   Without this mail the conservative choice would also be the silent one,
 *   which is the worse of the two.
 *
 * The predicate for the second is `perDiemWritable(status)`, not
 * `status === "Completed"`, so it stays true of whatever terminal status is
 * added to that allow-list's complement next — and it is read from the
 * database rather than from the action, because a re-date leaves the status
 * alone.
 */
export async function queueRoomShareCascadeMails(
  runner: SqlRunner,
  hostRequestId: number,
  actions: readonly GuestAction[],
): Promise<void> {
  // An explicit predicate rather than a bare `a.kind === … || …`: the loop
  // below reads `action.from` on the re-date arm, which only typechecks while
  // `skip` has been removed from the union. A plain filter leaves that to
  // TypeScript's inferred type predicates, which is a silent dependency on the
  // compiler version rather than on anything this file states.
  //
  // `detach` joined the union for final review C1 and is filtered in here
  // beside the other two — and the compiler is what made that unmissable:
  // widening `Exclude<…, { kind: "skip" }>` without adding the arm below
  // broke `action.from` on the re-date branch at once, which is exactly the
  // backstop this shape was written for. A mail is owed on a detach for the
  // same reason one is owed on a cancel: the guest never asked for either,
  // and the detach also leaves them a required field to answer.
  const affected = actions.filter(
    (a): a is Exclude<GuestAction, { kind: "skip" }> =>
      a.kind === "cancel" || a.kind === "redate" || a.kind === "detach",
  );
  // The overwhelmingly common case — a host with no guests, or a cascade that
  // skipped every one of them — costs nothing beyond this test.
  if (affected.length === 0) return;

  const ids = affected.map((a) => a.requestId);
  ids.push(hostRequestId);
  const facts = await loadFacts(runner, ids);
  const host = toParty(facts.get(hostRequestId), hostRequestId);

  // The ROSTER READ is what is deferred, not this map: it takes a second pool
  // connection, and most cascades touch nothing accounting has signed, so it
  // must not happen until some guest actually needs it. Keyed on brand because
  // one host's guests can be filed under different ones.
  const accountingFor = new Map<string, string[]>();
  const recipientsFor = async (brandCode: string | null): Promise<string[]> => {
    const key = brandCode ?? "";
    const cached = accountingFor.get(key);
    if (cached) return cached;
    const list = await accountingRecipients(brandCode);
    accountingFor.set(key, list);
    if (list.length === 0) {
      // Loud rather than silent: an accounting-grade event with nobody on the
      // roster to receive it means the mitigation did not reach anybody, and
      // the only remaining record is the activity row.
      console.error(
        "[acc/travel-booking/room-share] no active AccBookingApprover can be told about a " +
          `room-share cascade on brand ${brandCode ?? "(none)"} — host request ${hostRequestId}`,
      );
    }
    return list;
  };

  for (const action of affected) {
    const guestFacts = facts.get(action.requestId);
    const guest = toParty(guestFacts, action.requestId);

    if (action.kind === "detach") {
      // No accounting arm, and that is not an omission: a detach only ever
      // happens to a `Draft` or `Returned` request, so there is no signed
      // figure for accounting to reconcile — the two accounting mails exist
      // for money that has already been approved or paid.
      await queueOne(runner, guestFacts?.email ?? null, action.requestId, {
        kind: "RoomShareGuestDetached",
        subjectOf: guest,
        counterpart: host,
        previousStatus: action.previousStatus,
      });
      continue;
    }

    if (action.kind === "cancel") {
      await queueOne(runner, guestFacts?.email ?? null, action.requestId, {
        kind: "RoomShareGuestCancelled",
        subjectOf: guest,
        counterpart: host,
        previousStatus: action.previousStatus,
      });

      if (action.wasCompleted) {
        for (const to of await recipientsFor(guestFacts?.brandCode ?? null)) {
          await queueOne(runner, to, action.requestId, {
            kind: "RoomShareAccountingCancelled",
            subjectOf: guest,
            counterpart: host,
            previousStatus: action.previousStatus,
          });
        }
      }
      continue;
    }

    await queueOne(runner, guestFacts?.email ?? null, action.requestId, {
      kind: "RoomShareGuestRedated",
      subjectOf: guest,
      counterpart: host,
      previousDates: action.from,
    });

    // The ruling this module exists for as much as for the cancel case: the
    // dates moved, the money did not, and nothing else says so out loud.
    if (guestFacts && !perDiemWritable(guestFacts.status)) {
      for (const to of await recipientsFor(guestFacts.brandCode ?? null)) {
        await queueOne(runner, to, action.requestId, {
          kind: "RoomShareAccountingRedated",
          subjectOf: guest,
          counterpart: host,
          previousDates: action.from,
        });
      }
    }
  }
}
