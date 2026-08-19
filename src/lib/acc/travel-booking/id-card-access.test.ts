import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideIdCardConsentWrite,
  decideIdCardRead,
  parseConsentSetting,
} from "./id-card-access";

/**
 * A and B are active employees in the same department — the relationship AP-17
 * accepts for on-behalf filing, and the one the whole finding rests on.
 */
const A = 5001;
const B = 5002;

/* ── Reading someone else's card ── */

test("A cannot list, download or reuse B's card even though B consented", () => {
  // B's consent is to reusing their own card on their own future bookings. It
  // is not permission for a colleague to pull the scan.
  const verdict = decideIdCardRead({ actorStaffId: A, subjectStaffId: B, consent: true });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.ok === false && verdict.status, 404);
});

test("the refusal does not distinguish 'no card' from 'not yours'", () => {
  // Both answer 404 with the same message, so probing staff ids reveals
  // nothing about who has a stored ID scan.
  const notYours = decideIdCardRead({ actorStaffId: A, subjectStaffId: B, consent: true });
  const noConsent = decideIdCardRead({ actorStaffId: A, subjectStaffId: A, consent: null });
  assert.deepEqual(notYours, noConsent);
});

test("B can use their own card once they have consented", () => {
  assert.equal(decideIdCardRead({ actorStaffId: B, subjectStaffId: B, consent: true }).ok, true);
});

test("B's own card stays shut while consent is unanswered or refused", () => {
  assert.equal(decideIdCardRead({ actorStaffId: B, subjectStaffId: B, consent: null }).ok, false);
  assert.equal(decideIdCardRead({ actorStaffId: B, subjectStaffId: B, consent: false }).ok, false);
});

test("an actor with no HR staff id matches nobody", () => {
  assert.equal(decideIdCardRead({ actorStaffId: null, subjectStaffId: null, consent: true }).ok, false);
  assert.equal(decideIdCardRead({ actorStaffId: null, subjectStaffId: B, consent: true }).ok, false);
});

test("a request with no subject is not a wildcard", () => {
  assert.equal(decideIdCardRead({ actorStaffId: A, subjectStaffId: null, consent: true }).ok, false);
});

/* ── Granting consent ── */

test("A cannot record consent on B's behalf", () => {
  const verdict = decideIdCardConsentWrite({ actorStaffId: A, subjectStaffId: B });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.ok === false && verdict.status, 403);
});

test("B records their own consent, named or implied", () => {
  assert.equal(decideIdCardConsentWrite({ actorStaffId: B, subjectStaffId: B }).ok, true);
  // The form posts no requesterStaffId when filing for yourself.
  assert.equal(decideIdCardConsentWrite({ actorStaffId: B, subjectStaffId: null }).ok, true);
});

test("an actor with no HR staff id cannot record consent for anyone", () => {
  assert.equal(decideIdCardConsentWrite({ actorStaffId: null, subjectStaffId: null }).ok, false);
});

/* ── Setting round-trip ── */

test("the stored setting reads back as three distinct states", () => {
  assert.equal(parseConsentSetting("true"), true);
  assert.equal(parseConsentSetting("false"), false);
  assert.equal(parseConsentSetting(null), null);
  assert.equal(parseConsentSetting(""), null);
  // Anything unexpected is "never answered", not "granted".
  assert.equal(parseConsentSetting("TRUE"), null);
  assert.equal(parseConsentSetting("1"), null);
});
