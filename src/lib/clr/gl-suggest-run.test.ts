import test from "node:test";
import assert from "node:assert/strict";
import {
  branchesToLoad,
  runGlSuggestions,
  type GlCandidate,
  type PlanLine,
} from "./gl-suggest-run";

/** Line index → the account that line's description has always been given
 *  before, the way the route computes it from `decideRemembered`. */
const remembered = (entries: Record<number, string>) =>
  new Map<number, string>(Object.entries(entries).map(([i, acct]) => [Number(i), acct]));

/**
 * What the account step's suggest button does with the model's answers.
 *
 * The route this belongs to cannot be imported here: it pulls `@/lib/db/mssql`
 * → `@/env`, which validates the environment at module scope and throws under
 * `tsx` with no env file (same note as
 * `src/app/api/request/clear-advance/report/export/route.test.ts`). That is why
 * the deciding half of the route lives in `gl-suggest-run.ts` and is tested
 * here, with the model call handed in as a plain function — **no test in this
 * file calls a model.**
 *
 * The sequencing case is the one worth keeping: `Promise.all` over the targets
 * is the edit a later reader is most likely to make, and only the order the
 * fake records can tell the difference.
 */

const line = (over: Partial<PlanLine> = {}): PlanLine => ({
  glAccountNo: "",
  amountBeforeVat: 100,
  description: "ค่าแท็กซี่",
  branchCode: "HQ01",
  ...over,
});

const gl = (no: string): GlCandidate => ({ glAccountNo: no, nameTh: `บัญชี ${no}`, nameEn: null });

const HQ: GlCandidate[] = [gl("610322005"), gl("610322006")];
const PC01: GlCandidate[] = [gl("620100001")];

const candidates = (entries: Record<string, GlCandidate[]> = { HQ01: HQ }) =>
  new Map<string, readonly GlCandidate[]>(Object.entries(entries));

/** A model that always answers with the first account it is offered. */
const always: (calls: string[]) => Parameters<typeof runGlSuggestions>[2] =
  (calls) => async (description, list) => {
    calls.push(description);
    return list[0].glAccountNo;
  };

test("only the targets are asked about", async () => {
  const calls: string[] = [];
  const items = [
    line({ description: "ค่าแท็กซี่" }),
    line({ glAccountNo: "610322005", description: "ตั้งบัญชีแล้ว" }),
    line({ description: "  " }),
    line({ branchCode: "", description: "ไม่มีสาขา" }),
    line({ amountBeforeVat: 0, description: "ยอดศูนย์" }),
  ];
  const out = await runGlSuggestions(items, candidates(), always(calls));

  assert.deepEqual(calls, ["ค่าแท็กซี่"], "a line outside targets was sent to the model");
  assert.deepEqual(out.suggestions, [
    { index: 0, glAccountNo: "610322005", nameTh: "บัญชี 610322005", source: "model" },
  ]);
  assert.equal(out.noDescription, 1);
  assert.equal(out.noBranch, 1);
  assert.equal(out.noAnswer, 0);
});

test("itemCount is every line, not just the ones asked about", async () => {
  const items = [line(), line({ glAccountNo: "610322005" }), line({ amountBeforeVat: 0 })];
  const out = await runGlSuggestions(items, candidates(), always([]));
  assert.equal(out.itemCount, 3);
  assert.equal(out.itemCount, items.length);
});

test("the calls are sequential — the next one starts after the last has finished", async () => {
  const events: string[] = [];
  // Descending delays on purpose: run in parallel, the second call would both
  // start before the first ended AND finish first. Either shows up in `events`.
  const delays: Record<string, number> = { one: 20, two: 10, three: 0 };
  const suggest = async (description: string, list: GlCandidate[]) => {
    events.push(`start ${description}`);
    await new Promise((r) => setTimeout(r, delays[description] ?? 0));
    events.push(`end ${description}`);
    return list[0].glAccountNo;
  };

  const items = [line({ description: "one" }), line({ description: "two" }), line({ description: "three" })];
  await runGlSuggestions(items, candidates(), suggest);

  assert.deepEqual(events, [
    "start one", "end one",
    "start two", "end two",
    "start three", "end three",
  ], "a call began before the one before it had finished — Promise.all, not a loop");
});

test("every target is accounted for: answered or counted as no answer", async () => {
  const answers = ["610322005", "", "นึกไม่ออกครับ", "610322006"];
  let i = 0;
  const suggest = async () => answers[i++] ?? "";
  const items = [line(), line(), line(), line()];
  const out = await runGlSuggestions(items, candidates(), suggest);

  assert.equal(out.suggestions.length + out.noAnswer, 4, "a target fell out of both buckets");
  assert.equal(out.suggestions.length, 2);
  assert.equal(out.noAnswer, 2);
});

