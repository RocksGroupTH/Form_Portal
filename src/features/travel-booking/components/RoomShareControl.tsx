"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CalendarRange,
  Hotel,
  Link2Off,
  Loader2,
  MapPin,
  RotateCw,
  Users,
} from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { RequesterPickerModal, type RequesterOption } from "@/components/RequesterPickerModal";
import { fmtYmdDisplay } from "@/features/accounting/lib/format-travel-dates";
import { ROOM_SHARE_AGREEMENT_LINE } from "@/features/travel-booking/constants";
import { inputClass, inputStyle, labelClass, labelStyle } from "./shared";
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
 * ## Two fetch surfaces, both pre-existing, neither widened
 *
 * The person search is `/api/request/travel-booking/requesters`, the HR-backed
 * roster search the on-behalf เปลี่ยนผู้ขอเบิก picker already uses, reached
 * through the very same `RequesterPickerModal`. Spec §6 names
 * `/api/users/search` instead; that route is
 * `requireRole(["IT Admin","System Admin"])`, so an ordinary requester cannot
 * call it at all and following the spec literally would 403 for almost
 * everybody. This one is `requireAuth` and answers a `staffId`, which is
 * exactly what the hosts endpoint takes.
 *
 * The request list is `room-share/{guestRequestId}/hosts`, which returns the
 * running number, the travel dates and the work location and deliberately
 * nothing else (spec §6 — not the amount, not the attachments, not the ID
 * card). `HostCandidateRow` is imported as a **type** from the service so this
 * component cannot invent a field the endpoint does not send;
 * `room-share-response-shape-guard.test.ts` pins the other end.
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
 * What this component knows about the tab's own binding.
 *
 * A closed union rather than a row plus two booleans, because "we are a guest
 * and the host has not arrived yet" and "we are a guest and the binding could
 * not be read" have to render differently and are trivially conflated by a
 * `loading` flag beside a nullable row.
 */
type ShareState =
  | { kind: "none" }
  | { kind: "loading" }
  | { kind: "ready"; view: RoomShareView }
  | { kind: "error" };

export interface RoomShareControlProps {
  /** `AccRequest.Id` for this tab — null until the draft has been saved once. */
  requestId: number | null;
  /** `TabFormState.isRoomShareGuest`, server-derived; this component never guesses it. */
  isGuest: boolean;
  /** The guest's own dates, which is what the request filter opens on (spec §6). */
  travelFrom: string | null;
  travelTo: string | null;
  /** The actor's department, already loaded by the form — the picker's starting list. */
  colleagues: RequesterOption[];
  /**
   * The attach succeeded server-side. The parent sets `isRoomShareGuest` and
   * **clears the accommodation choice** — see this file's header for why both.
   */
  onAttached: () => void;
  /** The binding is gone. The parent clears the flag; the accommodation stays unchosen. */
  onDetached: () => void;
}

