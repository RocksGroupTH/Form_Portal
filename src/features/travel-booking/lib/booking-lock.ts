/**
 * Whether a booking row's five fields are closed to typing.
 *
 * The rule asked for is "attach the confirmation, let the read finish, then the
 * fields open" — the shape AP-1's expense row uses, where the receipt is asked
 * for before the money is. What that rule must not do is reach backwards.
 *
 * **Saving and uploading are independent actions in this panel** — the save
 * button commits the figures, the file tile uploads on pick. So a row can hold
 * a booking number and a price with no file behind it, and rows like that
 * existed before the lock shipped. Locking one strands data somebody already
 * entered: visible, uneditable, behind a message telling them to attach a file
 * they may not have. The lock therefore applies to a row with **nothing in it
 * yet**, which is the only row it was ever meant to describe.
 *
 * Pure and import-free, and extracted rather than left inline **because it
 * broke inline**: the first version was `!hasFile || reading`, written under a
 * comment asserting that a saved row always has its attachment. It does not.
 */

/** The figures as the database holds them — not the live input strings. */
export interface SavedBookingEntry {
  bookingNo: string | null;
  priceExVat: number | null;
  vatAmount: number | null;
  discountAmount: number | null;
  totalAmount: number | null;
}

export interface BookingLockInput {
  /** The saved row, or null for a slot that has never been written. */
  saved: SavedBookingEntry | null;
  /** At least one confirmation file is attached to this row. */
  hasFile: boolean;
  /** An AI read of the attachment is in flight. */
  reading: boolean;
}

/**
 * True while the fields must refuse typing.
 *
 * Read against the **saved** row, never the live input state: a value the
 * person is part-way through typing must not change whether the box they are
 * typing into is open, which is a loop, and a lock that flickers mid-keystroke
 * is worse than either state.
 */
export function bookingFieldsLocked({ saved, hasFile, reading }: BookingLockInput): boolean {
  // A read in flight closes the fields whatever else is true — that is the one
  // moment a figure is about to be written and typing over it only creates a
  // race about whose number wins.
  if (reading) return true;
  if (hasFile) return false;
  return !hasSavedEntry(saved);
}

/**
 * Whether the row already records something.
 *
 * A **zero is data** — "this booking carried no VAT" is an answer somebody
 * gave, the same distinction `sanitizeBookingAmount` draws between 0 and null.
 * Only a row blank in all five fields is one nobody has started.
 */
function hasSavedEntry(saved: SavedBookingEntry | null): boolean {
  if (!saved) return false;
  if ((saved.bookingNo ?? "").trim() !== "") return true;
  return (
    saved.priceExVat !== null ||
    saved.vatAmount !== null ||
    saved.discountAmount !== null ||
    saved.totalAmount !== null
  );
}
