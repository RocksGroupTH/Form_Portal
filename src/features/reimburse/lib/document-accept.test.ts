import { test } from "node:test";
import assert from "node:assert/strict";
// Relative, not "@/": tsx does not resolve the alias for a bare test run.
import { isAcceptedDocument } from "./document-accept";

test("the three kinds AP-4 reads are accepted by MIME type", () => {
  assert.equal(isAcceptedDocument("scan", "image/jpeg"), true);
  assert.equal(isAcceptedDocument("quote", "application/pdf"), true);
  assert.equal(
    isAcceptedDocument("ap41", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    true,
  );
});

test("the extension decides when the browser gives no type", () => {
  // A drag from some file managers, and SharePoint downloads, arrive as "" or
  // application/octet-stream. Refusing those would reject ordinary files.
  for (const name of ["a.png", "b.JPG", "c.pdf", "d.xlsx", "e.xls", "f.xlsm", "g.heic"]) {
    assert.equal(isAcceptedDocument(name, ""), true, name);
    assert.equal(isAcceptedDocument(name, "application/octet-stream"), true, name);
  }
});

test("anything else is refused", () => {
  for (const [name, type] of [
    ["virus.exe", "application/x-msdownload"],
    ["page.html", "text/html"],
    ["archive.zip", "application/zip"],
    ["notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["noextension", ""],
  ] as const) {
    assert.equal(isAcceptedDocument(name, type), false, name);
  }
});

test("a misleading name cannot smuggle a type past this, and does not need to", () => {
  // The declared type wins when it is one we take, and the name is only a
  // fallback — but neither is a control. `checkAttachment` on the upload route
  // sniffs magic bytes and is what actually decides; this only keeps an
  // obviously wrong pick out of the pending list before any of that.
  assert.equal(isAcceptedDocument("evil.exe", "image/png"), true);
  assert.equal(isAcceptedDocument("photo.png", "application/x-msdownload"), true);
});
