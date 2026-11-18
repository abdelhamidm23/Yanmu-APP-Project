import "server-only";
import { attachment } from "./schema";
import type { Tx } from "./rls";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"];

export class UploadError extends Error {
  constructor() {
    super("bad_file");
  }
}

/** A real file was chosen in this form field? (Browsers send an empty File when none is.) */
export function hasFile(v: FormDataEntryValue | null): v is File {
  return typeof v === "object" && v !== null && "size" in v && v.size > 0;
}

/** Checks type and size before anything is written. */
export function checkUpload(file: File) {
  if (file.size > MAX_UPLOAD_BYTES || !ALLOWED.includes(file.type)) throw new UploadError();
}

/**
 * Stores a photo or signed form in the database, in the branch's rows (spec §15: files stay in Egypt
 * with the data). Row-level security decides who can read it back.
 */
export async function saveUpload(tx: Tx, branchId: string, file: File): Promise<string> {
  checkUpload(file);
  const [row] = await tx
    .insert(attachment)
    .values({ branchId, fileName: file.name.slice(0, 200) || "file", mimeType: file.type, sizeBytes: file.size, data: Buffer.from(await file.arrayBuffer()) })
    .returning({ id: attachment.id });
  return row.id;
}
