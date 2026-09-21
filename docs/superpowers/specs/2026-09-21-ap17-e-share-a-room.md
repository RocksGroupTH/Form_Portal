# AP-17 package E — พักห้องเดียวกับ

Design, 2026-09-21. Approved by the user the same day.

Item 5 of the AP-17 batch, and larger than the other four together. It is the
first place in this application where **one person's request is bound to
another person's**, and where one request's fate moves another's without anybody
acting on the second.

---

## 1. What it is

On the accommodation section, beside choosing a room, a requester can instead
press **พักห้องเดียวกับ**, pick a colleague, and pick one of that colleague's
AP-17 requests. They then book nothing themselves and share the host's room.

**And they still get per diem.** Package B's rule is that no accommodation
booking means no per-diem days; this is its one exception, stated by the user
when the feature was described — *"(ถ้าเลือกอันนี้จะได้เบี้ยเลี้ยง)"*.

Terms used throughout: the **host** is the person whose booking exists; the
**guest** is the person who attached to it.

---

## 2. The four decisions, and what each costs

| question | answer | source |
|---|---|---|
| Who may a guest pick? | **anyone in the company** | user, 2026-09-21 |
| Does the host consent? | **no — but they are told** | user, same day |
| Host cancelled → guest? | **cancelled too, in every case** | user, same day |
| Host's dates change → guest? | **dates follow, per diem recomputed, approval NOT reset** | user, same day |

Three of those are worth their own paragraph because each gives up something.

**No consent.** A guest attaches themselves to a document they do not own and
draws money on the strength of it, and the host learns afterwards. Accepted
because the host's own manager and the guest's own manager both still approve
their own sides — nobody is paid without an approval, only without the host's
say-so about the room. Mitigated only by notification (§5).

**Cancel in every case.** A guest whose request is `Completed` and whose per
diem has been paid is flipped to `Cancelled` when the host cancels. This is the
direction `perdiem-window.ts` exists to prevent — its allow-list is deliberately
`Draft`/`Submitted`/`ManagerApproved`/`Returned` precisely because *"overwriting
a figure somebody has already been paid on is the expensive direction to be
wrong in"*. The user chose it knowing that. It is therefore **not silent**:
every cascade writes an activity row naming the host request, and mails
accounting as well as the guest (§5). A cancelled-after-payment request is an
accounting problem the moment it happens, and the system says so rather than
leaving a reconciliation to be discovered.

**Dates follow without re-approval.** A manager approved 20–24 and the guest
ends up travelling 25–30, with no one reviewing the change. Accepted for
throughput. The per diem *is* recomputed, so the money follows the dates — and
the activity row records the old and new range, so the manager who approved the
first one can see what it became.

---

## 3. Storage

One new table, transactional, in **both** form databases:

```
AccTravelRoomShare
  Id               INT IDENTITY  PK
  GuestRequestId   INT NOT NULL  -- FK AccRequest(Id), the request that attached
  HostRequestId    INT NOT NULL  -- FK AccRequest(Id), the request with the booking
  HostStaffId      INT NULL      -- denormalised for display; identity is the request
  CreatedAt / CreatedBy
```

**Transactional, so it follows migration 061/064's rule**: it needs an identity
floor of 900000 in the UAT database and the matching `CHECK`, like the other 23
transactional tables — a share row's id never appears in a URL, but its two FKs
point at `AccRequest.Id`, which is exactly the id space those migrations
protect.

**Not dual-written and not in `MASTER_TABLES`.** It is per-request data, not
configuration; `check:alignment` must still read **30**.

**A guest has at most one host** — a unique index on `GuestRequestId`. Sharing
two rooms is not a thing, and the constraint is what stops a half-finished
change of mind leaving two rows.

**Chains are refused.** A guest's request may not itself be a host. One hop
only, enforced at insert: the cascade in §4 is hard enough to reason about at
depth one, and a cycle (A hosts B hosts A) would make cancellation
non-terminating. Refuse with a Thai message naming the request that is already
a guest.

---

## 4. The cascade

Two triggers, both inside the transaction that changes the host.

**Host cancelled or rejected** — `cancelByRequester`, `rejectRequest`,
`rejectByAdmin`, `rejectByAccount` — every live guest of that host is cancelled,
whatever its status, and each gets an activity row
`cancelled_by_room_share_host` carrying the host's running number and its own
previous status.

