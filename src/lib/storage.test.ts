import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

/**
 * `UPLOAD_DIR` is captured at module load, so the temporary root has to be in
 * the environment before the first import. Hence the dynamic import inside
 * `before()` rather than a top-level one.
 */
let storage: typeof import("./storage");
let root: string;
let outsideMarker: string;

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "form-portal-storage-"));
  process.env.UPLOAD_ROOT = root;
  storage = await import("./storage");

  // A file next to the root, standing in for anything the traversal could
  // reach. Tests assert it is untouched; nothing is ever written outside the
  // temporary fixture.
  outsideMarker = path.join(path.dirname(root), `${path.basename(root)}-outside.txt`);
  await fs.writeFile(outsideMarker, "original");
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  await fs.rm(outsideMarker, { force: true }).catch(() => {});
});

/**
 * What the deleted generic-form upload route built from request input:
 * `submissions/{id}/{fieldKey}/{ts}_{name}`, with `fieldKey` and the file name
 * both caller-chosen. Enough `..` segments and the write lands outside the
 * root. Both Accounting stacks read `AccRequestFile.StoragePath` back into
 * `downloadFile`/`deleteFile`, so the same shape reaches the read and unlink
 * paths from the database side.
 */
const ESCAPES = [
  "submissions/1/../../../../escaped.txt",
  "../escaped.txt",
  "a/b/../../../escaped.txt",
  "./../../escaped.txt",
];

test("a traversing path is refused on write, and nothing lands outside the root", async () => {
  for (const p of ESCAPES) {
    await assert.rejects(
      () => storage.uploadFile(p, Buffer.from("payload")),
      storage.StoragePathError,
      `expected ${p} to be refused`,
    );
  }
  assert.equal(await fs.readFile(outsideMarker, "utf8"), "original");
});

test("a traversing path is refused on read", async () => {
  for (const p of ESCAPES) {
    await assert.rejects(() => storage.downloadFile(p), storage.StoragePathError);
  }
});

test("a traversing path is refused on delete, and the outside file survives", async () => {
  for (const p of ESCAPES) {
    await assert.rejects(() => storage.deleteFile(p), storage.StoragePathError);
  }
  assert.equal(await fs.readFile(outsideMarker, "utf8"), "original");
});

test("an absolute path is refused rather than replacing the root", async () => {
  // path.resolve(root, "/etc/passwd") is "/etc/passwd" — the root drops out
  // entirely, so this never reaches the relative-path containment test.
  const absolute = path.join(path.dirname(root), "absolute.txt");
  await assert.rejects(() => storage.uploadFile(absolute, Buffer.from("x")), storage.StoragePathError);
  await assert.rejects(() => storage.downloadFile(absolute), storage.StoragePathError);
  await assert.rejects(() => storage.deleteFile("C:\\Windows\\System32\\drivers\\etc\\hosts"), storage.StoragePathError);
});

test("an empty path is refused rather than resolving to the root itself", async () => {
  await assert.rejects(() => storage.uploadFile("", Buffer.from("x")), storage.StoragePathError);
  await assert.rejects(() => storage.downloadFile("   "), storage.StoragePathError);
});

test("an ordinary nested path still round-trips", async () => {
  const rel = path.join("AP-1", "2026", "receipt.png");
  await storage.uploadFile(rel, Buffer.from("bytes"));
  assert.equal((await storage.downloadFile(rel)).toString(), "bytes");

  await storage.deleteFile(rel);
  await assert.rejects(() => storage.downloadFile(rel), (err: NodeJS.ErrnoException) => err.code === "ENOENT");
});

test("deleting a file that is already gone stays silent — only traversal raises", async () => {
  await storage.deleteFile("AP-1/never-existed.png");
});
