"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarRange,
  Hash,
  Hotel,
  Link2Off,
  Loader2,
  MapPin,
  RotateCw,
  Search,
  Users,
} from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { RequesterPickerBody, type RequesterOption } from "@/components/RequesterPickerBody";
import { fmtYmdDisplay } from "@/features/accounting/lib/format-travel-dates";
import { ROOM_SHARE_AGREEMENT_LINE } from "@/features/travel-booking/constants";
import { defaultHostFilterRange } from "@/features/travel-booking/lib/host-filter-range";
import { DateRangeField } from "./DateRangeField";
import { inputStyle, labelClass, labelStyle } from "./shared";
import type {
  HostCandidateRow,
  RoomShareView,
} from "@/lib/acc/travel-booking/room-share-service";

/**
 * พักห้องเดียวกับ — the control that attaches this trip to a colleague's
 * booking, and the one that undoes it (AP-17 package E, spec §1 and §6).
 *
 * ## It REPLACES choosing an accommodation, and the parent is what enforces that
 *
 * A guest books nothing: that is the whole feature. So attaching is not a
 * field added beside ที่พักค้างคืน, it is the alternative to it —
 * `TravelBookingTab` renders this component *instead of* the accommodation
 * grid once the tab is a guest, and clears `accommodationId` in the same patch
 * that sets the flag. **Neither half is cosmetic.** Leaving the grid on screen
 * would invite a state with a room booked and a room shared, which nothing
 * downstream knows how to price; leaving a stale `accommodationId` in the tab
 * would post it on the next save and hand `deriveBookingFlags` a live answer
 * to a question the requester has withdrawn — the same failure
 * `selectVehicleBoth` clears the rent fields to avoid.
 *
 * ## The warning is the only one anybody gets
 *
 * The host does not consent (spec §2). `ROOM_SHARE_AGREEMENT_LINE` is
 * therefore shown *before* the choice, inside the picker, and again on the
 * attached card — not tucked under a "read more". See its own docblock.
 *
 * ## Picking is an EDIT, not a POST (reworked 2026-09-22)
 *
 * This is the change that makes the rest of the file read differently from
 * package E's original. It used to attach on the spot, which is why it needed
 * a saved draft at all: the attach POSTed to `/room-share/{guestRequestId}`
 * and an unsaved tab has no `AccRequest.Id`. First the button was made to save
 * the draft itself; the user then asked for the whole arrangement to go.
 *
 * So picking a host now **sets tab state** — `roomShareHostRequestId`, through
 * `room-share-choice.ts`'s one patch — and the binding is written by the tab's
 * own save, inside the transaction that writes everything else about the trip
 * (`applyRoomShareSelection`). Clearing the choice clears the row on the same
 * save. There is no attach endpoint, no auto-save and no `onRequireSave`.
 *
 * **The picker therefore opens against nothing at all**, which is exactly what
 * the user asked for in point 1 — press it and search.
 *
 * ## What that changed about authorization, stated rather than implied
 *
 * The hosts endpoint used to take the caller's own request id in its path and
 * authorize `authorizeAccRequest(…, "mutate", AP-17)` against it. That gate is
 * **gone**: browsing is `requireAuth` at
 * `/api/request/travel-booking/room-share/hosts`, so any authenticated
 * employee can list a colleague's hostable AP-17 requests — their running
 * numbers, travel dates and work locations — and look one up by number. The
 * user asked twice for the friction; the route's own docblock records the
 * residual in full.
 *
 * **The write kept its gate.** The save route is `authorizeAccRequest(…,
 * "mutate", AP-17)`, the group save re-asserts creator-and-`Draft`/`Returned`
 * for every tab, and `applyRoomShareSelection` re-asserts it a third time
 * in-transaction under `UPDLOCK, HOLDLOCK`. Binding two people's documents is
 * the act that needed the gate and it still has it.
 *
 * ## One dialog, two steps (merged 2026-09-22)
 *
 * The person search used to be a **second, stacked dialog** —
 * `RequesterPickerModal`, portalled to `document.body` at `z-[80]` over this
 * one, which had to close itself (`open={pickerOpen && !personModalUp}`)
 * while it was up. The user asked for the two to become one: "อยากปรับให้ 2
 * หน้านี้รวมกัน". So `RequesterPickerBody` — the modal's frame-less half,
 * extracted rather than copied — is rendered **inline on the เลือกเพื่อนร่วมงาน
 * tab**, and no second modal opens at any point.
 *
 * **Which step is showing is now ONE value: `person === null`.** That is the
 * whole reason the merge is worth doing beyond the click it saves. The old
 * arrangement needed `personOpen` *and* `person` to agree, and they silently
 * did not: `RequesterPickerModal` calls `onClose()` immediately after
 * `onSelect()`, so `personOpen` was already false by the time step 2
 * rendered, and `← เปลี่ยนคน` clearing `person` alone closed the whole picker
 * instead of going back a step (shipped in package E, fixed in `2972e26`).
 * With `personOpen` gone there is no second value left to disagree —
 * `← เปลี่ยนคน` is `setPerson(null)` and nothing else.
 *
 * ## Two fetch surfaces, both pre-existing, neither widened
 *
 * The person search is `/api/request/travel-booking/requesters`, the HR-backed
 * roster search the on-behalf เปลี่ยนผู้ขอเบิก picker already uses, reached
 * through the very same `RequesterPickerBody` — the frame-less half of
 * `RequesterPickerModal`, rendered here *inline on the first tab* rather than
 * as a dialog of its own (see "One dialog, two steps" below). Spec §6 names
 * `/api/users/search` instead; that route is
 * `requireRole(["IT Admin","System Admin"])`, so an ordinary requester cannot
 * call it at all and following the spec literally would 403 for almost
 * everybody. This one is `requireAuth` and answers a `staffId`, which is
 * exactly what the hosts endpoint takes.
 *
 * The request list returns the running number, the travel dates and the work
 * location and deliberately nothing else (spec §6 — not the amount, not the
 * attachments, not the ID card). `HostCandidateRow` is imported as a **type**
 * from the service so this component cannot invent a field the endpoint does
 * not send; `room-share-response-shape-guard.test.ts` pins the other end.
 */

