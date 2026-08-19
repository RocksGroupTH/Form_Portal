import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

/**
 * `@/lib/acc/stored-file` reaches SharePoint through `@/lib/sharepoint`, which
 * needs Graph credentials, so the test covers the half that is decidable without
 * a network: the local backend, and the two shapes that must not be dispatched
 * anywhere at all (an empty path, a `'pending'` placeholder). The
 * SharePoint-vs-local *choice* is one `if` over `StorageBackend`; what the
 * finding was about is that the column was never selected, and that is now a
 * type error rather than a silent miss.
 */
let storedFile: typeof import("./stored-file");
let root: string;

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "form-portal-stored-"));
  process.env.UPLOAD_ROOT = root;
  storedFile = await import("./stored-file");
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true }).catch(() => {});
});

test("a local file is removed", async () => {
  const rel = path.join("AP-1", "receipt.png");
  await fs.mkdir(path.join(root, "AP-1"), { recursive: true });
  await fs.writeFile(path.join(root, rel), "bytes");

  const failure = await storedFile.deleteStoredFile({
    storagePath: rel,
    storageBackend: "local",
  });
  assert.equal(failure, null);
  await assert.rejects(() => fs.stat(path.join(root, rel)));
});

test("a null backend is treated as local, matching the pre-SharePoint rows", async () => {
  const rel = "legacy.png";
  await fs.writeFile(path.join(root, rel), "bytes");

  const failure = await storedFile.deleteStoredFile({ storagePath: rel, storageBackend: null });
  assert.equal(failure, null);
  await assert.rejects(() => fs.stat(path.join(root, rel)));
});

test("an unfinished placeholder row is a no-op, not a failure", async () => {
  // The upload routes insert `StoragePath = ''`, `StorageBackend = 'pending'`
  // to allocate an id before the bytes are stored.
  assert.equal(await storedFile.deleteStoredFile({ storagePath: "", storageBackend: "pending" }), null);
  assert.equal(await storedFile.deleteStoredFile({ storagePath: null, storageBackend: null }), null);
  assert.equal(await storedFile.deleteStoredFile({ storagePath: "x", storageBackend: "pending" }), null);
});

test("a file that is already gone is not a failure", async () => {
  assert.equal(
    await storedFile.deleteStoredFile({ storagePath: "never-existed.png", storageBackend: "local" }),
    null,
  );
});

test("a traversing path is reported rather than followed or ignored", async () => {
  // `deleteFile` raises `StoragePathError` for these; the point here is that the
  // batch reports it instead of `.catch(() => {})` hiding it.
  const failure = await storedFile.deleteStoredFile({
    storagePath: "../../escaped.txt",
    storageBackend: "local",
  });
  assert.notEqual(failure, null);
  assert.match(failure!.message, /upload root/);
});

test("a batch reports every failure and still processes the rest", async () => {
  const rel = "batch-ok.png";
  await fs.writeFile(path.join(root, rel), "bytes");

  const failures = await storedFile.deleteStoredFiles(
    [
      { storagePath: "../../escaped.txt", storageBackend: "local" },
      { storagePath: rel, storageBackend: "local" },
    ],
    "test batch",
  );
  assert.equal(failures.length, 1);
  // The good one still went.
  await assert.rejects(() => fs.stat(path.join(root, rel)));
});

test("an empty batch reports nothing", async () => {
  assert.deepEqual(await storedFile.deleteStoredFiles([], "test batch"), []);
});
