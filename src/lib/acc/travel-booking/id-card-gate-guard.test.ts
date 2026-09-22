import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * AP-17 asks for a national ID / Passport scan only where the selected booking
 * options are configured to need one (package C, `AccTravel*.RequiresIdCard`,
 * migration 154). Three surfaces have to agree about that, and this file pins
 * the wiring between them:
 *
 * - `validateTravelBookingTab` (`request-service.ts`) — **the real check**;
 * - `validateTab` / `tabNeedsIdCard` (`useTravelBookingForm.ts`) — the client
 *   affordance;
 * - `TravelBookingTab.tsx` — whether the upload block is on screen at all.
 *
 * ## What this catches that nothing else can
 *
 * **A source-reading guard, not a behavioural one**, because
 * `request-service.ts` reaches `@/env` through `getAccPool()` and throws on
 * import inside a test run, and the two client files are React components a
 * `node:test` run does not render. That is the same constraint
 * `perdiem-source-guard.test.ts`, `booking-currency-guard.test.ts` and this
 * package's own `settings-id-card-guard.test.ts` are written around.
 *
 * Four failures, each invisible to the typechecker and to every other test:
 *
 * 1. **The gate is deleted and the refusal goes back to unconditional.** That
 *    is the pre-package-C code, it compiles, and the whole package is then
 *    inert — which is exactly what a later "simplification" would produce.
 * 2. **The flag is read off the posted tab** instead of derived from the
 *    persisted option rows. `TravelBookingRequest` carries the other `needs*`
 *    values as stored columns, so `tab.needsIdCard` is the shape a reader
 *    expects to exist and would reach for; `derive-flags.ts`'s own docblock
 *    explains why a posted flag cannot be believed.
 * 3. **One of the four option arms is dropped or crossed** — e.g.
 *    `returnVehicle` fed `tab.goVehicleId`. TypeScript cannot see that: all
 *    four keys are required and all four ids are `number | null`, so the wrong
 *    id in the right slot typechecks perfectly and silently stops one option's
 *    tick from ever asking for a card.
 * 4. **The upload block escapes its gate**, or the gate loses its
 *    already-attached-files arm. The second is the expensive one: a draft saved
 *    while a card was required and resumed after the option was un-ticked still
 *    has the scan attached, and hiding the block strands it — visible to the
 *    Admin desk, invisible to its own data subject, who can then neither see
 *    nor remove it.
 *
 * ## Out of scope, deliberately
 *
 * Nothing here touches **how** a card is judged. The fail-closed verification
 * (`/api/request/travel-booking/id-card-check`, `ID_CARD_VISION_MODEL`,
 * `statusForVisionError`) is unchanged by package C and unmentioned by this
 * guard: where a card is required, an unverified image is still refused.
 *
 * **Mutation-tested 2026-09-22** — see the report for the six mutations and
 * which test each one turned red.
 */

function read(relative: string): string {
  return fs.readFileSync(path.join(process.cwd(), "src", relative), "utf8");
}

/** Comments quoting these identifiers must not satisfy a check for them. */
function code(relative: string): string {
  return read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** The source between two markers, with a message naming what moved if either is gone. */
function between(src: string, startMarker: string, endMarker: string, what: string): string {
  const start = src.indexOf(startMarker);
  assert.notEqual(start, -1, `${what}: "${startMarker}" not found — has the file been restructured?`);
  const end = src.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `${what}: "${endMarker}" not found after "${startMarker}"`);
  return src.slice(start, end);
}

const REQUEST_SERVICE = "lib/acc/travel-booking/request-service.ts";
const FORM_HOOK = "features/travel-booking/hooks/useTravelBookingForm.ts";
const TAB_COMPONENT = "features/travel-booking/components/TravelBookingTab.tsx";

/** The Thai refusal both validators speak, as a regex-safe fragment. */
const REFUSAL = "กรุณาแนบรูปบัตรประชาชน หรือ Passport อย่างน้อย 1 ไฟล์";

function serverValidator(): string {
  return between(
    code(REQUEST_SERVICE),
    "export function validateTravelBookingTab",
    "export async function listTravelBookingDateRanges",
    "request-service.ts",
  );
}

/* ── 1. The server refuses only when the derived flag says so ── */

