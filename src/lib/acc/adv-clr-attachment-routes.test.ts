import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * What actually guards AP-2's and AP-3's attachments.
 *
 * There is no route harness in this repository — a route imports `@/env`, which
 * validates the whole environment at module load, and then a pool. So this reads
 * the route *sources*, the same technique AP-4's `settings-route-gates.test.ts`
 * uses, and asserts the three properties that were missing until 2026-08-28 and
 * that compose into a stored-XSS-plus-IDOR chain if any one of them comes back:
 *
 *  1. **Object authorization on the parent request.** Both download routes ran
 *     `requireAuth()` and then streamed the bytes, so any signed-in user could
 *     read anyone's financial attachments by guessing a small integer.
 *  2. **A magic-byte guard on upload, storing the sniffed type.** Neither form
 *     called `checkAttachment`; both stored `file.type` — the browser's claim,
 *     verbatim.
 *  3. **`attachmentResponseHeaders` on download.** Both served the stored claim
 *     back `inline` with no `nosniff` and no sandbox CSP, so an uploaded HTML
 *     file claiming `text/html` executed on this origin with the reader's
 *     session.
 *
 * None of these is visible from the outside of a working route: a missing gate
 * looks exactly like a present one to the person who is authorized anyway.
 *
 * Every search is for `await <call>(`, never a bare mention — a route's comments
 * name what it does as often as its code does, and prose is not a call.
 */

const API_ROOT = "../../app/api/request";

interface RouteCase {
  /** Path under `src/app/api/request`, without the trailing `route.ts`. */
  path: string;
  /** The form code every `authorizeAccRequest` call in this file must pin. */
  formCode: "AP2_FORM_CODE" | "AP3_FORM_CODE";
  /** Handlers that must gate with `"read"`. */
  read?: string[];
  /** Handlers that must gate with `"mutate"`. */
  mutate?: string[];
  /** Handlers that stream stored bytes back. */
  serves?: string[];
  /** Handlers that accept an upload. */
  accepts?: string[];
}

const ROUTES: RouteCase[] = [
  {
    path: "advance/files/[fileId]",
    formCode: "AP2_FORM_CODE",
    read: ["GET"],
    mutate: ["DELETE"],
    serves: ["GET"],
  },
  {
    path: "clear-advance/files/[fileId]",
    formCode: "AP3_FORM_CODE",
    read: ["GET"],
    serves: ["GET"],
  },
  {
    path: "advance/requests/[id]/files",
    formCode: "AP2_FORM_CODE",
    read: ["GET"],
    mutate: ["POST"],
    accepts: ["POST"],
  },
  {
    path: "clear-advance/requests/[id]/files",
    formCode: "AP3_FORM_CODE",
    mutate: ["POST", "DELETE"],
    accepts: ["POST"],
  },
];

async function readSource(relative: string): Promise<string> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  return fs.readFile(path.resolve(__dirname, relative), "utf8");
}

const readRoute = (p: string) => readSource(`${API_ROOT}/${p}/route.ts`);

/**
 * Each exported HTTP handler, as `[method, body-from-here]`.
 *
 * The body runs to the next handler rather than to a closing brace: finding the
 * real end would mean counting braces through strings and comments, and a file
 * with one handler is then simply the whole tail.
 */