export function RoomShareControl({
  requestId,
  isGuest,
  travelFrom,
  travelTo,
  colleagues,
  onAttached,
  onDetached,
}: RoomShareControlProps) {
  const [share, setShare] = useState<ShareState>({ kind: "none" });
  const [hostPerson, setHostPerson] = useState<RequesterOption | null>(null);
  const [detaching, setDetaching] = useState(false);

  /* The picker, in two steps: a person, then one of that person's requests. */
  const [personOpen, setPersonOpen] = useState(false);
  const [picked, setPicked] = useState<RequesterOption | null>(null);
  const [hosts, setHosts] = useState<HostCandidateRow[] | null>(null);
  const [hostsLoading, setHostsLoading] = useState(false);
  const [hostsError, setHostsError] = useState<string | null>(null);
  const [attaching, setAttaching] = useState<number | null>(null);
  /**
   * The server's refusal, verbatim.
   *
   * `room-share-policy.ts` answers every refusal with a Thai sentence naming
   * the specific reason — the colleague booked no room, that request is
   * already somebody's guest, it is cancelled — and the service adds one more
   * for a host that has never been filed. Those sentences arrive here as the
   * `error` body of the attach POST and are rendered as they came. **Nothing
   * is re-worded or re-derived on this side**: a second vocabulary for the
   * same closed set of reasons is how the picker starts telling a requester
   * something the server did not say.
   *
   * Shown in place and kept until the next attempt, rather than as a toast: it
   * is the answer to the row the requester just clicked, and the list is still
   * on screen for them to pick a different one.
   */
  const [refusal, setRefusal] = useState<string | null>(null);

  /** `travel` is the default; `requested` is the fallback filter (spec §6). */
  const [mode, setMode] = useState<"travel" | "requested">("travel");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  /**
   * Bumped to re-run the list fetch with the filters unchanged — what "ลองใหม่"
   * needs and what re-setting a state value to itself cannot give: React bails
   * out of an identical `useState` write, so no render happens, no dependency
   * changes, and the retry button does nothing at all.
   */
  const [reload, setReload] = useState(0);

  /* ── the tab's own binding ── */

  useEffect(() => {
    if (!isGuest || requestId == null) {
      setShare({ kind: "none" });
      setHostPerson(null);
      return;
    }
    let cancelled = false;
    setShare((prev) => (prev.kind === "ready" ? prev : { kind: "loading" }));
    fetch(`/api/request/travel-booking/room-share/${requestId}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        // `data: null` while the tab says guest means the binding went away
        // under us — a host deleted, or another tab of this form detached it.
        // Reported as an error rather than silently rendering "not a guest",
        // because the per-diem figure beside it is still being computed as a
        // guest's until the page is reloaded.
        if (!json?.ok || !json.data) setShare({ kind: "error" });
        else setShare({ kind: "ready", view: json.data as RoomShareView });
      })
      .catch(() => {
        if (!cancelled) setShare({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [isGuest, requestId]);

  /* ── the host's name, once the binding is known ── */

  /**
   * **`colleagues` must not be a dependency of the effect below**, and this ref
   * is why.
   *
   * The form builds it as `requesterOptsData?.colleagues ?? []`, so while that
   * SWR read is in flight it is **a new empty array on every render**. An
   * effect depending on its identity would therefore fire, `resolvePerson`
   * would miss the empty list and fetch, `setHostPerson` would re-render, and
   * the whole thing would go round again — a fetch loop for as long as the
   * roster takes to arrive. The list is only a cache-hit shortcut here, so
   * reading whatever the last render had is exactly as correct and cannot
   * loop.
   */
  const colleaguesRef = useRef(colleagues);
  colleaguesRef.current = colleagues;

  const hostStaffId = share.kind === "ready" ? share.view.hostStaffId : null;
  useEffect(() => {
    if (hostStaffId == null) {
      setHostPerson(null);
      return;
    }
    let cancelled = false;
    resolvePerson(hostStaffId, colleaguesRef.current).then((p) => {
      if (!cancelled) setHostPerson(p);
    });
    return () => {
      cancelled = true;
    };
  }, [hostStaffId]);

  /* ── the picker's list ── */

  useEffect(() => {
    if (!picked || requestId == null) return;
    let cancelled = false;
    setHostsLoading(true);
    setHostsError(null);
    const params = new URLSearchParams();
    params.set("staffId", String(picked.staffId));
    if (mode === "travel") {
      if (from) params.set("travelFrom", from);
      if (to) params.set("travelTo", to);
    } else {
      if (from) params.set("requestedFrom", from);
      if (to) params.set("requestedTo", to);
    }
    // Debounced: a date input fires per keystroke in some browsers, and this
    // endpoint scans a colleague's whole AP-17 history behind an ACL check.
    const timer = setTimeout(() => {
      fetch(`/api/request/travel-booking/room-share/${requestId}/hosts?${params.toString()}`)
        .then((r) => r.json())
        .then((json) => {
          if (cancelled) return;
          if (!json?.ok) {
            setHosts([]);
            setHostsError(json?.error ?? "โหลดรายการคำขอไม่สำเร็จ");
            return;
          }
          setHosts((json.data ?? []) as HostCandidateRow[]);
        })
        .catch(() => {
          if (cancelled) return;
          setHosts([]);
          setHostsError("โหลดรายการคำขอไม่สำเร็จ");
        })
        .finally(() => {
          if (!cancelled) setHostsLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [picked, requestId, mode, from, to, reload]);

  /* ── opening and closing ── */

  const openPicker = useCallback(() => {
    setRefusal(null);
    setHosts(null);
    setHostsError(null);
    setPicked(null);
    // Opens on the guest's own dates — "the overwhelmingly common case is two
    // people on the same trip" (spec §6). A tab with no dates yet opens
    // unfiltered rather than on today, which would hide the colleague's trip
    // for no reason the requester could see.
    setMode("travel");
    setFrom(travelFrom ?? "");
    setTo(travelTo ?? "");
    setPersonOpen(true);
  }, [travelFrom, travelTo]);

  const closeHostPicker = useCallback(() => {
    setPicked(null);
    setHosts(null);
    setHostsError(null);
    setRefusal(null);
  }, []);

  /** Switching filter mode re-seeds the dates, since the two mean different things. */
  const switchMode = useCallback(
    (next: "travel" | "requested") => {
      if (next === mode) return;
      setMode(next);
      setFrom(next === "travel" ? travelFrom ?? "" : "");
      setTo(next === "travel" ? travelTo ?? "" : "");
    },
    [mode, travelFrom, travelTo],
  );

  /* ── attach / detach ── */

  const attach = useCallback(
    async (host: HostCandidateRow) => {
      if (requestId == null) return;
      setAttaching(host.requestId);
      setRefusal(null);
      try {
        const res = await fetch(`/api/request/travel-booking/room-share/${requestId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hostRequestId: host.requestId }),
        });
        const json = await res.json();
        if (!json?.ok) {
          setRefusal(json?.error ?? "แนบห้องพักร่วมไม่สำเร็จ");
          return;
        }
        setShare({ kind: "ready", view: json.data as RoomShareView });
        setHostPerson(picked);
        closeHostPicker();
        setPersonOpen(false);
        onAttached();
        toast.success("แนบห้องพักร่วมแล้ว");
      } catch {
        setRefusal("แนบห้องพักร่วมไม่สำเร็จ");
      } finally {
        setAttaching(null);
      }
    },
    [requestId, picked, closeHostPicker, onAttached],
  );

  const detach = useCallback(async () => {
    if (requestId == null) return;
    setDetaching(true);
    try {
      const res = await fetch(`/api/request/travel-booking/room-share/${requestId}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!json?.ok) {
        toast.error(json?.error ?? "ยกเลิกการพักห้องร่วมไม่สำเร็จ");
        return;
      }
      setShare({ kind: "none" });
      setHostPerson(null);
      onDetached();
      toast.success("ยกเลิกการพักห้องร่วมแล้ว");
    } catch {
      toast.error("ยกเลิกการพักห้องร่วมไม่สำเร็จ");
    } finally {
      setDetaching(false);
    }
  }, [requestId, onDetached]);

  /* ─────────────────────────── attached ─────────────────────────── */

  if (isGuest) {
    return (
      <div data-field="roomShare" className="flex flex-col gap-2.5">
        <label className={labelClass} style={labelStyle}>
          <Users size={11} className="inline mr-1 -mt-0.5" />
          พักห้องเดียวกับ
        </label>

        {/* `none` reads as loading here on purpose: the fetch starts in an
            effect, so the first paint after a resumed draft arrives has the
            flag set and the binding not yet asked for. Rendering nothing for
            that frame leaves a bare label with no explanation under it. */}
        {(share.kind === "loading" || share.kind === "none") && (
          <p className="text-[12.5px] m-0 flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
            <Loader2 size={13} className="animate-spin" /> กำลังโหลดข้อมูลห้องพักร่วม...
          </p>
        )}

        {share.kind === "error" && (
          <p className="text-[12.5px] m-0" style={{ color: "var(--text-warning)" }}>
            โหลดข้อมูลห้องพักร่วมไม่สำเร็จ — กรุณาโหลดหน้านี้ใหม่
          </p>
        )}

        {share.kind === "ready" && (
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
                  {personLabel(hostPerson, share.view.hostStaffId)}
                </p>
                <p className="text-[12px] m-0 flex items-center gap-1.5 flex-wrap" style={{ color: "var(--text-secondary)" }}>
                  <Hotel size={12} className="shrink-0" />
                  <span className="font-semibold">{share.view.host.requestNo ?? "—"}</span>
                  <span style={{ color: "var(--text-faint)" }}>·</span>
                  <CalendarRange size={12} className="shrink-0" />
                  {fmtTripRange(share.view.host.departDate, share.view.host.returnDate)}
                </p>
                {share.view.host.workLocations.length > 0 && (
                  <p className="text-[11.5px] m-0 flex items-start gap-1.5" style={{ color: "var(--text-muted)" }}>
                    <MapPin size={11} className="shrink-0 mt-[2px]" />
                    <span className="min-w-0">{share.view.host.workLocations.join(" · ")}</span>
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

            <AgreementLine />

            {/* Detaching is the existing Draft/Returned editability rule — the
                route runs `authorizeAccRequest(…, "mutate")` and the service
                re-asserts it inside the transaction. Nothing is re-decided
                here; a request past Returned simply never renders this form. */}
            <div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={detach}
                loading={detaching}
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

      <div className="flex items-center gap-2 flex-wrap">
        <Button
          type="button"
          variant="secondary"
          size="md"
          onClick={openPicker}
          disabled={requestId == null}
          icon={<Users size={14} />}
        >
          พักห้องเดียวกับเพื่อนร่วมงาน
        </Button>
        {requestId == null && (
          <span className="text-[11.5px]" style={{ color: "var(--text-muted)" }}>
            กรุณาบันทึกร่างก่อนจึงจะเลือกห้องพักร่วมได้
          </span>
        )}
      </div>
      <p className="text-[11.5px] m-0" style={{ color: "var(--text-muted)" }}>
        เลือกแทนการจองห้องพักเอง — ใช้ห้องของเพื่อนร่วมงานที่จองไว้แล้ว และยังได้รับเบี้ยเลี้ยง
      </p>

      {/* Step 1 — the person. The same modal, the same roster search and the
          same debounce/staleness guard the on-behalf picker uses; only the
          heading differs. */}
      <RequesterPickerModal
        open={personOpen && picked === null}
        onClose={() => setPersonOpen(false)}
        colleagues={colleagues}
        // No "ตัวฉันเอง" row: this asks whose room, and your own is not one.
        self={null}
        value={null}
        onSelect={(staffId) => {
          if (staffId == null) return;
          resolvePerson(staffId, colleagues).then(setPicked);
        }}
        searchEndpoint="/api/request/travel-booking/requesters"
        title="พักห้องเดียวกับใคร"
        subtitle="เลือกเพื่อนร่วมงานที่จองห้องพักไว้แล้ว"
      />

      {/* Step 2 — which of that person's requests. */}
      <Dialog
        open={picked !== null}
        onOpenChange={(next) => {
          // Escape or a click outside closes the WHOLE picker, both steps.
          // Reopening the person list instead would make Escape read as "go
          // back", which no other dialog in this app does — "← เปลี่ยนคน" is
          // the control for that.
          if (!next) {
            closeHostPicker();
            setPersonOpen(false);
          }
        }}
        title={`เลือกคำขอของ ${personLabel(picked, picked?.staffId ?? null)}`}
        contentClassName="max-w-xl"
        scrollable={false}
      >
        <div className="px-5 py-4 flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto">
          <AgreementLine />

          {/* Travel date first, request date as the fallback — spec §6. */}
          <div className="flex flex-col gap-2">
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
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelClass} style={labelStyle}>
                  ตั้งแต่
                </label>
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                />
              </div>
              <div>
                <label className={labelClass} style={labelStyle}>
                  ถึง
                </label>
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                />
              </div>
            </div>
          </div>

          {refusal && (
            <div
              className="flex items-start gap-2 text-[12px] font-medium rounded-lg px-3 py-2"
              style={{ background: "var(--bg-card-alt)", color: "var(--color-danger)" }}
            >
              <AlertTriangle size={14} className="shrink-0 mt-[1px]" />
              <span>{refusal}</span>
            </div>
          )}

          {hostsError && (
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

          <div className="flex flex-col gap-1.5 min-h-[120px]">
            {hostsLoading && (
              <p className="py-8 text-center text-[12px] flex items-center justify-center gap-1.5" style={{ color: "var(--text-muted)" }}>
                <Loader2 size={13} className="animate-spin" /> กำลังค้นหา...
              </p>
            )}
            {!hostsLoading &&
              (hosts ?? []).map((h) => (
                <button
                  key={h.requestId}
                  type="button"
                  disabled={attaching !== null}
                  onClick={() => attach(h)}
                  className="flex items-start gap-3 px-3 py-2.5 rounded-xl cursor-pointer text-left w-full transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
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
                    {attaching === h.requestId ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <Hotel size={15} />
                    )}
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
            {!hostsLoading && hosts !== null && hosts.length === 0 && !hostsError && (
              // Every condition named, because "no results" here is almost
              // always one of them rather than "this person never travels":
              // the endpoint offers only requests that are alive, filed, carry
              // a room booking and are not already somebody else's guest.
              <p className="py-8 text-center text-[12px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
                ไม่พบคำขอที่พักห้องร่วมได้ในช่วงวันที่นี้
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
          <Button type="button" variant="ghost" size="sm" onClick={() => setPicked(null)}>
            ← เปลี่ยนคน
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              closeHostPicker();
              setPersonOpen(false);
            }}
          >
            ปิด
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