test("an answer that is not on the branch's list is no answer at all", async () => {
  const out = await runGlSuggestions([line()], candidates(), async () => "620100001");
  assert.deepEqual(out.suggestions, [], "an account this branch may not charge was offered");
  assert.equal(out.noAnswer, 1);
});

test("a model error on one line does not lose the others", async () => {
  const items = [line({ description: "หนึ่ง" }), line({ description: "สอง" }), line({ description: "สาม" })];
  const suggest = async (description: string, list: GlCandidate[]) => {
    if (description === "สอง") throw new Error("429 rate limited");
    return list[0].glAccountNo;
  };
  const out = await runGlSuggestions(items, candidates(), suggest);

  assert.deepEqual(out.suggestions.map((s) => s.index), [0, 2]);
  assert.equal(out.noAnswer, 1);
  assert.equal(out.suggestions.length + out.noAnswer, 3);
});

test("each line is matched against its own branch's accounts", async () => {
  const items = [line({ branchCode: "HQ01" }), line({ branchCode: "PC01" })];
  const seen: number[] = [];
  const suggest = async (_d: string, list: GlCandidate[]) => {
    seen.push(list.length);
    return list[0].glAccountNo;
  };
  const out = await runGlSuggestions(items, candidates({ HQ01: HQ, PC01: PC01 }), suggest);

  assert.deepEqual(seen, [2, 1], "a line was offered another branch's accounts");
  assert.deepEqual(out.suggestions.map((s) => s.glAccountNo), ["610322005", "620100001"]);
});

test("a branch with no accounts is raised, never reported as the model declining", async () => {
  await assert.rejects(
    () => runGlSuggestions([line({ branchCode: "PC01" })], candidates({ PC01: [] }), always([])),
    /PC01/,
    "an empty candidate list was allowed to look like a normal empty answer",
  );
});

test("branchesToLoad asks for each branch once, and only for targets", () => {
  const items = [
    line({ branchCode: "HQ01" }),
    line({ branchCode: "HQ01" }),
    line({ branchCode: "PC01" }),
    line({ branchCode: "W001", glAccountNo: "610322005" }),
    line({ branchCode: "W002", description: "" }),
    line({ branchCode: "" }),
  ];
  assert.deepEqual(branchesToLoad(items), ["HQ01", "PC01"]);
});

test("nothing to ask means nothing to load and nothing to report", async () => {
  const items = [line({ glAccountNo: "610322005" }), line({ amountBeforeVat: 0 })];
  assert.deepEqual(branchesToLoad(items), []);
  const out = await runGlSuggestions(items, new Map(), always([]));
  assert.deepEqual(out, {
    itemCount: 2,
    targetCount: 0,
    suggestions: [],
    noDescription: 0,
    noBranch: 0,
    noAnswer: 0,
  });
});

/* ───────────── what the run thought it was asking about ───────────── */

/**
 * `targetCount` exists for one reader: the screen, which planned its own
 * targets from the grid in the browser and needs to know whether the server —
 * planning from the claim as saved — saw the same ones. It is the only number
 * on the payload the screen cannot work out for itself, so it has to describe
 * the run that actually happened.
 *
 * The third case is the whole reason it is a separate field. Every other case
 * here would pass just as well against `suggestions.length`.
 */

test("targetCount is the lines the run asked about, not the lines of the claim", async () => {
  const items = [
    line({ description: "ค่าแท็กซี่" }),
    line({ description: "ค่าที่จอดรถ" }),
    line({ glAccountNo: "610322005", description: "ตั้งบัญชีแล้ว" }),
    line({ description: "  " }),
    line({ branchCode: "", description: "ไม่มีสาขา" }),
  ];
  const calls: string[] = [];
  const out = await runGlSuggestions(items, candidates(), always(calls));

  assert.equal(out.targetCount, 2, "targetCount did not match the lines actually asked about");
  assert.equal(out.targetCount, calls.length);
  assert.equal(out.itemCount, 5, "targetCount and itemCount are not the same number");
});

test("targetCount is 0 when there is nothing eligible to ask about", async () => {
  const items = [
    line({ glAccountNo: "610322005" }),
    line({ amountBeforeVat: 0 }),
    line({ description: "" }),
    line({ branchCode: "" }),
  ];
  const out = await runGlSuggestions(items, candidates(), always([]));
  assert.equal(out.targetCount, 0);
});

test("targetCount counts the targets even when the model answers none of them", async () => {
  // The distinguishing case: three lines asked about, nothing usable back, so
  // `suggestions.length` is 0 and `targetCount` is still 3. A screen comparing
  // its button against the answers instead of against the plan would read this
  // perfectly ordinary run as a disagreement on every line.
  const items = [line(), line(), line()];
  const out = await runGlSuggestions(items, candidates(), async () => "นึกไม่ออกครับ");

  assert.equal(out.targetCount, 3, "targetCount followed the suggestions instead of the plan");
  assert.equal(out.suggestions.length, 0);
  assert.equal(out.noAnswer, 3);
});