test("the server's ID-card refusal is gated on a derived needsIdCard, not unconditional", () => {
  const body = serverValidator();
  assert.ok(
    body.includes(REFUSAL),
    "validateTravelBookingTab no longer refuses a missing ID card at all — the server is the real " +
      "check, and without it a direct POST submits an AP-17 request with no card whatever the " +
      "options require",
  );
  assert.ok(
    /if\s*\(\s*needsIdCard\s*&&/.test(body),
    "the ID-card refusal is no longer guarded by `needsIdCard &&` — either the gate was removed " +
      "(every AP-17 request demands a card again, which is the behaviour package C exists to " +
      "replace) or it was rewritten into a form this guard cannot read",
  );
});

test("the server derives needsIdCard from deriveBookingFlags over the settings maps", () => {
  const body = serverValidator();
  assert.ok(
    /const\s+needsIdCard\s*=\s*deriveBookingFlags\(/.test(body),
    "validateTravelBookingTab no longer derives needsIdCard from deriveBookingFlags — the one " +
      "shared rule; a local re-implementation is what the spec rejected in §2",
  );
  assert.ok(
    /\}\)\.needsIdCard/.test(body),
    "the deriveBookingFlags call no longer reads .needsIdCard off the result",
  );
});

test("the server never reads an ID-card flag off the posted tab", () => {
  const body = serverValidator();
  assert.ok(
    !/tab\.needsIdCard/.test(body),
    "validateTravelBookingTab reads `tab.needsIdCard` — the flag must come from the persisted " +
      "option rows, never the DTO. A request posting needsIdCard:false beside a hotel that " +
      "requires one must not be believed (see derive-flags.ts's docblock)",
  );
});

test("the server feeds all four selected options, each from its own id and map", () => {
  const body = serverValidator();
  const call = between(body, "deriveBookingFlags({", "}).needsIdCard", "the server's derive call");
  const arms: [string, RegExp][] = [
    ["accommodation", /accommodation:\s*settingOptionFor\(\s*settings\.accommodationById\s*,\s*tab\.accommodationId\s*\)/],
    ["goVehicle", /goVehicle:\s*settingOptionFor\(\s*settings\.vehicleById\s*,\s*tab\.goVehicleId\s*\)/],
    ["returnVehicle", /returnVehicle:\s*settingOptionFor\(\s*settings\.vehicleById\s*,\s*tab\.returnVehicleId\s*\)/],
    ["rentVehicle", /rentVehicle:\s*settingOptionFor\(\s*settings\.rentVehicleById\s*,\s*tab\.rentVehicleId\s*\)/],
  ];
  for (const [name, pattern] of arms) {
    assert.ok(
      pattern.test(call),
      `the server's ${name} arm is missing or crossed — every arm typechecks with the wrong id in ` +
        "it, so a crossed one silently stops that option's tick from ever asking for a card",
    );
  }
});

/* ── 2. The client validator asks the same question ── */

test("the client's ID-card issue is gated on tabNeedsIdCard", () => {
  const body = between(
    code(FORM_HOOK),
    "export function validateTab",
    "async function jsonFetcher",
    "useTravelBookingForm.ts",
  );
  assert.ok(
    /idCard/.test(body),
    "validateTab no longer raises an idCard issue at all — the requester would reach the server's " +
      "refusal with no inline hint saying which field is missing",
  );
  assert.ok(
    /if\s*\(\s*tabNeedsIdCard\(\s*tab\s*,\s*settings\s*\)\s*&&/.test(body),
    "validateTab's idCard issue is no longer gated on tabNeedsIdCard(tab, settings) — the client " +
      "would demand a card the server does not, on a form whose upload block is by then hidden",
  );
});

test("tabNeedsIdCard is deriveBookingFlags over the four selected options, not a local rule", () => {
  const src = code(FORM_HOOK);
  const fn = between(src, "export function tabNeedsIdCard", "export function validateTab", FORM_HOOK);
  assert.ok(
    /deriveBookingFlags\(/.test(fn) && /\}\)\.needsIdCard/.test(fn),
    "tabNeedsIdCard no longer answers through deriveBookingFlags — a second, client-local copy of " +
      "the rule is precisely what spec §2 rejected: which bookings need identification is a " +
      "supplier fact an admin ticks, not a fact about this codebase",
  );
  const arms: [string, RegExp][] = [
    ["accommodation", /accommodation:\s*pick\(\s*settings\.accommodationById\s*,\s*tab\.accommodationId\s*\)/],
    ["goVehicle", /goVehicle:\s*pick\(\s*settings\.vehicleById\s*,\s*tab\.goVehicleId\s*\)/],
    ["returnVehicle", /returnVehicle:\s*pick\(\s*settings\.vehicleById\s*,\s*tab\.returnVehicleId\s*\)/],
    ["rentVehicle", /rentVehicle:\s*pick\(\s*settings\.rentVehicleById\s*,\s*tab\.rentVehicleId\s*\)/],
  ];
  for (const [name, pattern] of arms) {
    assert.ok(
      pattern.test(fn),
      `tabNeedsIdCard's ${name} arm is missing or crossed — it typechecks either way, and the ` +
        "client would then hide an upload the server still insists on",
    );
  }
  assert.ok(
    !/requiresIdCard/.test(fn.replace(/deriveBookingFlags[\s\S]*$/, "")),
    "tabNeedsIdCard reads requiresIdCard off the raw options before deriving — the OR belongs in " +
      "deriveBookingFlags, where the server reads it too",
  );
});