function splitHandlers(source: string): { method: string; body: string }[] {
  const decl = /export async function (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(/g;
  const starts: { method: string; at: number }[] = [];
  let m = decl.exec(source);
  while (m) {
    starts.push({ method: m[1], at: m.index });
    m = decl.exec(source);
  }
  return starts.map((s, i) => ({
    method: s.method,
    body: source.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : source.length),
  }));
}

function handlerBody(handlers: { method: string; body: string }[], method: string, where: string): string {
  const found = handlers.find((h) => h.method === method);
  assert.ok(found, `${where} exports no ${method} handler`);
  return found.body;
}

test("every AP-2/AP-3 attachment handler authorizes on the parent request", async () => {
  let checked = 0;

  for (const route of ROUTES) {
    const source = await readRoute(route.path);
    const handlers = splitHandlers(source);
    assert.ok(handlers.length > 0, `${route.path} exports no HTTP handler`);

    for (const [mode, methods] of [
      ["read", route.read ?? []],
      ["mutate", route.mutate ?? []],
    ] as const) {
      for (const method of methods) {
        const body = handlerBody(handlers, method, route.path);
        const call = new RegExp(
          `await authorizeAccRequest\\([^;]*?"${mode}",\\s*${route.formCode}\\s*\\)`,
        );
        assert.match(
          body,
          call,
          `${route.path} ${method} must call authorizeAccRequest(..., "${mode}", ${route.formCode}) — ` +
            "authorizing the file's parent request, pinned to the form, is the whole control",
        );
        checked += 1;
      }
    }

    // Every handler that gates does so against the *parent request id*, never the
    // file id. A file id is a small sequential integer shared across every form
    // in AccRequestFile; AP-4's route states the same rule in its header.
    assert.doesNotMatch(
      source,
      /authorizeAccRequest\(\s*session,\s*fileId/,
      `${route.path} authorizes on a file id — it must authorize on the parent request`,
    );
  }

  assert.equal(checked, 7, "expected 7 gated handlers across the four routes");
});

test("the upload routes admit files by their bytes and store the sniffed type", async () => {
  for (const route of ROUTES) {
    for (const method of route.accepts ?? []) {
      const source = await readRoute(route.path);
      const body = handlerBody(splitHandlers(source), method, route.path);

      assert.match(
        body,
        /checkAttachment\(\{/,
        `${route.path} ${method} must admit uploads through checkAttachment`,
      );
      assert.match(
        body,
        /checkAttachmentBatch\(/,
        `${route.path} ${method} must bound the batch with checkAttachmentBatch`,
      );
      assert.match(
        body,
        /contentType = check\.type\.contentType/,
        `${route.path} ${method} must store the sniffed type, not file.type`,
      );
      // `file.type || "application/octet-stream"` is exactly what was stored
      // before, and it is the browser's claim rather than a fact about the bytes.
      assert.doesNotMatch(
        body,
        /contentType = file\.type/,
        `${route.path} ${method} stores the declared type — the bytes must decide`,
      );
      // The gate has to precede the multipart read: refusing after buffering the
      // body has already spent the work an unauthorized caller asked for.
      const gateAt = body.indexOf("await authorizeAccRequest(");
      const formDataAt = body.indexOf("req.formData()");
      assert.ok(gateAt >= 0 && formDataAt >= 0, `${route.path} ${method} lost a landmark`);
      assert.ok(
        gateAt < formDataAt,
        `${route.path} ${method} reads the body before authorizing`,
      );
    }
  }
});

test("the download routes serve through attachmentResponseHeaders", async () => {
  for (const route of ROUTES) {
    for (const method of route.serves ?? []) {
      const source = await readRoute(route.path);
      const body = handlerBody(splitHandlers(source), method, route.path);

      assert.match(
        body,
        /headers: attachmentResponseHeaders\(\{/,
        `${route.path} ${method} must serve through attachmentResponseHeaders — it re-sniffs ` +
          "the bytes and forces a download with nosniff + a sandbox CSP for anything non-raster",
      );
      // A hand-written header set is how the stored ContentType got echoed back
      // `inline` in the first place.
      assert.doesNotMatch(
        body,
        /"Content-Disposition":/,
        `${route.path} ${method} writes Content-Disposition by hand`,
      );
      assert.doesNotMatch(
        body,
        /"Content-Type": (file|contentType)/,
        `${route.path} ${method} echoes the stored content type`,
      );
    }
  }
});

/**
 * The ACL's account-area arm has to know each form's own approver roster.
 *
 * `canAccessAccountArea` answers AP-1's `AccApprover`. AP-2 keeps
 * `AccAdvanceApprover` and AP-3 keeps `AccClearAdvanceApprover`, so gating the
 * routes above without teaching `buildAccAclViewer` those two lists would lock
 * every legitimate AP-2/AP-3 approver out of the documents they are configured
 * to approve — a worse outcome than the bug being fixed, and one that only shows
 * up in production because nothing else in the test suite opens a roster.
 */
test("buildAccAclViewer consults AP-2's and AP-3's own approver rosters", async () => {
  const source = await readSource("./request-acl.ts");

  assert.match(source, /isAdvanceApprover/, "AP-2's roster is not consulted");
  assert.match(source, /isClrApprover/, "AP-3's roster is not consulted");
  assert.match(
    source,
    /formCode === AP2_FORM_CODE/,
    "the AP-2 roster lookup is not keyed on the row's form",
  );
  assert.match(
    source,
    /formCode === AP3_FORM_CODE/,
    "the AP-3 roster lookup is not keyed on the row's form",
  );
  // Keyed on the row's own form, so the widening is one-way: an AP-2 approver
  // gains nothing on an AP-1, AP-3 or AP-4 row.
  assert.match(
    source,
    /formCode: row\.formCode/,
    "the viewer is built from the caller's hint rather than the row's own form",
  );
});