**Host's travel dates change** — every live guest's depart and return dates are
rewritten to the host's, its per diem recomputed through the existing
`recomputeGroupPerDiem`, and an activity row `dates_followed_room_share_host`
records both ranges. Status and approvals are untouched.

**The cascade runs in the host's transaction.** If it fails, the host's own
cancellation rolls back. That is the right direction: a host cancelled while its
guests survive is the state this feature exists to prevent, and it is worse than
a cancellation the user has to retry.

**A guest that is already `Cancelled` or `Rejected` is skipped**, not
re-cancelled — the same `alive` test `continuation-chain.ts` uses.

**Package B's widened chain sees these rows too.** A guest's travel dates now
count toward that StaffId's own duplicate-date check and continuation chain,
because they are that person's travel days like any other. Nothing special is
needed — but the date-following cascade can therefore *create* an overlap that
§2 of package B would have refused at submit. That is accepted and must not be
made an error: the guest did not choose it, and blocking the host's date change
because of a collision in someone else's calendar would be worse. It is logged
in the same activity row.

---

### The guest's ID card — an interaction with package C, decided here

Package C makes the ID card conditional on the selected booking options'
`RequiresIdCard` flag. **A guest selects no accommodation option at all**, so
the flag is never true on that account and the guest is asked for no card —
while sleeping in a hotel room that, for the host, required one.

**That is the intended outcome and not an oversight.** The booking is the
host's; the hotel holds the host's identification against it. The guest is not
a party to the reservation and the company is not submitting their document to
anybody.

Two things follow, and both are requirements rather than observations:

- the guest's other selections still count — a guest who also books a ticket or
  a rental car is asked for a card on *that* account, through C's ordinary rule.
  Nothing about sharing a room suppresses it;
- if it ever turns out a supplier wants both names, the fix is a
  `RequiresIdCard` flag on the share itself, **not** a special case in
  `deriveBookingFlags`. Recorded so the next person reaches for the setting
  rather than the hardcode.

## 5. Notification

The host has no veto, so notification is the entire protection, and all three
go through the existing `AccEmailQueue` and `buildTravelBookingEmail`:

- **to the host**, when a guest attaches — naming the guest and the dates, so an
  unexpected one is visible immediately rather than at check-in;
- **to the guest**, when their request is cancelled or re-dated by the host;
- **to accounting**, when a cascade cancels a request that had already reached
  `Completed` — the case §2 accepted, surfaced to the desk that has to unwind it.

---

## 6. Picking a host

The picker takes a person, then one of their requests. The user asked for it to
**filter by travel date or by request date**.

Default it to the **travel dates the guest has already entered**, since the
overwhelmingly common case is two people on the same trip. Request date is the
fallback for someone who knows when the colleague filed but not when they
travel.

**Only requests that can host are offered**: live, not already a guest, and
carrying an accommodation booking (`needsRoomBooking = true`) — attaching to
somebody who booked no room gives the guest neither a bed nor a defensible
per-diem claim.

**Company-wide search reuses `/api/users/search`**, the same directory search
the on-behalf picker uses. Listing another person's requests is new reach and
gets its own endpoint returning **only** what the picker needs — running number,
dates, work location. Not the amount, not the attachments, not the ID card.
`decideRequestRead` still governs opening the record itself; this endpoint never
becomes a way around it.

---

## 7. Testing

Pure modules first, because the cascade cannot be unit-tested through a pool:

| module | owns |
|---|---|
| `travel-booking/room-share-policy.ts` | may this request host? may this one be a guest? is this a chain or a cycle? |
| `travel-booking/room-share-cascade.ts` | given a host's change and its guests' current states, what happens to each — cancel, re-date, or skip |

Cases that must exist: a guest at each status including `Completed`; a guest
already cancelled being skipped; a chain refused; a cycle refused; a host with
no guests; a date change that creates an overlap being allowed and logged.

Then source-reading guards for what only the call sites can express — that all
four cancellation paths invoke the cascade, and that it is inside their
transaction rather than after the commit. That failure is a missing call, and a
missing call is what a behavioural test of the four cannot see.

---

## 8. Out of scope

- **Any approval flow for the host.** Consent was considered and declined.
- **Splitting a room's cost.** The host pays the booking; the guest books
  nothing. No money moves between the two requests.
- **More than one guest per host.** Not restricted — several guests may attach
  to one host, and the cascade already iterates. What is restricted is depth.
- **Backfilling.** Existing requests have no shares.
