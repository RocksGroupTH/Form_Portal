import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * What guards the AP-2 and AP-3 *records themselves*.
 *
 * `5e91d51` closed this class of bug on the two forms' **attachments**. The
 * records were still open, measured 2026-08-28:
 * `GET /api/request/advance/requests/[id]` was `requireAuth()` -> `getRequest(id)`
 * -> return the row, so any signed-in session could read any AP-2 request — payee,
 * amounts, and for an employee payee the bank account resolved live out of HR —
 * by guessing a small integer. `clear-advance/requests/[id]` had the identical
 * shape, as did `advance/requests/[id]/attempts`. Both forms' `submit` had no
 * ownership check anywhere: the route asked nothing and the service tested only
 * the status, so anyone could submit anyone else's draft.
 *
 * There is no route harness in this repository — a route imports `@/env`, which
 * validates the whole environment at module load, and then a pool. So this reads
 * the route *sources*, the technique `adv-clr-attachment-routes.test.ts` and
 * AP-4's `settings-route-gates.test.ts` already use, and asserts three things
 * per handler:
 *
 *   1. it calls `authorizeAccRequest(..., <mode>, <its own form code>)`;
 *   2. that call is the handler's **first** `await` of any consequence — after
 *      `requireAuth()` and the `await params` unwrap Next 16 requires, and
 *      before any read, body parse, transaction, mail or SharePoint move;
 *   3. the refusal is **returned**, not merely computed.
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
}

const ROUTES: RouteCase[] = [
  {
    path: "advance/requests/[id]",
    formCode: "AP2_FORM_CODE",
    read: ["GET"],
    mutate: ["PUT", "DELETE"],
  },
  {
    path: "clear-advance/requests/[id]",
    formCode: "AP3_FORM_CODE",
    read: ["GET"],
    mutate: ["PUT", "DELETE"],
  },
  {
    path: "advance/requests/[id]/attempts",
    formCode: "AP2_FORM_CODE",
    read: ["GET"],
  },
  // Submit is a mutation of the requester's own draft, so it takes the same
  // creator-only gate AP-1's and AP-4's submit routes have carried since
  // 2026-08-19. Both of these had none at all.
  {
    path: "advance/requests/[id]/submit",
    formCode: "AP2_FORM_CODE",
    mutate: ["POST"],
  },
  {
    path: "clear-advance/requests/[id]/submit",
    formCode: "AP3_FORM_CODE",
    mutate: ["POST"],
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

function handlerBody(
  handlers: { method: string; body: string }[],
  method: string,
  where: string,
): string {
  const found = handlers.find((h) => h.method === method);
  assert.ok(found, `${where} exports no ${method} handler`);
  return found.body;
}

/**
 * What each `await` in the handler waits on, in source order.
 *
 * Comments are stripped first, or a `// ... await getRequest(id) ...` note would
 * read as a call. The two awaits every handler here legitimately performs before
 * it can authorize anything are excluded by the caller: `requireAuth()`, which
 * produces the session the gate needs, and `params`, which produces the id.
 */
function awaitedNames(body: string): string[] {
  const code = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const re = /await\s+([A-Za-z_$][\w$.]*)/g;
  const names: string[] = [];
  let m = re.exec(code);
  while (m) {
    names.push(m[1]);
    m = re.exec(code);
  }
  return names;
}

const PRE_GATE_AWAITS = ["requireAuth", "params"];

test("every AP-2/AP-3 record handler authorizes the request it reaches", async () => {
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
            "requireAuth() proves a session, not a right to this record",
        );

        // The refusal must be returned. Computing a verdict and dropping it is
        // indistinguishable from having no gate.
        assert.match(
          body,
          /if \(gate instanceof Response\) return gate;/,
          `${route.path} ${method} computes the gate's verdict without returning it`,
        );
        checked += 1;
      }
    }
  }

  assert.equal(checked, 9, "expected 9 gated handlers across the five routes");
});

test("the gate is the first thing each handler awaits, before any side effect", async () => {
  for (const route of ROUTES) {
    const source = await readRoute(route.path);
    const handlers = splitHandlers(source);

    for (const method of (route.read ?? []).concat(route.mutate ?? [])) {
      const body = handlerBody(handlers, method, route.path);
      const rest = awaitedNames(body).filter((n) => PRE_GATE_AWAITS.indexOf(n) === -1);

      assert.ok(rest.length > 0, `${route.path} ${method} awaits nothing after auth`);
      assert.equal(
        rest[0],
        "authorizeAccRequest",
        `${route.path} ${method} awaits ${rest[0]} before it authorizes — an unauthorized ` +
          "path must not read the record, parse the body, open a transaction, queue mail " +
          "or move a SharePoint folder",
      );
    }
  }
});

/**
 * AP-2's ERP interface queue is the one list endpoint that had no gate at all.
 *
 * `listAdvanceErpQueue()` takes no viewer — it returns every approved AP-2
 * request, with payee, purpose, amounts, matched vendor and PV number — and both
 * the queue and its Excel export ran on `requireAuth()` alone. The five sibling
 * handlers that *act* on those same rows (preview, send, pullback, payment-date,
 * vendor) all apply the roster predicate below already, so this is the gate the
 * directory had settled on, not a new rule.
 */
test("AP-2's ERP queue and its export are limited to the accounting roster", async () => {
  for (const path of ["advance/erp-queue", "advance/erp-queue/export"]) {
    const source = await readRoute(path);

    for (const role of ["HEAD_ACC", "ACC_OFFICER", "DIRECTOR"]) {
      assert.match(
        source,
        new RegExp(`isAdvanceApprover\\(actor\\.email, "${role}"\\)`),
        `${path} does not consult the ${role} roster`,
      );
    }
    assert.match(source, /status: 403/, `${path} has no refusal`);

    // Before the rows are fetched — refusing after the query has run has already
    // spent the work, and the export would have built the workbook first.
    const gateAt = source.indexOf("isAdvanceApprover(");
    const listAt = source.indexOf("await listAdvanceErpQueue(");
    assert.ok(gateAt >= 0 && listAt >= 0, `${path} lost a landmark`);
    assert.ok(gateAt < listAt, `${path} reads the queue before authorizing`);
  }
});
