import { promises as fs } from "fs";
import path from "path";

const UPLOAD_DIR = process.env.UPLOAD_ROOT
  ? path.resolve(process.env.UPLOAD_ROOT)
  : path.join(process.cwd(), "uploads", "forms");

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

export async function uploadFile(
  subPath: string,
  buffer: Buffer,
): Promise<string> {
  const fullPath = path.join(UPLOAD_DIR, subPath);
  await ensureDir(path.dirname(fullPath));
  await fs.writeFile(fullPath, buffer);
  return subPath;
}

export async function downloadFile(
  storagePath: string,
): Promise<Buffer> {
  const fullPath = path.join(UPLOAD_DIR, storagePath);
  return fs.readFile(fullPath);
}

export async function deleteFile(storagePath: string): Promise<void> {
  const fullPath = path.join(UPLOAD_DIR, storagePath);
  await fs.unlink(fullPath).catch(() => {});
}
