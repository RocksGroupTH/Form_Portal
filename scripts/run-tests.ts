/**
 * Discover and run every `*.test.ts` under `src/`.
 *
 * `npm test` used to name each test file in `package.json`, which meant adding a
 * test and forgetting to list it produced a green run that had never executed it
 * — the failure mode is silent and points the wrong way. This walks the tree
 * instead, so a new file is picked up by existing.
 *
 * Written as a script rather than a shell glob because the glob would be the
 * shell's: `src/**\/*.test.ts` expands under bash and is passed through
 * uninterpreted by cmd.exe, and this repo is developed on Windows and deployed on
 * it. `fs.readdir` behaves the same everywhere.
 *
 * Node's own `--test` discovery does not help here: it matches `.js`/`.mjs`/`.cjs`
 * only, so the `.ts` files would be found by neither.
 *
 * Usage: `npm test`, or `npm test -- src/lib/storage.test.ts` to run a subset.
 */

import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(__dirname, "..");
const SEARCH_ROOT = path.join(ROOT, "src");
const SKIP_DIRS = new Set(["node_modules", ".next", ".git"]);

async function findTests(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const found: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      found.push(...(await findTests(path.join(dir, entry.name))));
    } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      found.push(path.join(dir, entry.name));
    }
  }
  // Sorted so the run order is the same on every machine — a test that only
  // passes in one order is a test worth noticing.
  return found.sort();
}

// Wrapped in a function rather than using top-level await: tsx transpiles this
// to CJS (the repo has no "type": "module"), and esbuild rejects top-level await
// in that output format.
async function main(): Promise<void> {
  const explicit = process.argv.slice(2);
  const files =
    explicit.length > 0 ? explicit.map((f) => path.resolve(ROOT, f)) : await findTests(SEARCH_ROOT);

  if (files.length === 0) {
    console.error("No *.test.ts files found under src/.");
    process.exit(1);
  }

  console.log(`Running ${files.length} test file(s).`);

  // `tsx` rather than `node --test` directly: the tests import from `@/…`, which
  // needs tsconfig path resolution.
  const child = spawn(
    process.execPath,
    [path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"), "--test"].concat(files),
    { stdio: "inherit", cwd: ROOT },
  );

  child.on("exit", (code, signal) => {
    if (signal) {
      console.error(`Test runner terminated by signal ${signal}.`);
      process.exit(1);
    }
    process.exit(code ?? 1);
  });
}

void main();
