import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * `sharepoint-path.ts` imports `@/env`, which validates the whole environment at
 * import time and throws when it cannot. `buildAccFileName` itself reads none of
 * it — only `buildAccFolderPath` does — so these four placeholders exist purely
 * to get past that import, and are set before the dynamic import below rather
 * than at the top level, where a static import would already have run.
 */
process.env.AUTH_SECRET ??= "test";
process.env.MSSQL_DATABASE ??= "test";
process.env.MSSQL_USER ??= "test";
process.env.MSSQL_PASSWORD ??= "test";

// Awaited inside each test, not at the top level: tsx compiles these to CJS,
// where top-level await is a build error.
const load = () => import("./sharepoint-path");

const base = {
  typeLabel: "ค่าน้ำมัน",
  requestNo: "TOF26-0001",
  requestId: 42,
  fileId: 7,
};

test("an explicit extension wins over the original name's", async () => {
  const { buildAccFileName } = await load();
  const name = buildAccFileName({ ...base, originalName: "photo.jpeg", extension: "jpg" });
  assert.ok(name.endsWith(".jpg"), name);
});

/**
 * `checkAttachment`'s `UNKNOWN_BINARY` carries a blank extension, meaning "keep
 * the uploader's". Without this, `??` passes the empty string straight through —
 * an empty string is not nullish — and every unrecognised upload is stored as
 * `…_7.`: a trailing dot and no type, on a file somebody has to open later.
 */
test("a blank extension falls back to the original name's, not to an empty one", async () => {
  const { buildAccFileName } = await load();
  const name = buildAccFileName({ ...base, originalName: "สัญญา.docx", extension: "" });
  assert.ok(name.endsWith(".docx"), name);
});

test("a file with no extension at all still gets a usable one", async () => {
  const { buildAccFileName } = await load();
  const name = buildAccFileName({ ...base, originalName: "scan", extension: "" });
  assert.ok(name.endsWith(".bin"), name);
});