/* ───────────── what was already decided, before asking ───────────── */

/**
 * The remembered half. The route works out WHICH account a line's description
 * has always been given (`decideRemembered`); this module's job is only to
 * prefer it, to hold it to the same standard as the model's answer, and to say
 * where each filled value came from.
 *
 * The case worth the most here is the third one: a remembered account that is
 * no longer on the branch's list must be dropped. Being right once does not
 * survive an account being deactivated, and nothing on screen would show the
 * difference — a dead account reads exactly like a live one until someone
 * tries to post it.
 */

test("a remembered line is filled without asking the model", async () => {
  const calls: string[] = [];
  const items = [line({ description: "ค่าแท็กซี่" }), line({ description: "ค่าที่จอดรถ" })];
  const out = await runGlSuggestions(items, candidates(), always(calls), remembered({ 0: "610322006" }));

  assert.deepEqual(calls, ["ค่าที่จอดรถ"], "a line that was already remembered was sent to the model");
  assert.deepEqual(out.suggestions, [
    { index: 0, glAccountNo: "610322006", nameTh: "บัญชี 610322006", source: "history" },
    { index: 1, glAccountNo: "610322005", nameTh: "บัญชี 610322005", source: "model" },
  ]);
  assert.equal(out.noAnswer, 0);
});

test("a remembered account the branch may no longer charge falls through to the model", async () => {
  const calls: string[] = [];
  // 620100001 is PC01's account, not HQ01's — the same shape as an account
  // deactivated or moved to another dimension type since it was chosen.
  const items = [line({ description: "ค่าแท็กซี่" })];
  const out = await runGlSuggestions(items, candidates(), always(calls), remembered({ 0: "620100001" }));

  assert.deepEqual(calls, ["ค่าแท็กซี่"], "a remembered account skipped the candidate check");
  assert.deepEqual(out.suggestions, [
    { index: 0, glAccountNo: "610322005", nameTh: "บัญชี 610322005", source: "model" },
  ]);
});

test("a remembered account is matched against its own line's branch, not the claim's", async () => {
  const items = [line({ branchCode: "HQ01" }), line({ branchCode: "PC01" })];
  const out = await runGlSuggestions(
    items,
    candidates({ HQ01: HQ, PC01: PC01 }),
    always([]),
    // Each is the OTHER branch's account: neither may be taken from history.
    remembered({ 0: "620100001", 1: "610322005" }),
  );
  assert.deepEqual(out.suggestions.map((s) => s.source), ["model", "model"]);
});

test("the model calls are still sequential when only some lines are remembered", async () => {
  const events: string[] = [];
  const delays: Record<string, number> = { one: 20, two: 10, three: 0 };
  const suggest = async (description: string, list: GlCandidate[]) => {
    events.push(`start ${description}`);
    await new Promise((r) => setTimeout(r, delays[description] ?? 0));
    events.push(`end ${description}`);
    return list[0].glAccountNo;
  };

  const items = [
    line({ description: "one" }),
    line({ description: "remembered" }),
    line({ description: "two" }),
    line({ description: "three" }),
  ];
  await runGlSuggestions(items, candidates(), suggest, remembered({ 1: "610322006" }));

  assert.deepEqual(events, [
    "start one", "end one",
    "start two", "end two",
    "start three", "end three",
  ], "a call began before the one before it had finished — Promise.all, not a loop");
});

test("every target is still accounted for once history is in play", async () => {
  const answers = ["610322005", "", "610322006"];
  let i = 0;
  const suggest = async () => answers[i++] ?? "";
  const items = [line(), line(), line(), line(), line({ glAccountNo: "610322005" })];
  const out = await runGlSuggestions(items, candidates(), suggest, remembered({ 1: "610322006" }));

  assert.equal(out.suggestions.length + out.noAnswer, 4, "a target fell out of both buckets");
  assert.equal(out.suggestions.filter((s) => s.source === "history").length, 1);
  assert.equal(out.suggestions.filter((s) => s.source === "model").length, 2);
  assert.equal(out.noAnswer, 1);
});

test("a remembered entry for a line nobody is asking about changes nothing", async () => {
  const calls: string[] = [];
  const items = [line({ glAccountNo: "610322005", description: "ตั้งบัญชีแล้ว" }), line()];
  const out = await runGlSuggestions(items, candidates(), always(calls), remembered({ 0: "610322006" }));

  assert.deepEqual(calls, ["ค่าแท็กซี่"]);
  assert.deepEqual(out.suggestions.map((s) => s.index), [1], "a line the officer had already answered was overwritten");
});
