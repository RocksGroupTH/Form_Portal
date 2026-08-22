/**
 * Which Form Environment switch transitions have to be *typed* rather than
 * clicked, and what counts as typing it.
 *
 * Pulled out of `FormEnvironmentSettings.tsx` so the rule can be unit-tested:
 * that file is `"use client"` and pulls in React, SWR and sonner, none of which
 * a node test should have to load to ask whether a switch needs a typed
 * confirmation. This module imports nothing.
 *
 * **Both Production directions are typed.** Off hides a live form from every
 * general user until somebody turns it back on. On does the reverse — it
 * exposes a form to the whole company, on the production database, where the
 * requests it collects are real. Until 2026-08-22 only the off direction was
 * guarded, so the switch that puts a form in front of everybody was a single
 * blue button while the one that took it away demanded a typed word.
 *
 * **UAT is not typed, in either direction**, and that is the point rather than
 * an omission. A UAT switch only moves what configured testers see, its worst
 * case is a tester losing a sandbox, and a prompt that asks for typing on every
 * switch teaches people to type without reading — which costs the Production
 * prompt exactly the attention it exists to buy.
 */

/** The two switches each form carries in `Fast_Core.dbo.FormEnvironment`. */
export type SwitchField = "production" | "uat";

/** Typed into the dialog, exactly, to release the button. */
export const CONFIRM_WORD = "Confirm";

/**
 * Does moving `field` to `next` need the typed word?
 *
 * `next` is unused today — both Production directions qualify — and is kept in
 * the signature deliberately: it is the parameter that would express "on is
 * fine, off is not", and dropping it would make re-splitting the two directions
 * a change to every call site rather than to this one line.
 */
export function needsTypedConfirm(field: SwitchField, next: boolean): boolean {
  void next;
  return field === "production";
}

/**
 * Has the confirmation word been typed?
 *
 * Surrounding whitespace is forgiven; case is not. The dialog shows the word,
 * and a check that accepts `confirm` accepts a reflex rather than a reading.
 * A non-string answers false rather than throwing — the failure direction that
 * keeps the button disabled.
 */
export function isConfirmWordTyped(input: string): boolean {
  return typeof input === "string" && input.trim() === CONFIRM_WORD;
}
