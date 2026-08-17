import { sanitizeSegment } from "@/lib/sharepoint";
import { env } from "@/env";

export const FORM_CODE = "AP-1";
export const DRAFT_DIR = "_DRAFT";

/** Christian year from a running number like "TOF26-0011" (26 → 2026). */
export function yearFromRequestNo(requestNo: string | null): number | null {
  if (!requestNo) return null;
  const m = /^[A-Za-z]+(\d{2})-/.exec(requestNo);
  if (!m) return null;
  return 2000 + Number(m[1]);
}

/**
 * Drive-root-relative folder for a request's files.
 *
 * `environment` is **required**, with no default. Both environments share one
 * SharePoint library, so a caller that forgets it writes a UAT request's
 * attachments — national-ID scans among them — into the live tree, under a
 * request number no production row references, where nothing will ever clean
 * them up. That failure is invisible: `StoragePath` holds a Graph driveItem id,
 * so downloads keep working from either folder. Making the field mandatory is
 * what turns "somebody has to remember" into a compile error; it caught three
 * callers that had omitted it (`reuse-idcard`, and both submit routes' draft
 * folder move).
 *
 * Pass `await resolveFormEnvironment()` from a route under `/api/request` — the
 * path is classified, so it answers for the record being written.
 */
export function buildAccFolderPath(opts: {
  requestNo: string | null;
  requestId: number;
  year: number | null;
  /** Form's top-level SharePoint folder segment. Defaults to FORM_CODE ("AP-1"). */
  formCode?: string;
  /**
   * Which environment the request belongs to. UAT attachments go under a
   * sibling "_UAT" folder so test files never mix with real ones.
   */
  environment: "Production" | "UAT";
}): string {
  const base = (env.SHAREPOINT_ACC_FOLDER ?? "").replace(/^\/+|\/+$/g, "");
  const parts = [
    base,
    opts.environment === "UAT" ? "_UAT" : "",
    opts.formCode ?? FORM_CODE,
  ].filter(Boolean);
  if (opts.requestNo) {
    parts.push(
      String(opts.year ?? yearFromRequestNo(opts.requestNo) ?? "unknown"),
    );
    parts.push(sanitizeSegment(opts.requestNo));
  } else {
    parts.push(DRAFT_DIR);
    parts.push(String(opts.requestId));
  }
  return parts.join("/");
}

/** Deterministic filename: "{type}_{reqNoOrDraftId}_{fileId}.{ext}". */
export function buildAccFileName(opts: {
  typeLabel: string;
  requestNo: string | null;
  requestId: number;
  fileId: number;
  originalName: string;
}): string {
  const dotIdx = opts.originalName.lastIndexOf(".");
  const ext =
    dotIdx > 0 ? opts.originalName.slice(dotIdx + 1).toLowerCase() : "bin";
  const ref = opts.requestNo ?? `draft${opts.requestId}`;
  const stem = sanitizeSegment(`${opts.typeLabel}_${ref}_${opts.fileId}`);
  return `${stem}.${sanitizeSegment(ext)}`;
}
