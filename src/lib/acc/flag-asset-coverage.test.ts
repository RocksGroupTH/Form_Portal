import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { COUNTRIES } from "./country-currency";

/**
 * Every country this app offers must have a flag file on disk.
 *
 * The flags are copied assets, not a dependency (see `public/flags/README.md`),
 * so adding a country to `COUNTRIES` does not bring its flag with it. Without
 * this test the omission surfaces as a broken image on somebody's claim form.
 */
const DIR = path.resolve(process.cwd(), "public/flags");

test("every offered country has a flag asset", () => {
  const missing = COUNTRIES
    .filter((c) => !fs.existsSync(path.join(DIR, `${c.code.toLowerCase()}.svg`)))
    .map((c) => `${c.nameTh} (${c.code})`);
  assert.deepEqual(
    missing,
    [],
    "no flag file for: " + missing.join(", ") + " — see public/flags/README.md",
  );
});

/** The reverse: a flag nobody can pick is dead weight in the repository. */
test("no flag asset belongs to a country the app does not offer", () => {
  const offered = COUNTRIES.map((c) => c.code.toLowerCase());
  const orphans = fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".svg"))
    .map((f) => f.replace(/\.svg$/, ""))
    .filter((code) => offered.indexOf(code) === -1);
  assert.deepEqual(orphans, [], "flag files with no country: " + orphans.join(", "));
});
