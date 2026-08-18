import { getAccPool, sql } from "@/lib/adv/pool";

/**
 * AP-2 request attachments (quote / supporting docs / photos). Reuses the shared
 * AccRequestFile table with an AP-2-only RefType, and the same SharePoint-backed
 * storage + size/type limits as AP-17.
 */
export const AP2_FILE_REFTYPE = "advance_attach";
export const AP2_MAX_FILE_BYTES = 4 * 1024 * 1024; // 4MB (SharePoint simple upload — ตาม AP-17)
export const AP2_FILE_ACCEPT = "image/*,application/pdf";

export interface AdvanceFileMeta {
  id: number;
  fileName: string;
  fileSize: number;
  contentType: string;
}

export async function listAdvanceFiles(requestId: number): Promise<AdvanceFileMeta[]> {
  const pool = await getAccPool();
  const r = await pool.request()
    .input("rid", sql.Int, requestId)
    .input("rt", sql.NVarChar, AP2_FILE_REFTYPE)
    .query(`SELECT Id, FileName, FileSize, ContentType FROM [dbo].[AccRequestFile]
            WHERE RequestId = @rid AND RefType = @rt ORDER BY Id`);
  return (r.recordset as Record<string, unknown>[]).map((x) => ({
    id: x.Id as number,
    fileName: (x.FileName as string) ?? "",
    fileSize: (x.FileSize as number) ?? 0,
    contentType: (x.ContentType as string) ?? "application/octet-stream",
  }));
}

export interface AdvanceFileRow {
  requestId: number;
  fileName: string;
  contentType: string;
  storagePath: string;
  storageBackend: string;
}

export async function getAdvanceFile(fileId: number): Promise<AdvanceFileRow | null> {
  const pool = await getAccPool();
  const r = await pool.request()
    .input("id", sql.Int, fileId)
    .input("rt", sql.NVarChar, AP2_FILE_REFTYPE)
    .query(`SELECT RequestId, FileName, ContentType, StoragePath, StorageBackend
            FROM [dbo].[AccRequestFile] WHERE Id = @id AND RefType = @rt`);
  if (!r.recordset.length) return null;
  const x = r.recordset[0] as Record<string, unknown>;
  return {
    requestId: x.RequestId as number,
    fileName: (x.FileName as string) ?? "file",
    contentType: (x.ContentType as string) ?? "application/octet-stream",
    storagePath: (x.StoragePath as string) ?? "",
    storageBackend: (x.StorageBackend as string) ?? "storage",
  };
}

export async function deleteAdvanceFileRow(fileId: number): Promise<void> {
  const pool = await getAccPool();
  await pool.request().input("id", sql.Int, fileId)
    .query(`DELETE FROM [dbo].[AccRequestFile] WHERE Id = @id`);
}
