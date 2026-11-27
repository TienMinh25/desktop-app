import { lstat, realpath } from "node:fs/promises"
import { extname, isAbsolute } from "node:path"
import type { OpenMediaPathResult } from "../../contracts/session-history"
import type { Db } from "../../infrastructure/db/sqlite"

export const MEDIA_PROTOCOL_SCHEME = "ccodex-media"

const SHA256_HEX = "[a-f0-9]{64}"
const MEDIA_HASH = new RegExp(`^${SHA256_HEX}$`, "i")
const MEDIA_URL = new RegExp(`^${MEDIA_PROTOCOL_SCHEME}://(${SHA256_HEX})/?$`, "i")
const MIME_BY_EXTENSION: Partial<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
}

export function parseMediaSha256(value: unknown): string | null {
  return typeof value === "string" && MEDIA_HASH.test(value) ? value.toLowerCase() : null
}

export function parseMediaProtocolUrl(rawUrl: string): string | null {
  return MEDIA_URL.exec(rawUrl)?.[1]?.toLowerCase() ?? null
}

export function readReferencedMediaBlob(db: Db, rawHash: string): { mime: string; data: Uint8Array } | null {
  const sha256 = parseMediaSha256(rawHash)
  if (!sha256) return null
  const row = db.prepare(`
    SELECT b.mime, b.data
    FROM media_blob AS b
    WHERE b.sha256 = ?
      AND EXISTS (SELECT 1 FROM artifacts AS a WHERE a.sha256 = b.sha256)`).get(sha256) as
    | { mime: string; data: Uint8Array }
    | null
    | undefined
  return row ?? null
}

export function isAllowedArtifactPath(db: Db, filePath: unknown): filePath is string {
  if (typeof filePath !== "string" || filePath.includes("\0") || !isAbsolute(filePath)) return false
  const mime = MIME_BY_EXTENSION[extname(filePath).toLowerCase()]
  if (!mime) return false
  return Boolean(db.prepare(`
    SELECT 1 FROM artifacts
    WHERE path = ? AND mime_type = ? AND sha256 IS NULL`).get(filePath, mime))
}

export async function openAllowedMediaPath(
  db: Db,
  filePath: unknown,
  openPath: (targetPath: string) => Promise<string>,
): Promise<OpenMediaPathResult> {
  if (!isAllowedArtifactPath(db, filePath)) return { ok: false, error: "not-allowed" }
  try {
    const resolvedPath = await realpath(filePath)
    if (resolvedPath !== filePath || !(await lstat(filePath)).isFile()) {
      return { ok: false, error: "not-allowed" }
    }
    const opened = await openPath(filePath).then(error => !error, () => false)
    if (opened) return { ok: true }
    // Check for a move or deletion while the OS tried to open it
    await lstat(filePath)
    return { ok: false, error: "not-allowed" }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code
    return { ok: false, error: code === "ENOENT" || code === "ENOTDIR" ? "missing" : "not-allowed" }
  }
}
