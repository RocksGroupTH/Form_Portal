/**
 * Whether a booking row holds edits that have not been saved.
 *
 * Two things read this. The card offers to put the row back the way it was
 * saved, and the booking cannot be completed while any row is carrying unsaved
 * work — signing off a booking against figures that exist only on somebody's
 * screen is the thing that must not happen, and it is invisible without this.
 *
 * Pure and import-free, so the comparison is unit-tested without a database —
 * the fourth rule in this folder to be extracted rather than left inline, and
 * the reason is the same one `booking-lock.ts` records.
 */

import { sanitizeBookingAmount } from "./booking-amounts";
import type { SavedBookingEntry } from "./booking-lock";

/** The live inputs, which are strings because that is what a text field holds. */
export interface BookingRowFields {
  bookingNo: string;
  priceExVat: string;
  vat: string;
  discount: string;
  totalAmount: string;
}

export interface BookingDirtyInput {
  /** The saved row, or null for one that has never been written. */
  saved: SavedBookingEntry | null;
  current: BookingRowFields;
  /** Files picked but not yet sent — unsaved work in their own right. */
  pendingFileCount: number;
}

export function bookingRowDirty({ saved, current, pendingFileCount }: BookingDirtyInput): boolean {
  // A file that exists only on this page is an unsaved change whatever the
  // figures say, and it is the one the person is most likely to lose.
  if (pendingFileCount > 0) return true;

  const typed = current.bookingNo.trim();
  if (!saved) {
    // Nothing saved yet: the row is dirty exactly when somebody has put
    // something in it. An untouched slot must not block the whole booking.
    return typed !== "" || FIGURES.some((f) => figureOf(current, f) !== null);
  }

  if (typed !== (saved.bookingNo ?? "").trim()) return true;
  return FIGURES.some((f) => figureOf(current, f) !== saved[f.saved]);
}

/**
 * The four figures, each paired with the saved column it answers to.
 *
 * A table rather than four hand-written comparisons: adding a fifth figure
 * without extending the dirty check would silently let it be edited and
 * completed, which is the failure this whole module exists to catch.
 */
const FIGURES: ReadonlyArray<{
  input: keyof Omit<BookingRowFields, "bookingNo">;
  saved: keyof Omit<SavedBookingEntry, "bookingNo">;
}> = [
  { input: "priceExVat", saved: "priceExVat" },
  { input: "vat", saved: "vatAmount" },
  { input: "discount", saved: "discountAmount" },
  { input: "totalAmount", saved: "totalAmount" },
];

/**
 * The figure a field holds, compared as a number rather than as text.
 *
 * "6100.90" and 6100.9 are the same amount; comparing the strings would report
 * every freshly loaded row as edited. A value the sanitizer refuses — negative,
 * past the ceiling, not a number — comes back null, which will not equal a
 * saved figure, so it reads as an edit. That is the safe direction: a row
 * showing a number it could never store must not be completable.
 */
function figureOf(current: BookingRowFields, f: (typeof FIGURES)[number]): number | null {
  return sanitizeBookingAmount(current[f.input]);
}
