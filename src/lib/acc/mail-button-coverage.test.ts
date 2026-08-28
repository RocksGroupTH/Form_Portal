import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Every notification this app sends must carry a button to the document.
 *
 * Not a rule anyone can hold in their head: the mail bodies are hand-written
 * HTML in seven places across five features, and AP-3 shipped two of them with
 * a **relative** href — dead in every mail client — while the other five built
 * absolute URLs. Nothing caught it, because nothing was looking.
 *
 * So this looks. It reads the source of every file that calls `queueEmail` and
 * requires each to produce a link, either through `mail-link.ts` or through a
 * template module that does. A new sender that forgets fails here rather than
 * in somebody's inbox.
 */

const SRC = path.resolve(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

/** Files that send mail, by calling queueEmail with a body. */
function mailSenders(): string[] {
  return walk(SRC).filter((p) => {
    if (p.endsWith(path.join("acc", "email-queue.ts"))) return false; // the queue itself
    const s = fs.readFileSync(p, "utf8");
    return /queueEmail\(/.test(s) && /bodyHtml/i.test(s);
  });
}

/** Whether a file produces a document link itself, or imports something that does. */
function producesLink(file: string): boolean {
  const s = fs.readFileSync(file, "utf8");
  if (/documentButton\s*\(/.test(s)) return true;
  // Or it delegates to a template module — which this test checks in its own right.
  return /build[A-Za-z]*Email\s*\(/.test(s);
}

test("every file that sends mail produces a link to the document", () => {
  const senders = mailSenders();
  // A guard on the guard: if a refactor moves every send behind one helper,
  // this test would pass by finding nothing. Fail loudly instead.
  assert.ok(senders.length >= 5, `expected to find mail senders, found ${senders.length}`);

  const missing = senders.filter((f) => !producesLink(f)).map((f) => path.relative(SRC, f));
  assert.deepEqual(missing, [], `these send mail with no document link: ${missing.join(", ")}`);
});

test("no mail body builds a relative link", () => {
  const offenders: string[] = [];
  for (const f of walk(SRC)) {
    const s = fs.readFileSync(f, "utf8");
    // A relative href inside a template literal — the AP-3 bug. Comments quoting
    // the old code are stripped first so the record of it does not fail this.
    const code = s.replace(/^\s*(\/\/|\*|\/\*).*$/gm, "");
    if (/href="\/(request|forms)\//.test(code)) offenders.push(path.relative(SRC, f));
  }
  assert.deepEqual(offenders, [], `relative mail links found in: ${offenders.join(", ")}`);
});