/* ─────────────────────────── display helpers ─────────────────────────── */

/**
 * A trip's dates as one label.
 *
 * `fmtYmdDisplay` splits the `YYYY-MM-DD` string on its dashes — no `Date`
 * parsing and no `toISOString`, which is the house rule for these Thai
 * wall-clock dates.
 */
function fmtTripRange(from: string | null, to: string | null): string {
  if (!from && !to) return "ยังไม่ระบุวันเดินทาง";
  if (from && to && from !== to) return `${fmtYmdDisplay(from)} – ${fmtYmdDisplay(to)}`;
  return fmtYmdDisplay((from ?? to) as string);
}

function personLabel(person: RequesterOption | null, staffId: number | null): string {
  if (person?.fullName) return person.fullName;
  if (person) return `#${person.staffId}`;
  return staffId == null ? "เพื่อนร่วมงาน" : `#${staffId}`;
}

/**
 * The colleague's HR row, for a name to put beside the running number.
 *
 * Tries the already-loaded department list first, then the roster endpoint's
 * `?staffId=` mode — the mode that exists precisely because "the requester it
 * is showing may not be in the department list at all", a colleague found
 * through the whole-company search being exactly that case. A failure degrades
 * to an id-only stand-in rather than throwing: a host whose name could not be
 * read is still a host, and the running number is what identifies the booking.
 */
async function resolvePerson(
  staffId: number,
  colleagues: RequesterOption[],
): Promise<RequesterOption> {
  const known = colleagues.find((c) => c.staffId === staffId);
  if (known) return known;
  try {
    const res = await fetch(`/api/request/travel-booking/requesters?staffId=${staffId}`);
    const json = await res.json();
    const one = json?.ok
      ? ((json.data?.colleagues ?? [])[0] as RequesterOption | undefined)
      : undefined;
    if (one) return one;
  } catch {
    /* fall through */
  }
  return { staffId, fullName: null };
}

/* ─────────────────────────── the agreement line ─────────────────────────── */

/**
 * The terms, rendered identically before and after the choice.
 *
 * Amber on the card-alt fill rather than the blue `--nav-active-bg` the
 * neighbouring "ทีม Admin จะจองห้องพักให้" chip uses: that chip reports a
 * service being performed, this one reports a consequence the requester is
 * taking on. `--text-warning` is the token the ฿0-day notes on this same form
 * already use for exactly that distinction.
 */
function AgreementLine() {
  return (
    <div
      className="flex items-start gap-2 text-[12px] font-medium rounded-lg px-3 py-2 leading-relaxed"
      style={{
        background: "var(--bg-card-alt)",
        color: "var(--text-warning)",
        border: "1px solid var(--border-card)",
      }}
    >
      <AlertTriangle size={14} className="shrink-0 mt-[1px]" />
      <span>{ROOM_SHARE_AGREEMENT_LINE}</span>
    </div>
  );
}

/* ─────────────────────────── loaded-binding state ─────────────────────────── */

/**
 * What this component knows about the **stored** binding — which is no longer
 * the same question as "is this tab a guest".
 *
 * Since picking is an edit, the tab can hold a host that no row records yet,
 * and `absent` is the ordinary state for exactly that. A closed union rather
 * than a row plus two booleans, because "not saved yet", "still loading" and
 * "could not be read" have to render differently and are trivially conflated
 * by a `loading` flag beside a nullable row.
 */
type ShareState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; view: RoomShareView }
  | { kind: "absent" }
  | { kind: "error" };

/** Which half of the picker is in front. */
type PickMode = "person" | "number";

export interface RoomShareControlProps {
  /** `AccRequest.Id` for this tab — null until the draft has been saved once. */
  requestId: number | null;
  /**
   * `TabFormState.roomShareHostRequestId` — the tab's current choice, saved or
   * not. This component never guesses it and never writes it directly; it
   * hands a host to `onChoose` and the parent applies
   * `room-share-choice.ts`'s patch.
   */
  hostRequestId: number | null;
  /** The actor's department, already loaded by the form — the picker's starting list. */
  colleagues: RequesterOption[];
  /** A host was picked. The parent records it, clears the accommodation, and takes the host's dates. */
  onChoose: (host: HostCandidateRow) => void;
  /** The choice is withdrawn. The parent clears the flag; the accommodation stays unchosen. */
  onClear: () => void;
}

