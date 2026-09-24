/**
 * What "filter by status" means on My Requests and My Work — one vocabulary,
 * two questions.
 *
 * ## Why a module rather than two arrays in the panel
 *
 * The summary boxes at the top of the page became the filter on 2026-09-24
 * (the user), and a dropdown beside the form filter took over the fine-grained
 * choice the old chip row used to offer. That is **two controls over one piece
 * of state**, so the set each box stands for and the set the dropdown holds
 * have to be the same kind of thing or the highlight lies. Both live here, with
 * the mapping between a row and its filter key, so none of the three can be
 * edited alone.
 *
 * ## The words are the table's
 *
 * The dropdown offers Submitted / Pending / Complete / Rejected / Revise /
 * Cancelled — the labels `statusDisplay` already prints in the สถานะ column
 * ("ใช้ชุดเดียวกัน", the user, 2026-09-24). You filter by what you can see;
 * offering a seventh word here for a state the chip calls something else is how
 * a filter comes to be distrusted. The old chip row grouped Submitted and
 * Pending together under รออนุมัติ and could not tell them apart at all.
 *
 * ## The two questions stay different
 *
 * My Requests labels a row by the request's **own status**; My Work labels it
 * by what the row means to the **viewer** (`getMyWorkStatusBucket`) — a
 * `ManagerApproved` request whose manager step you signed reads Complete to you
 * while the request itself is still with accounting. So the *key* differs per
 * kind, which is why `statusFilterKey` takes the kind and why the two option
 * lists are separate constants rather than one filtered list.
 */
import { isCompletedStatus } from "@/features/accounting/constants";

export interface StatusFilterOption {
  /** Stored in the filter state and in the `?status=` link Home sends. */
  id: string;
  label: string;
}

/**
 * My Requests' options, in the order a request travels through them.
 *
 * `Approved` is the id even though the label says Complete, because that is the
 * status the database holds for four of the five forms and the value Home's
 * `?status=Approved` link already carries.
 */
export const MINE_STATUS_OPTIONS: readonly StatusFilterOption[] = [
  { id: "Submitted", label: "Submitted" },
  { id: "ManagerApproved", label: "Pending" },
  { id: "Approved", label: "Complete" },
  { id: "Returned", label: "Revise" },
  { id: "Rejected", label: "Rejected" },
  { id: "Cancelled", label: "Cancelled" },
] as const;

/**
 * My Work's options are `getMyWorkStatusBucket`'s five members.
 *
 * **`Submitted` cannot appear here and should not**: a submitted request
 * sitting on your own manager step is precisely one that is pending *you*, so
 * the bucket has no such member. Same reasoning `statusDisplayForBucket`
 * records for the chip.
 */
export const WORK_STATUS_OPTIONS: readonly StatusFilterOption[] = [
  { id: "pending", label: "Pending" },
  { id: "Approved", label: "Complete" },
  { id: "Returned", label: "Revise" },
  { id: "Rejected", label: "Rejected" },
  { id: "Cancelled", label: "Cancelled" },
] as const;

export function statusFilterOptions(kind: "mine" | "work"): readonly StatusFilterOption[] {
  return kind === "work" ? WORK_STATUS_OPTIONS : MINE_STATUS_OPTIONS;
}

/**
 * The option id a row belongs to.
 *
 * On `mine` it folds `Completed` into `Approved` — AP-17's spelling of the same
 * terminal state, which would otherwise be filtered out by every selection
 * including the one whose chip it wears. An unrecognised status returns
 * **itself** rather than a catch-all: it then matches nothing while a selection
 * is active (correct — the viewer did not ask for it) and still shows under
 * ทั้งหมด, which is the honest treatment of a row this app did not write.
 *
 * On `work` the caller has already computed the bucket; this is the identity,
 * and exists so both sides of the panel call one function.
 */
export function statusFilterKey(kind: "mine" | "work", statusOrBucket: string): string {
  if (kind === "work") return statusOrBucket;
  return isCompletedStatus(statusOrBucket) ? "Approved" : statusOrBucket;
}

/**
 * One box at the top of the page: a coarse filter with a count beside it.
 *
 * `ids` is the selection pressing it applies — empty for ทั้งหมด, which is the
 * same "no selection means everything" convention `MultiSelectFilter` uses, so
 * the two controls share a state with no translation.
 */
export interface StatusSummaryBox {
  id: string;
  label: string;
  /** Option ids this box stands for. Empty = every row. */
  ids: readonly string[];
  tone: "neutral" | "pending" | "ok" | "danger";
}

/**
 * The four boxes, per kind.
 *
 * **กำลังดำเนินการ includes Revise**, and that is deliberate rather than
 * inherited: a returned request is still in flight — its owner has something to
 * do and the money has not been decided — so counting it as finished would be
 * wrong in the direction that hides work. It is the definition the boxes have
 * always used; it is written down here because the dropdown now lets somebody
 * pick Revise on its own and notice the overlap.
 *
 * **There is no ยกเลิก box**, by the same argument that there are only four:
 * these are the states somebody scans for, and a cancelled request is one
 * nobody is waiting on. It is one click away in the dropdown, which is the
 * whole reason the dropdown exists.
 */
export function statusSummaryBoxes(kind: "mine" | "work"): readonly StatusSummaryBox[] {
  const inProcess = kind === "work" ? ["pending", "Returned"] : ["Submitted", "ManagerApproved", "Returned"];
  return [
    { id: "all", label: "ทั้งหมด", ids: [], tone: "neutral" },
    { id: "inProcess", label: "กำลังดำเนินการ", ids: inProcess, tone: "pending" },
    { id: "approved", label: "อนุมัติแล้ว", ids: ["Approved"], tone: "ok" },
    { id: "rejected", label: "ไม่อนุมัติ", ids: ["Rejected"], tone: "danger" },
  ];
}

/**
 * Whether `selected` is exactly this box's set — what lights the highlight.
 *
 * Order-insensitive and length-checked, so picking กำลังดำเนินการ's three
 * statuses one at a time in the dropdown lights that box, and removing any one
 * of them puts it out. That two-way agreement is the point of having both
 * controls: the box is not a mode, it is a shortcut to a selection the dropdown
 * could also express.
 *
 * `MULTI_SELECT_NONE` is a one-element selection that matches no box and must
 * not light ทั้งหมด — it is the deliberate "nothing", the opposite of "no
 * filter". The length test is what keeps them apart.
 */
export function isSummaryBoxActive(
  selected: readonly string[],
  box: StatusSummaryBox,
): boolean {
  if (box.ids.length !== selected.length) return false;
  if (box.ids.length === 0) return true;
  return box.ids.every((id) => selected.includes(id));
}

/**
 * Sum of a filtered set, in baht.
 *
 * **`AccRequest.TotalAmount` is Thai baht, always** — whatever currency the
 * claim was entered in, which is the invariant the whole multi-currency feature
 * rests on (see `src/lib/acc/currency.ts`). So these figures can be added
 * without asking what any of them is denominated in, and this function
 * deliberately does not look at `currency` or `exchangeRate`.
 *
 * A null amount contributes nothing rather than breaking the sum: AP-17 rows
 * carry per-diem only, and a draft-era row may carry none at all.
 */
export function sumTotalAmount(rows: readonly { totalAmount?: number | null }[]): number {
  let sum = 0;
  for (const row of rows) {
    const n = row.totalAmount;
    if (typeof n === "number" && Number.isFinite(n)) sum += n;
  }
  return sum;
}
