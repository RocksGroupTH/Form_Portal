/**
 * The one way this app reaches `xlsx-js-style`.
 *
 * **Why a helper rather than `await import("xlsx-js-style")` at each site.**
 * The package is CommonJS. Under a dynamic `import()` its real API lands on
 * `.default` in some loaders and directly on the namespace in others, while
 * the bundled type declarations advertise the named exports either way — so
 * `XLSX.read(...)` type-checks, builds, and then throws
 * `Cannot read properties of undefined` at runtime on whichever loader
 * disagreed. Measured, not theorised: `Object.keys()` on the namespace under
 * tsx is exactly `["default", "module.exports"]`.
 *
 * `xlsx-js-style`, never plain `xlsx` — the old SheetJS CE releases carry
 * advisories, which is why this project depends on the styled fork.
 *
 * Imported lazily by callers: the parser is around a megabyte, and most
 * requests and page views never touch a workbook.
 */

type XlsxModule = typeof import("xlsx-js-style");

/** Resolve the module's real shape, whichever way the loader wrapped it. */
export async function loadXlsx(): Promise<XlsxModule> {
  const mod = (await import("xlsx-js-style")) as unknown;
  return normalizeXlsx(mod);
}

/**
 * Split out and exported so the interop rule itself has a unit test — the
 * failure it guards against is invisible to both `tsc` and `next build`.
 */
export function normalizeXlsx(mod: unknown): XlsxModule {
  const candidates = [mod, (mod as { default?: unknown })?.default];
  for (const c of candidates) {
    if (c && typeof (c as { read?: unknown }).read === "function") return c as XlsxModule;
  }
  throw new Error("xlsx-js-style did not expose read(); the module shape changed");
}
