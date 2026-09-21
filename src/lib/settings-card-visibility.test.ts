import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleSettingsCards } from "./settings-card-visibility";
// Relative, not "@/": tsx does not resolve the alias for a bare test run.
import { SETTINGS_CARDS, type NavItem } from "./constants";

const card = (id: string, extra: Partial<NavItem> = {}): NavItem => ({
  id,
  label: id,
  icon: "Server",
  desc: "",
  href: `/settings/${id}`,
  ...extra,
});

const ids = (cards: NavItem[]) => cards.map((c) => c.id);

test("a uatOnly card is hidden in PRO, even from a System Admin", () => {
  const cards = [card("plain"), card("lab", { uatOnly: true })];
  assert.deepEqual(
    ids(visibleSettingsCards(cards, { isSystemAdmin: true, isUatViewer: false })),
    ["plain"],
  );
});

test("a uatOnly card is shown to a viewer in UAT mode", () => {
  const cards = [card("plain"), card("lab", { uatOnly: true })];
  assert.deepEqual(
    ids(visibleSettingsCards(cards, { isSystemAdmin: true, isUatViewer: true })),
    ["plain", "lab"],
  );
});

test("systemAdminOnly still filters on its own, unchanged by the UAT arm", () => {
  const cards = [card("plain"), card("secret", { systemAdminOnly: true })];
  assert.deepEqual(
    ids(visibleSettingsCards(cards, { isSystemAdmin: false, isUatViewer: true })),
    ["plain"],
  );
  assert.deepEqual(
    ids(visibleSettingsCards(cards, { isSystemAdmin: true, isUatViewer: false })),
    ["plain", "secret"],
  );
});

test("the two conditions are ANDed — a card carrying both needs both", () => {
  const cards = [card("both", { systemAdminOnly: true, uatOnly: true })];
  const shown = (isSystemAdmin: boolean, isUatViewer: boolean) =>
    ids(visibleSettingsCards(cards, { isSystemAdmin, isUatViewer }));
  assert.deepEqual(shown(false, false), []);
  assert.deepEqual(shown(true, false), []);
  assert.deepEqual(shown(false, true), []);
  assert.deepEqual(shown(true, true), ["both"]);
});

test("Accounting Admin is the uatOnly card, and PRO drops it from the real hub", () => {
  // Pinned against the real list rather than a fixture: the rule the user
  // asked for is about *that* card, and a flag dropped from constants.ts
  // would leave every test above passing.
  const inUat = ids(visibleSettingsCards(SETTINGS_CARDS, { isSystemAdmin: true, isUatViewer: true }));
  const inPro = ids(visibleSettingsCards(SETTINGS_CARDS, { isSystemAdmin: true, isUatViewer: false }));
  assert.ok(inUat.includes("accounting-admin"));
  assert.ok(!inPro.includes("accounting-admin"));
  // Nothing else moved: PRO is the UAT list minus that one card.
  assert.deepEqual(inPro, inUat.filter((id) => id !== "accounting-admin"));
});
