import { env } from "@/env";
import { getGraphToken } from "@/lib/graph";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

/** True when both SharePoint env vars are present. */
export function isSharePointConfigured(): boolean {
  return Boolean(env.SHAREPOINT_ACC_SITE && env.SHAREPOINT_ACC_FOLDER);
}

/** Strip characters SharePoint/OneDrive forbids in file/folder names. */
export function sanitizeSegment(s: string): string {
  return (
    s
      .replace(/[\\/:*?"<>|#%]/g, "_")
      .replace(/\s+/g, " ")
      .replace(/^\.+/, "")
      .trim()
      .slice(0, 200) || "file"
  );
}

/* ── Site + drive resolution (cached for process lifetime) ── */

let driveIdPromise: Promise<string> | null = null;

async function resolveDriveId(): Promise<string> {
  if (driveIdPromise) return driveIdPromise;
  driveIdPromise = (async () => {
    const site = env.SHAREPOINT_ACC_SITE;
    if (!site) throw new Error("SHAREPOINT_ACC_SITE not configured");
    const token = await getGraphToken();
    // Site address form: "{hostname}:/sites/{name}" → /sites/{that}
    const siteRes = await fetch(`${GRAPH_BASE}/sites/${site}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!siteRes.ok) {
      throw new Error(`Graph site resolve failed (${siteRes.status}): ${await siteRes.text()}`);
    }
    const siteJson = (await siteRes.json()) as { id: string };
    const driveRes = await fetch(`${GRAPH_BASE}/sites/${siteJson.id}/drive`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!driveRes.ok) {
      throw new Error(`Graph drive resolve failed (${driveRes.status}): ${await driveRes.text()}`);
    }
    const driveJson = (await driveRes.json()) as { id: string };
    return driveJson.id;
  })().catch((e) => {
    driveIdPromise = null; // allow retry on next call
    throw e;
  });
  return driveIdPromise;
}

function encodePath(path: string): string {
  // Encode each segment but keep the slashes.
  return path
    .split("/")
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

/** Idempotently create every folder segment in `folderPath`. */
async function ensureFolderPath(driveId: string, token: string, folderPath: string): Promise<void> {
  const segments = folderPath.split("/").filter(Boolean);
  let parent = ""; // drive-root-relative parent path
  for (const seg of segments) {
    const parentRef = parent
      ? `${GRAPH_BASE}/drives/${driveId}/root:/${encodePath(parent)}:/children`
      : `${GRAPH_BASE}/drives/${driveId}/root/children`;
    const res = await fetch(parentRef, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: seg,
        folder: {},
        "@microsoft.graph.conflictBehavior": "fail",
      }),
    });
    // 201 Created = new folder; 409 Conflict = already exists (both fine).
    if (!res.ok && res.status !== 409) {
      throw new Error(`Graph create folder "${seg}" failed (${res.status}): ${await res.text()}`);
    }
    parent = parent ? `${parent}/${seg}` : seg;
  }
}

/** Upload a (small, <4MB) file; returns its driveItem id + webUrl. */
export async function uploadFileToSharePoint(
  folderPath: string,
  filename: string,
  buffer: Buffer,
  contentType: string,
): Promise<{ itemId: string; webUrl: string }> {
  const driveId = await resolveDriveId();
  const token = await getGraphToken();
  await ensureFolderPath(driveId, token, folderPath);
  const fullPath = `${folderPath}/${filename}`;
  // conflictBehavior=rename, NOT Graph's default (replace).
  //
  // This library is shared with the Rocks Fast sibling, and since the database
  // split the two apps number their requests, drafts and files from separate
  // AccSequence / identity columns. Both therefore build byte-identical paths —
  // most densely under `AP-1/_DRAFT/{requestId}/{type}_draft{id}_{fileId}.ext`,
  // where both id spaces start at 1. With the default, whichever app uploads
  // second silently replaces the other's bytes and Graph hands back the SAME
  // driveItem id, so both apps' AccRequestFile rows point at one item and one
  // requester's ID-card scan is served to the other's request. Renaming costs a
  // suffixed filename (nothing reads it back — StoragePath is the item id) and
  // keeps both files intact.
  const res = await fetch(
    `${GRAPH_BASE}/drives/${driveId}/root:/${encodePath(fullPath)}:/content?@microsoft.graph.conflictBehavior=rename`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
      body: new Uint8Array(buffer),
    },
  );
  if (!res.ok) {
    throw new Error(`Graph upload failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as { id: string; webUrl: string };
  return { itemId: json.id, webUrl: json.webUrl };
}

/** Download a file's bytes by driveItem id. */
export async function downloadFileFromSharePoint(itemId: string): Promise<Buffer> {
  const driveId = await resolveDriveId();
  const token = await getGraphToken();
  const res = await fetch(`${GRAPH_BASE}/drives/${driveId}/items/${itemId}/content`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Graph download failed (${res.status}): ${await res.text()}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** Best-effort delete by driveItem id (never throws). */
export async function deleteFileFromSharePoint(itemId: string): Promise<void> {
  try {
    const driveId = await resolveDriveId();
    const token = await getGraphToken();
    await fetch(`${GRAPH_BASE}/drives/${driveId}/items/${itemId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (e) {
    console.error("[sharepoint] delete failed:", e);
  }
}

/** Best-effort move/rename of a folder (never throws). */
export async function moveSharePointFolder(
  fromFolderPath: string,
  toFolderPath: string,
): Promise<void> {
  try {
    const driveId = await resolveDriveId();
    const token = await getGraphToken();
    // Resolve the source folder's item id.
    const srcRes = await fetch(
      `${GRAPH_BASE}/drives/${driveId}/root:/${encodePath(fromFolderPath)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!srcRes.ok) {
      if (srcRes.status === 404) return; // nothing to move
      throw new Error(`resolve source failed (${srcRes.status}): ${await srcRes.text()}`);
    }
    const src = (await srcRes.json()) as { id: string };
    // Ensure the destination's PARENT folder chain exists.
    const segs = toFolderPath.split("/").filter(Boolean);
    const newName = segs[segs.length - 1];
    const destParent = segs.slice(0, -1).join("/");
    if (destParent) await ensureFolderPath(driveId, token, destParent);
    // PATCH parentReference + name to move + rename atomically.
    const parentRefBody = destParent
      ? { parentReference: { path: `/drive/root:/${destParent}` }, name: newName }
      : { parentReference: { path: `/drive/root:` }, name: newName };
    const mvRes = await fetch(`${GRAPH_BASE}/drives/${driveId}/items/${src.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(parentRefBody),
    });
    if (!mvRes.ok) {
      throw new Error(`move failed (${mvRes.status}): ${await mvRes.text()}`);
    }
  } catch (e) {
    console.error("[sharepoint] moveFolder failed:", e);
  }
}

export { GRAPH_BASE };
