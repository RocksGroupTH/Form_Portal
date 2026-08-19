import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BcDestinationError,
  assertApiDestination,
  assertOAuthDestination,
  bcSecretRebindRequired,
} from "./bc-destination";

/* ── Destinations ── */

test("Microsoft's own endpoints are approved", () => {
  assert.equal(
    assertOAuthDestination(
      "https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/oauth2/v2.0/token",
    ).hostname,
    "login.microsoftonline.com",
  );
  assert.equal(
    assertApiDestination(
      "https://api.businesscentral.dynamics.com/v2.0/11111111-2222-3333-4444-555555555555/Production/api/v2.0/companies",
    ).hostname,
    "api.businesscentral.dynamics.com",
  );
});

test("an attacker-chosen host is refused before any credential is sent", () => {
  // `resolveBcTestUrl` ended with a bare `return url`, and both token functions
  // fetched `oauthUrl` as given.
  assert.throws(() => assertOAuthDestination("https://collector.example.com/token"), BcDestinationError);
  assert.throws(() => assertApiDestination("https://collector.example.com/companies"), BcDestinationError);
});

test("http is refused rather than silently upgraded", () => {
  assert.throws(
    () => assertOAuthDestination("http://login.microsoftonline.com/tenant/oauth2/v2.0/token"),
    /https/,
  );
});

test("a URL with embedded credentials is refused", () => {
  assert.throws(
    () => assertOAuthDestination("https://user:pass@login.microsoftonline.com/t/oauth2/v2.0/token"),
    /username or password/,
  );
});

test("loopback, IP literals and internal names are refused", () => {
  for (const url of [
    "https://localhost/token",
    "https://127.0.0.1/token",
    "https://169.254.169.254/latest/meta-data/",
    "https://[::1]/token",
    "https://bc.internal/token",
  ]) {
    assert.throws(() => assertOAuthDestination(url), BcDestinationError, url);
  }
});

test("a lookalike host that merely contains an approved name is refused", () => {
  // Suffix matching is on a dot boundary, so this is not a subdomain.
  assert.throws(
    () => assertApiDestination("https://api.businesscentral.dynamics.com.evil.test/x"),
    BcDestinationError,
  );
  // A genuine subdomain is allowed.
  assert.equal(
    assertApiDestination("https://eu.api.businesscentral.dynamics.com/x").protocol,
    "https:",
  );
});

test("a blank or relative URL is refused with a usable message", () => {
  assert.throws(() => assertOAuthDestination(""), /required/);
  assert.throws(() => assertOAuthDestination("/oauth2/token"), /absolute/);
});

/* ── Rebinding a stored secret ── */

const stored = {
  oauthUrl: "https://login.microsoftonline.com/tenant-a/oauth2/v2.0/token",
  clientId: "client-a",
  username: null as string | null,
};

test("an unchanged destination keeps using the stored secret", () => {
  const changed = bcSecretRebindRequired({
    stored,
    next: { oauthUrl: stored.oauthUrl, clientId: stored.clientId },
    clientSecretSupplied: false,
    passwordSupplied: false,
  });
  assert.deepEqual(changed, []);
});

test("moving the token endpoint without a new secret is refused", () => {
  const changed = bcSecretRebindRequired({
    stored,
    next: { oauthUrl: "https://login.microsoftonline.com/tenant-b/oauth2/v2.0/token" },
    clientSecretSupplied: false,
    passwordSupplied: false,
  });
  assert.deepEqual(changed, ["oauthUrl"]);
});

test("renaming the client without a new secret is refused", () => {
  const changed = bcSecretRebindRequired({
    stored,
    next: { clientId: "client-b" },
    clientSecretSupplied: false,
    passwordSupplied: false,
  });
  assert.deepEqual(changed, ["clientId"]);
});

test("supplying the secret allows the destination to move", () => {
  const changed = bcSecretRebindRequired({
    stored,
    next: {
      oauthUrl: "https://login.microsoftonline.com/tenant-b/oauth2/v2.0/token",
      clientId: "client-b",
    },
    clientSecretSupplied: true,
    passwordSupplied: false,
  });
  assert.deepEqual(changed, []);
});

test("a password-grant connection needs its password again when the username moves", () => {
  const withUser = { ...stored, username: "svc@rocksgroup.com" };
  assert.deepEqual(
    bcSecretRebindRequired({
      stored: withUser,
      next: { username: "someone.else@rocksgroup.com" },
      clientSecretSupplied: false,
      passwordSupplied: false,
    }),
    ["username"],
  );
  assert.deepEqual(
    bcSecretRebindRequired({
      stored: withUser,
      next: { username: "someone.else@rocksgroup.com" },
      clientSecretSupplied: false,
      passwordSupplied: true,
    }),
    [],
  );
});

test("a client-credentials connection is unaffected by the username field", () => {
  // `stored.username` is null, so there is no stored password to rebind.
  assert.deepEqual(
    bcSecretRebindRequired({
      stored,
      next: { username: "anything" },
      clientSecretSupplied: false,
      passwordSupplied: false,
    }),
    [],
  );
});

test("case and surrounding space are not a change", () => {
  assert.deepEqual(
    bcSecretRebindRequired({
      stored,
      next: { oauthUrl: `  ${stored.oauthUrl.toUpperCase()}  `, clientId: " CLIENT-A " },
      clientSecretSupplied: false,
      passwordSupplied: false,
    }),
    [],
  );
});
