import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MEMBER_COLOR,
  isValidRole,
  mapTeamMemberRow,
  normalizeEmail,
  resolveNickname,
  type RawTeamMemberRow,
} from "./mapping";

/*
 * The service's pure layer. `service.ts` itself is not imported here: it pulls
 * in `@/lib/db/mssql` → `@/env`, whose schema validation throws outside a Next
 * runtime.
 */

const RAW: RawTeamMemberRow = {
  Id: 42,
  FullName: "Somchai Jaidee",
  Nickname: "Chai",
  Email: "somchai@rocksgroup.com",
  AppRole: "IT Admin",
  Position: "Developer",
  Color: "#112233",
  Photo: "data:image/png;base64,AAA",
  ManagerId: 7,
  IsActive: true,
};

/* ── normalizeEmail ── */

test("email lookups ignore case and padding", () => {
  // Entra hands back the UPN in whatever case the directory stores it, and the
  // TeamMember row was typed by hand. Comparing them raw loses the match.
  assert.equal(normalizeEmail("  Somchai@RocksGroup.com "), "somchai@rocksgroup.com");
  assert.equal(normalizeEmail("somchai@rocksgroup.com"), "somchai@rocksgroup.com");
});

test("a missing email normalises to the empty string, never to a wildcard", () => {
  // Callers refuse "" rather than querying with it: an empty key would match a
  // blank Email row and hand a session someone else's identity.
  assert.equal(normalizeEmail(null), "");
  assert.equal(normalizeEmail(undefined), "");
  assert.equal(normalizeEmail("   "), "");
});

/* ── mapTeamMemberRow ── */

test("a full row maps column for column", () => {
  assert.deepEqual(mapTeamMemberRow(RAW), {
    id: 42,
    fullName: "Somchai Jaidee",
    nickname: "Chai",
    email: "somchai@rocksgroup.com",
    appRole: "IT Admin",
    position: "Developer",
    color: "#112233",
    photo: "data:image/png;base64,AAA",
    managerId: 7,
    isActive: true,
  });
});

test("nullable columns come back as the app's defaults, not as null strings", () => {
  const mapped = mapTeamMemberRow({
    ...RAW,
    FullName: null,
    Nickname: null,
    Email: null,
    AppRole: null,
    Position: null,
    Color: null,
    Photo: null,
    ManagerId: null,
  });
  assert.equal(mapped.fullName, "");
  assert.equal(mapped.nickname, "");
  assert.equal(mapped.email, "");
  assert.equal(mapped.appRole, "");
  assert.equal(mapped.position, null);
  assert.equal(mapped.photo, null);
  assert.equal(mapped.managerId, null);
  // An avatar with no colour renders as a blank swatch, so the column default
  // is re-applied rather than passed through.
  assert.equal(mapped.color, DEFAULT_MEMBER_COLOR);
});

test("IsActive is true only for a real yes", () => {
  // The driver has handed bit back as 0/1 as well as false/true; both mean the
  // same thing, and anything else must not read as active.
  assert.equal(mapTeamMemberRow({ ...RAW, IsActive: 1 }).isActive, true);
  assert.equal(mapTeamMemberRow({ ...RAW, IsActive: true }).isActive, true);
  assert.equal(mapTeamMemberRow({ ...RAW, IsActive: 0 }).isActive, false);
  assert.equal(mapTeamMemberRow({ ...RAW, IsActive: false }).isActive, false);
  assert.equal(mapTeamMemberRow({ ...RAW, IsActive: null }).isActive, false);
});

test("an unrecognised AppRole is passed through, not coerced to Staff", () => {
  // Coercing in the data layer would hide a bad row; the role gates normalise
  // at the point of use, where the safe default belongs.
  assert.equal(mapTeamMemberRow({ ...RAW, AppRole: "Superuser" }).appRole, "Superuser");
});

/* ── isValidRole ── */

test("only the four canonical spellings are a valid role", () => {
  assert.equal(isValidRole("Staff"), true);
  assert.equal(isValidRole("IT Admin"), true);
  assert.equal(isValidRole("System Admin"), true);
  assert.equal(isValidRole("Viewer"), true);
  assert.equal(isValidRole(" System Admin "), true);
});

test("a near-miss role is rejected rather than normalised", () => {
  // normalizeRole() would turn every one of these into a real role — "staff"
  // into Staff, "Superuser" into Staff. A write API must not grant a role the
  // request never asked for in those words, so the check is exact-match.
  assert.equal(isValidRole("staff"), false);
  assert.equal(isValidRole("systemadmin"), false);
  assert.equal(isValidRole("Superuser"), false);
  assert.equal(isValidRole(""), false);
  assert.equal(isValidRole(null), false);
  assert.equal(isValidRole(undefined), false);
});

/* ── resolveNickname ── */

test("a supplied nickname always wins", () => {
  assert.equal(resolveNickname("Somchai Jaidee", "Chai"), "Chai");
  assert.equal(resolveNickname("Somchai Jaidee", "  Chai  "), "Chai");
});

test("no nickname falls back to the first word of the full name", () => {
  // A blank nickname shows as an empty label in the navbar and on every
  // approval card, so the directory sync fills one in.
  assert.equal(resolveNickname("Somchai Jaidee", null), "Somchai");
  assert.equal(resolveNickname("Somchai Jaidee", undefined), "Somchai");
  assert.equal(resolveNickname("Somchai Jaidee", "   "), "Somchai");
  assert.equal(resolveNickname("  Somchai   Jaidee  ", ""), "Somchai");
});

test("a one-word or empty name still yields something storable", () => {
  assert.equal(resolveNickname("Somchai", null), "Somchai");
  assert.equal(resolveNickname("", null), "");
});