/* ── 3. The upload block is hidden, not disabled — and never stranded ── */

/** The span of the JSX conditional that begins at `marker`, by matching parens. */
function conditionalSpan(src: string, marker: string): string {
  const at = src.indexOf(marker);
  assert.notEqual(
    at,
    -1,
    `TravelBookingTab.tsx no longer contains \`${marker}\` — the ID-card block's gate was removed ` +
      "or rewritten. Removing it shows the upload on every booking, which is the pre-package-C " +
      "behaviour; narrowing it to `needsIdCard &&` alone strands a card already attached to a " +
      "resumed draft.",
  );
  const open = src.indexOf("(", at + marker.length - 1);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") {
      depth--;
      if (depth === 0) return src.slice(at, i + 1);
    }
  }
  assert.fail(
    "could not find the end of the ID-card conditional by matching parentheses — if a string in " +
      "that block now holds an unbalanced parenthesis, this guard needs updating rather than the " +
      "component",
  );
}

test("the ID-card upload renders only inside the needsIdCard-or-already-attached gate", () => {
  const src = code(TAB_COMPONENT);
  const uploads = src.split("<IdCardUpload").length - 1;
  assert.equal(
    uploads,
    1,
    "TravelBookingTab.tsx renders <IdCardUpload> somewhere other than once — a second, ungated " +
      "instance would defeat the gate entirely",
  );
  const span = conditionalSpan(src, "{(needsIdCard || hasIdCardEvidence) && (");
  assert.ok(
    span.includes("<IdCardUpload"),
    "the ID-card upload is no longer inside its gate — it renders on every booking again",
  );
  assert.ok(
    /required=\{needsIdCard\}/.test(span),
    "<IdCardUpload> no longer receives required={needsIdCard} — the block shown only because a " +
      "card is already attached would keep its red required asterisk, claiming a requirement the " +
      "server does not have",
  );
});

test("the already-attached arm counts both saved files and a pending pick", () => {
  const src = code(TAB_COMPONENT);
  assert.ok(
    /const\s+hasIdCardEvidence\s*=\s*tab\.idCardFiles\.length\s*>\s*0\s*\|\|\s*!!tab\.pendingIdCard/.test(src),
    "hasIdCardEvidence no longer counts both tab.idCardFiles and tab.pendingIdCard — dropping the " +
      "saved-files arm strands an uploaded national-ID scan out of its own subject's reach; " +
      "dropping the pending arm makes a just-picked file vanish the moment the option is un-ticked",
  );
});

test("the tab component does not recompute the rule from the raw option flags", () => {
  const src = code(TAB_COMPONENT);
  assert.ok(
    !/requiresIdCard/.test(src),
    "TravelBookingTab.tsx reads requiresIdCard directly — the answer must arrive as the " +
      "needsIdCard prop, which is the same tabNeedsIdCard call validateTab makes. Two spellings " +
      "can disagree, and the costly disagreement is a hidden block whose emptiness still refuses " +
      "the submit",
  );
});