export function RoomShareControl({
  requestId,
  hostRequestId,
  colleagues,
  onChoose,
  onClear,
}: RoomShareControlProps) {
  const [share, setShare] = useState<ShareState>({ kind: "idle" });
  const [savedPerson, setSavedPerson] = useState<RequesterOption | null>(null);
  /**
   * The row the picker handed over, kept so the card can render **before any
   * save**.
   *
   * Keyed by the host's own id and used only while it matches the tab's
   * current choice. That is what stops it leaking across tabs: this component
   * is not remounted when the form switches tab — same element type, same
   * position — so a cache that trusted itself would show tab 1 the host tab 0
   * picked.
   */
  const [chosen, setChosen] = useState<{ host: HostCandidateRow; person: RequesterOption | null } | null>(null);

  /* ── the picker ── */
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickMode, setPickMode] = useState<PickMode>("person");
  /**
   * The colleague whose requests step 2 lists — and, since the two dialogs
   * merged, **the only thing that says which step of the person tab is
   * showing**: null is the search, set is the list. There is deliberately no
   * second `personOpen` beside it; see this file's header for the bug the two
   * of them used to be able to disagree about.
   */
  const [person, setPerson] = useState<RequesterOption | null>(null);
  const [hosts, setHosts] = useState<HostCandidateRow[] | null>(null);
  const [hostsLoading, setHostsLoading] = useState(false);
  const [hostsError, setHostsError] = useState<string | null>(null);
  /**
   * The server's refusal or its "no such number", verbatim.
   *
   * `room-share-policy.ts` answers every refusal with a Thai sentence naming
   * the specific reason — the colleague booked no room, that request is
   * already somebody's guest, it is cancelled — and the service adds one more
   * for a host that has never been filed. Those sentences arrive here as the
   * `notice` field of the hosts response and are rendered as they came.
   * **Nothing is re-worded or re-derived on this side**: a second vocabulary
   * for the same closed set of reasons is how the picker starts telling a
   * requester something the server did not say.
   */
  const [notice, setNotice] = useState<string | null>(null);

  /** `travel` is the default; `requested` is the fallback filter (spec §6). */
  const [mode, setMode] = useState<"travel" | "requested">("travel");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  /** Point 3 — the fetched list is filtered by running number as the requester types. */
  const [listQuery, setListQuery] = useState("");
  /** Point 2 — the running number typed on the second tab. */
  const [numberQuery, setNumberQuery] = useState("");
  /**
   * Bumped to re-run the fetch with the inputs unchanged — what "ลองใหม่"
   * needs and what re-setting a state value to itself cannot give: React bails
   * out of an identical `useState` write, so no render happens, no dependency
   * changes, and the retry button does nothing at all.
   */
  const [reload, setReload] = useState(0);

  /* ── the tab's own STORED binding ── */

  useEffect(() => {
    if (requestId == null || hostRequestId == null) {
      setShare({ kind: "idle" });
      setSavedPerson(null);
      return;
    }
    let cancelled = false;
    setShare((prev) => (prev.kind === "ready" ? prev : { kind: "loading" }));
    fetch(`/api/request/travel-booking/room-share/${requestId}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (!json?.ok) setShare({ kind: "error" });
        // `data: null` is no longer an error. The tab holds an unsaved choice
        // far more often than it holds a binding that went away under it, and
        // the two look identical from here — so the card says "not saved yet",
        // which is true of both and is the one a requester can act on. (If a
        // cascade really did detach it, the next save simply re-creates the
        // binding, or refuses with the policy's own reason.)
        else if (!json.data) setShare({ kind: "absent" });
        else setShare({ kind: "ready", view: json.data as RoomShareView });
      })
      .catch(() => {
        if (!cancelled) setShare({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [requestId, hostRequestId]);

  /**
   * The stored binding, but only while it is the host the tab currently
   * chooses.
   *
   * After a change of mind the server still answers the *previous* host until
   * the next save; rendering that would show the requester a card naming
   * somebody they have just replaced.
   */
  const savedView =
    share.kind === "ready" && hostRequestId != null && share.view.host.requestId === hostRequestId
      ? share.view
      : null;
  const localChoice = chosen && chosen.host.requestId === hostRequestId ? chosen : null;
  const hostRow = savedView?.host ?? localChoice?.host ?? null;

  /* ── the host's name, once the stored binding is known ── */

  /**
   * **`colleagues` must not be a dependency of the effect below**, and this ref
   * is why.
   *
   * The form builds it as `requesterOptsData?.colleagues ?? []`, so while that
   * SWR read is in flight it is **a new empty array on every render**. An
   * effect depending on its identity would therefore fire, `resolvePerson`
   * would miss the empty list and fetch, `setSavedPerson` would re-render, and
   * the whole thing would go round again — a fetch loop for as long as the
   * roster takes to arrive. The list is only a cache-hit shortcut here, so
   * reading whatever the last render had is exactly as correct and cannot
   * loop.
   */
  const colleaguesRef = useRef(colleagues);
  colleaguesRef.current = colleagues;

  const savedStaffId = savedView?.hostStaffId ?? null;
  useEffect(() => {
    if (savedStaffId == null) {
      setSavedPerson(null);
      return;
    }
    let cancelled = false;
    resolvePerson(savedStaffId, colleaguesRef.current).then((p) => {
      if (!cancelled) setSavedPerson(p);
    });
    return () => {
      cancelled = true;
    };
  }, [savedStaffId]);

  const hostPerson = savedPerson ?? localChoice?.person ?? null;

  /* ── the picker's list ── */

  /** The colleague the list is for — the id alone, which is all the fetch reads. */
  const personStaffId = person ? person.staffId : null;

  useEffect(() => {
    if (!pickerOpen) return;
    const byNumber = pickMode === "number";
    const trimmedNo = numberQuery.trim();
    // Three characters before the first lookup: one or two match nothing and
    // would be a round trip per keystroke while somebody types "TRL".
    if (byNumber && trimmedNo.length < 3) {
      setHosts(null);
      setNotice(null);
      setHostsError(null);
      setHostsLoading(false);
      return;
    }
    /* No colleague chosen is no query, so there are no results — the same
       thing the under-three-characters branch above says for the number tab.
       **Clearing here rather than in `← เปลี่ยนคน` is deliberate**: the list
       is stale the moment its subject is gone, whatever made it gone, and a
       clear attached to one button is a clear the next way back forgets. It
       matters because the search step and the list step are now inside ONE
       dialog: before the merge, stepping back closed the dialog holding these
       rows, so nobody saw the previous colleague's requests survive. */
    if (!byNumber && personStaffId == null) {
      setHosts(null);
      setNotice(null);
      setHostsError(null);
      setHostsLoading(false);
      return;
    }

    let cancelled = false;
    setHostsLoading(true);
    setHostsError(null);
    setNotice(null);
    const params = new URLSearchParams();
    if (byNumber) {
      params.set("requestNo", trimmedNo);
    } else {
      params.set("staffId", String(personStaffId));
      if (mode === "travel") {
        if (from) params.set("travelFrom", from);
        if (to) params.set("travelTo", to);
      } else {
        if (from) params.set("requestedFrom", from);
        if (to) params.set("requestedTo", to);
      }
    }
    // Only ever narrows — it drops this tab's own request out of the list, and
    // answers the policy's own self-attach sentence on the number tab. Absent
    // while the tab has not been saved, which is now the ordinary state.
    if (requestId != null) params.set("excludeRequestId", String(requestId));

    // Debounced: a date input fires per keystroke in some browsers, and both
    // modes scan behind a database round trip.
    const timer = setTimeout(() => {
      fetch(`/api/request/travel-booking/room-share/hosts?${params.toString()}`)
        .then((r) => r.json())
        .then((json) => {
          if (cancelled) return;
          if (!json?.ok) {
            setHosts([]);
            setHostsError(json?.error ?? "โหลดรายการคำขอไม่สำเร็จ");
            return;
          }
          const data = json.data as { hosts?: HostCandidateRow[]; notice?: string | null };
          setHosts(data?.hosts ?? []);
          setNotice(data?.notice ?? null);
        })
        .catch(() => {
          if (cancelled) return;
          setHosts([]);
          setHostsError("โหลดรายการคำขอไม่สำเร็จ");
        })
        .finally(() => {
          if (!cancelled) setHostsLoading(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // Keyed on the colleague's STAFF ID, never on the `person` object: it is
    // set twice for one choice — an id-only stand-in and then the resolved HR
    // row — and the second carries no information this fetch reads, so
    // depending on the object identity would run the whole scan again for a
    // name change.
  }, [pickerOpen, pickMode, personStaffId, mode, from, to, numberQuery, requestId, reload]);

  /**
   * Is there a query for the request list to be the answer to?
   *
   * The number tab always is one; the person tab only once a colleague has
   * been chosen. **This exists because of the merge**: the search step and the
   * list step now share one dialog, so the list region — its `min-h-[120px]`
   * reservation included — would otherwise sit under the colleague search as
   * a slab of blank space, and would render the *previous* colleague's
   * requests for as long as it took the effect above to clear them.
   */
  const hostListWanted = pickMode === "number" || person !== null;

  /** Point 3 — filtered in the browser over what was already fetched. */
  const shownHosts = useMemo(() => {
    const rows = hosts ?? [];
    const q = listQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((h) => (h.requestNo ?? "").toLowerCase().indexOf(q) !== -1);
  }, [hosts, listQuery]);

  /* ── opening and closing ── */

  /**
   * Press → the picker, with nothing in between.
   *
   * No save, no id, no gate to satisfy: browsing is `requireAuth` and the
   * binding is written by the tab's own save later. The whole of the previous
   * arrangement — `onRequireSave`, the `opening` spinner, the `openFailed`
   * banner and the "ระบบจะบันทึกร่างให้ก่อน" note — went with it.
   */
  const openPicker = useCallback(() => {
    setPickerOpen(true);
    setPickMode("person");
    setPerson(null);
    setHosts(null);
    setHostsError(null);
    setNotice(null);
    setListQuery("");
    setNumberQuery("");
    // Today … today + 30. It no longer opens on the guest's own dates: the
    // picker now WRITES the host's dates into the tab (final review I4), so
    // seeding the search from a value it is about to overwrite is circular —
    // and the tab may legitimately have no dates at all by this point.
    setMode("travel");
    const range = defaultHostFilterRange(new Date());
    setFrom(range.from);
    setTo(range.to);
  }, []);

  const closePicker = useCallback(() => {
    setPickerOpen(false);
    setPerson(null);
    setHosts(null);
    setHostsError(null);
    setNotice(null);
    setListQuery("");
    setNumberQuery("");
  }, []);

  /**
   * Switching filter mode re-seeds the dates, since the two mean different
   * things.
   *
   * **The current value is read from the closure, not from a `setMode`
   * updater.** A `useState` updater must be pure: `reactStrictMode` is unset
   * in `next.config.mjs`, which means ON, so development invokes updaters
   * twice — and side effects inside one therefore run twice. Harmless for
   * idempotent setters like these and wrong anyway; the same trap the
   * `aliveRef` note in CLAUDE.md records being bitten by.
   */
  const switchMode = useCallback(
    (next: "travel" | "requested") => {
      if (next === mode) return;
      setMode(next);
      if (next === "travel") {
        const range = defaultHostFilterRange(new Date());
        setFrom(range.from);
        setTo(range.to);
      } else {
        // "filed on" is a window in the PAST — a default reaching thirty days
        // forward would be a range nothing can fall in. Cleared rather than
        // guessed: inventing a backwards window here would be policy nobody
        // asked for.
        setFrom("");
        setTo("");
      }
    },
    [mode],
  );

  const switchPickMode = useCallback(
    (next: PickMode) => {
      if (next === pickMode) return;
      setPickMode(next);
      setHosts(null);
      setHostsError(null);
      setNotice(null);
      setListQuery("");
      // Nothing to reopen any more: the person tab renders its own search
      // inline whenever `person` is null, so selecting it with nobody chosen
      // IS the search. It used to have to push step 1's modal back up here,
      // or that tab was an empty panel with a button on it.
    },
    [pickMode],
  );

  /* ── choosing and clearing ── */

  const choose = useCallback(
    (host: HostCandidateRow) => {
      setChosen({ host, person: pickMode === "number" ? null : person });
      onChoose(host);
      closePicker();
    },
    [onChoose, closePicker, person, pickMode],
  );

  const clear = useCallback(() => {
    setChosen(null);
    setShare({ kind: "idle" });
    setSavedPerson(null);
    onClear();
  }, [onClear]);

  /* ─────────────────────────── attached ─────────────────────────── */

  if (hostRequestId != null) {
    return (
      <div data-field="roomShare" className="flex flex-col gap-2.5">
        <label className={labelClass} style={labelStyle}>
          <Users size={11} className="inline mr-1 -mt-0.5" />
          พักห้องเดียวกับ
        </label>

        {/* Only while there is genuinely nothing to draw. A tab that has just
            picked has `chosen` and renders the card straight away, with no
            round trip at all — the fetch below is for a RESUMED guest, whose
            host row this component has never seen. */}
        {hostRow === null && share.kind !== "error" && (
          <p className="text-[12.5px] m-0 flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
            <Loader2 size={13} className="animate-spin" /> กำลังโหลดข้อมูลห้องพักร่วม...
          </p>
        )}

        {hostRow === null && share.kind === "error" && (
          <p className="text-[12.5px] m-0" style={{ color: "var(--text-warning)" }}>
            โหลดข้อมูลห้องพักร่วมไม่สำเร็จ — กรุณาโหลดหน้านี้ใหม่
          </p>
        )}

        {hostRow !== null && (
          <div
            className="rounded-xl px-4 py-3 flex flex-col gap-2.5"
            style={{ background: "var(--bg-card-alt)", border: "1px solid var(--nav-active-text)" }}
          >
            <div className="flex items-start gap-3">
              <div className="shrink-0 rounded-full overflow-hidden">
                <Avatar
                  name={hostPerson?.fullName || "?"}
                  size={34}
                  photo={hostPerson?.photoUrl ?? undefined}
                  color="var(--nav-active-text)"
                />
              </div>
              <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                <p className="text-[13.5px] font-bold m-0 truncate" style={{ color: "var(--text-heading)" }}>
                  {personLabel(hostPerson, savedView?.hostStaffId ?? null)}
                </p>
                <p className="text-[12px] m-0 flex items-center gap-1.5 flex-wrap" style={{ color: "var(--text-secondary)" }}>
                  <Hotel size={12} className="shrink-0" />
                  <span className="font-semibold">{hostRow.requestNo ?? "—"}</span>
                  <span style={{ color: "var(--text-faint)" }}>·</span>
                  <CalendarRange size={12} className="shrink-0" />
                  {fmtTripRange(hostRow.departDate, hostRow.returnDate)}
                </p>
                {hostRow.workLocations.length > 0 && (
                  <p className="text-[11.5px] m-0 flex items-start gap-1.5" style={{ color: "var(--text-muted)" }}>
                    <MapPin size={11} className="shrink-0 mt-[2px]" />
                    <span className="min-w-0">{hostRow.workLocations.join(" · ")}</span>
                  </p>
                )}
              </div>
            </div>

            {/* The state, said out loud. The accommodation grid is not on
                screen while this card is, so without this line the requester
                is looking at a required field that has silently disappeared. */}
            <p className="text-[12px] m-0" style={{ color: "var(--text-secondary)" }}>
              คุณจะพักห้องเดียวกับคำขอนี้ จึงไม่ต้องเลือกที่พักค้างคืนของตัวเอง
            </p>

            {/* Said rather than hidden: the choice is an unsaved edit like
                every other field on this form, and a requester who closes the
                tab now loses it. The form's own บันทึกร่าง / ส่งคำขอ is what
                writes it — there is no longer an attach that fires on click. */}
            {savedView === null && (
              <p className="text-[11.5px] m-0 flex items-start gap-1.5" style={{ color: "var(--text-muted)" }}>
                <AlertTriangle size={11} className="shrink-0 mt-[2px]" />
                <span>ยังไม่ได้บันทึก — ระบบจะบันทึกการพักห้องร่วมเมื่อคุณกดบันทึกร่างหรือส่งคำขอ</span>
              </p>
            )}

            <AgreementLine />

            {/* Clearing is an edit too — the row goes on the next save, and the
                same Draft/Returned rule the save already enforces is what
                decides whether that is allowed. A request past Returned never
                renders this form at all. */}
            <div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={clear}
                icon={<Link2Off size={13} />}
              >
                ยกเลิกการพักห้องร่วม
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ─────────────────────────── not attached ─────────────────────────── */

  return (
    <div data-field="roomShare" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="h-px flex-1" style={{ background: "var(--border-card)" }} />
        <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>
          หรือ
        </span>
        <span className="h-px flex-1" style={{ background: "var(--border-card)" }} />
      </div>

      {/* Never disabled, and nothing happens first: the press opens the picker.
          The draft-save that used to sit in front of it is gone with the
          endpoint that needed it (see this file's header). */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          type="button"
          variant="secondary"
          size="md"
          onClick={openPicker}
          icon={<Users size={14} />}
        >
          พักห้องเดียวกับเพื่อนร่วมงาน
        </Button>
      </div>
      <p className="text-[11.5px] m-0" style={{ color: "var(--text-muted)" }}>
        เลือกแทนการจองห้องพักเอง — ใช้ห้องของเพื่อนร่วมงานที่จองไว้แล้ว และยังได้รับเบี้ยเลี้ยง
      </p>

      {/* ONE dialog, both steps. Two tabs across the top: a colleague — whose
          search now sits inside this same panel — or a running number typed
          straight in (the user's point 2). */}
      <Dialog
        open={pickerOpen}
        onOpenChange={(next) => {
          // Escape or a click outside closes the WHOLE picker, both steps.
          // Reopening the person list instead would make Escape read as "go
          // back", which no other dialog in this app does — "← เปลี่ยนคน" is
          // the control for that.
          if (!next) closePicker();
        }}
        // While the range calendar is open the first Escape belongs to IT, not
        // to this dialog — `DateRangeField` marks itself in the DOM for
        // exactly this, and closes itself on the same keypress, so a second
        // Escape reaches the dialog as usual. Radix registers its handler when
        // the dialog mounts, before any panel exists, so refusing it here is
        // the only order-independent way.
        onEscapeKeyDown={(e) => {
          if (typeof document !== "undefined" && document.querySelector("[data-daterange-panel]")) {
            e.preventDefault();
          }
        }}
        title={
          pickMode === "number"
            ? "ระบุเลขที่คำขอ"
            : person
              ? `เลือกคำขอของ ${personLabel(person, person.staffId)}`
              : "เลือกคำขอที่จะพักห้องร่วม"
        }
        contentClassName="max-w-xl"
        scrollable={false}
      >
        <div className="px-5 py-4 flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto">
          <AgreementLine />

          {/* The two ways in. A requester who knows the number does not have
              to find the person first (point 2). */}
          <div className="flex items-center gap-1.5">
            {(["person", "number"] as const).map((m) => {
              const active = pickMode === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => switchPickMode(m)}
                  className="px-2.5 py-1.5 rounded-lg text-[12px] font-semibold cursor-pointer transition-all inline-flex items-center gap-1.5"
                  style={{
                    borderWidth: 1,
                    borderStyle: "solid",
                    borderColor: active ? "var(--nav-active-text)" : "var(--border-card)",
                    background: active ? "var(--nav-active-bg)" : "var(--bg-card-alt)",
                    color: active ? "var(--nav-active-text)" : "var(--text-secondary)",
                  }}
                >
                  {m === "person" ? <Users size={12} /> : <Hash size={12} />}
                  {m === "person" ? "เลือกเพื่อนร่วมงาน" : "ระบุเลขที่คำขอ"}
                </button>
              );
            })}
          </div>

          {pickMode === "number" ? (
            <div>
              <label className={labelClass} style={labelStyle}>
                เลขที่คำขอของเพื่อนร่วมงาน
              </label>
              <div
                className="flex items-center gap-2 rounded-lg px-3"
                style={{ ...inputStyle, paddingTop: 2, paddingBottom: 2 }}
              >
                <Search size={14} className="shrink-0" style={{ color: "var(--text-muted)" }} />
                <input
                  type="text"
                  value={numberQuery}
                  onChange={(e) => setNumberQuery(e.target.value)}
                  placeholder="เช่น TRL26-00100"
                  className="flex-1 text-[14px] outline-none bg-transparent py-2"
                  style={{ color: "var(--text-primary)" }}
                />
              </div>
              <p className="text-[11px] mt-1.5 m-0" style={{ color: "var(--text-faint)" }}>
                พิมพ์อย่างน้อย 3 ตัวอักษร — ระบบจะค้นหาคำขอที่พักห้องร่วมได้ให้อัตโนมัติ
              </p>
            </div>
          ) : (
            <>
              {person === null ? (
                /* Step 1, INLINE — no second dialog opens here any more. The
                   same roster search, the same 220 ms debounce and the same
                   `seq` staleness guard the on-behalf เปลี่ยนผู้ขอเบิก picker
                   uses, because it is literally the same component; only the
                   frame differs. `frame="inline"` drops the body's own
                   scroller so this dialog's single `overflow-y-auto` column
                   stays the one scroll region — two nested scrollers inside
                   one 90vh panel is what makes a picker unusable on a phone. */
                <div className="flex flex-col gap-2">
                  <p className="text-[12px] m-0" style={{ color: "var(--text-muted)" }}>
                    เลือกเพื่อนร่วมงานที่จองห้องพักไว้แล้ว
                  </p>
                  <RequesterPickerBody
                    frame="inline"
                    colleagues={colleagues}
                    // No "ตัวฉันเอง" row: this asks whose room, and your own
                    // is not one.
                    self={null}
                    value={null}
                    searchEndpoint="/api/request/travel-booking/requesters"
                    onSelect={(staffId) => {
                      if (staffId == null) return;
                      /* Set synchronously with the id alone, THEN refine with
                         the HR row. The id is the only thing the host fetch
                         needs, and it is what moves this tab on to step 2;
                         the name is for the heading, and arrives a round trip
                         later. Setting only the resolved row would leave the
                         search on screen for the whole of that fetch, after a
                         press that looked like it had done nothing. */
                      setPerson({ staffId, fullName: null });
                      resolvePerson(staffId, colleagues).then(setPerson);
                    }}
                  />
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {/* Travel date first, request date as the fallback — spec §6. */}
                  <div className="flex items-center gap-1.5">
                    {(["travel", "requested"] as const).map((m) => {
                      const active = mode === m;
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => switchMode(m)}
                          className="px-2.5 py-1 rounded-lg text-[12px] font-semibold cursor-pointer transition-all"
                          style={{
                            borderWidth: 1,
                            borderStyle: "solid",
                            borderColor: active ? "var(--nav-active-text)" : "var(--border-card)",
                            background: active ? "var(--nav-active-bg)" : "var(--bg-card-alt)",
                            color: active ? "var(--nav-active-text)" : "var(--text-secondary)",
                          }}
                        >
                          {m === "travel" ? "ตามวันเดินทาง" : "ตามวันที่ยื่นคำขอ"}
                        </button>
                      );
                    })}
                    {(from !== "" || to !== "") && (
                      <button
                        type="button"
                        onClick={() => {
                          setFrom("");
                          setTo("");
                        }}
                        className="ml-auto text-[11.5px] font-semibold cursor-pointer bg-transparent border-none"
                        style={{ color: "var(--nav-active-text)" }}
                      >
                        ล้างตัวกรองวันที่
                      </button>
                    )}
                  </div>

                  {/* ONE range control, the same one วันเดินทาง uses (point 3)
                      — two `dd/mm/yyyy` boxes were what it replaced.
                      `inline` because Radix makes a body-level portal
                      unclickable inside a modal; `required={false}` because
                      this is a filter and refuses nothing. */}
                  <DateRangeField
                    label={mode === "travel" ? "ช่วงวันเดินทาง" : "ช่วงวันที่ยื่นคำขอ"}
                    departDate={from || null}
                    returnDate={to || null}
                    onChange={(next) => {
                      setFrom(next.departDate ?? "");
                      setTo(next.returnDate ?? "");
                    }}
                    required={false}
                    inline
                  />

                  <div
                    className="flex items-center gap-2 rounded-lg px-3 mt-0.5"
                    style={{ ...inputStyle, paddingTop: 2, paddingBottom: 2 }}
                  >
                    <Search size={14} className="shrink-0" style={{ color: "var(--text-muted)" }} />
                    <input
                      type="text"
                      value={listQuery}
                      onChange={(e) => setListQuery(e.target.value)}
                      placeholder="ค้นหาเลขที่คำขอในรายการ..."
                      className="flex-1 text-[13px] outline-none bg-transparent py-2"
                      style={{ color: "var(--text-primary)" }}
                    />
                  </div>
                </div>
              )}
            </>
          )}

          {/* The server's refusal, verbatim — see `notice`'s own docblock.
              Gated on there being a query at all, with everything else below,
              so that stepping back to the search does not leave the previous
              colleague's answer sitting under it. */}
          {hostListWanted && notice && (
            <div
              className="flex items-start gap-2 text-[12px] font-medium rounded-lg px-3 py-2"
              style={{ background: "var(--bg-card-alt)", color: "var(--color-danger)" }}
            >
              <AlertTriangle size={14} className="shrink-0 mt-[1px]" />
              <span>{notice}</span>
            </div>
          )}

          {hostListWanted && hostsError && (
            <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--text-warning)" }}>
              <AlertTriangle size={13} className="shrink-0" />
              <span>{hostsError}</span>
              <button
                type="button"
                onClick={() => setReload((n) => n + 1)}
                className="inline-flex items-center gap-1 text-[11.5px] font-semibold cursor-pointer bg-transparent border-none"
                style={{ color: "var(--nav-active-text)" }}
              >
                <RotateCw size={11} /> ลองใหม่
              </button>
            </div>
          )}

          {/* The whole list region, `min-h-[120px]` included — the height is
              reserved so the dialog does not jump between "กำลังค้นหา" and the
              rows, which is only wanted once something has been asked for. On
              the search step it would be a slab of blank space under the
              colleague list.
              Hidden rather than unmounted: `display: none` takes it out of
              layout and out of reach of a click or the tab order just as
              unmounting would, and leaves this eighty-line block where it is
              instead of re-indenting all of it inside a conditional. */}
          <div className={hostListWanted ? "flex flex-col gap-1.5 min-h-[120px]" : "hidden"}>
            {hostsLoading && (
              <p className="py-8 text-center text-[12px] flex items-center justify-center gap-1.5" style={{ color: "var(--text-muted)" }}>
                <Loader2 size={13} className="animate-spin" /> กำลังค้นหา...
              </p>
            )}
            {!hostsLoading &&
              shownHosts.map((h) => (
                <button
                  key={h.requestId}
                  type="button"
                  onClick={() => choose(h)}
                  className="flex items-start gap-3 px-3 py-2.5 rounded-xl cursor-pointer text-left w-full transition-colors"
                  style={{
                    borderWidth: 1,
                    borderStyle: "solid",
                    borderColor: "var(--border-card)",
                    background: "var(--bg-card)",
                  }}
                >
                  <span
                    className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
                    style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
                  >
                    <Hotel size={15} />
                  </span>
                  <span className="min-w-0 flex-1 flex flex-col gap-0.5">
                    {/* The three fields the endpoint returns, and nothing
                        else. Anything more would mean widening an endpoint
                        that lists another person's requests. */}
                    <span className="text-[13px] font-bold truncate" style={{ color: "var(--text-heading)" }}>
                      {h.requestNo ?? "—"}
                    </span>
                    <span className="text-[11.5px] flex items-center gap-1.5" style={{ color: "var(--text-secondary)" }}>
                      <CalendarRange size={11} className="shrink-0" />
                      {fmtTripRange(h.departDate, h.returnDate)}
                    </span>
                    {h.workLocations.length > 0 && (
                      <span className="text-[11.5px] flex items-start gap-1.5" style={{ color: "var(--text-muted)" }}>
                        <MapPin size={11} className="shrink-0 mt-[2px]" />
                        <span className="min-w-0">{h.workLocations.join(" · ")}</span>
                      </span>
                    )}
                  </span>
                </button>
              ))}
            {!hostsLoading && hosts !== null && shownHosts.length === 0 && !hostsError && !notice && (
              // Every condition named, because "no results" here is almost
              // always one of them rather than "this person never travels":
              // the endpoint offers only requests that are alive, filed, carry
              // a room booking and are not already somebody else's guest.
              <p className="py-8 text-center text-[12px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
                {listQuery.trim() ? "ไม่พบเลขที่คำขอนี้ในรายการ" : "ไม่พบคำขอที่พักห้องร่วมได้ในช่วงวันที่นี้"}
                <br />
                <span className="text-[11.5px]" style={{ color: "var(--text-faint)" }}>
                  ระบบจะแสดงเฉพาะคำขอที่ส่งแล้ว ยังไม่ถูกยกเลิก มีการจองห้องพัก
                  และยังไม่ได้พักร่วมกับคำขออื่น
                </span>
              </p>
            )}
          </div>
        </div>

        <div
          className="px-5 py-3 flex items-center justify-between gap-2 shrink-0"
          style={{ borderTop: "1px solid var(--border-card)" }}
        >
          {pickMode === "person" && person !== null ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              /* ONE setter, and it has to stay one. Clearing `person` IS
                 going back to the search, because that is the only thing
                 deciding which step of this tab renders — the dialog itself
                 never closes and there is no second modal to reopen.
                 It took two values to express this before the merge
                 (`person` and `personOpen`), they could disagree, and they
                 did: `RequesterPickerModal` calls `onClose()` immediately
                 after `onSelect()`, so `personOpen` was already false by the
                 time step 2 rendered and clearing `person` alone closed the
                 whole picker instead of stepping back. Shipped with package
                 E, fixed in `2972e26`, and now unrepresentable.
                 **Do not add `closePicker()` or `setPickerOpen(false)`
                 here** — that is the same regression in its remaining form. */
              onClick={() => setPerson(null)}
            >
              ← เปลี่ยนคน
            </Button>
          ) : (
            <span />
          )}
          <Button type="button" variant="secondary" size="sm" onClick={closePicker}>
            ปิด
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
