import { basename, extname } from "node:path"
import type { HarnessTool } from "../agent/tool-registry"
import type { ResolvedPath, TextFilePage } from "../execution/execution-environment"
import type { ResponseInputContent } from "../../domain/chat/types"
import { READ_LIMITS } from "../execution/read-limits"
import { isSensitiveResource } from "../permissions/sensitive-resource"
import { definition, objectArgs, permissionRequest, stringArg } from "./tool-utils"

type MediaDescriptor =
  | { kind: "image"; mimeType: string; label: string }
  | { kind: "file"; mimeType: string; label: string }

export const readTool: HarnessTool = {
  definition: definition(
    "read",
    `Read UTF-8 text/code; PNG, JPG/JPEG, static GIF, WebP; PDF, DOC/DOCX, XLS/XLSX, CSV, and PPT/PPTX. Text pages contain at most ${READ_LIMITS.pageLines} lines and ${READ_LIMITS.pageBytes} bytes. UTF-8 files are limited to ${READ_LIMITS.textFileBytes} bytes; images/documents are limited to ${READ_LIMITS.mediaFileBytes} bytes each. Use offset and columnOffset to continue text pages. Files outside the workspace and sensitive files require approval.`,
    {
      path: { type: "string", description: "Workspace-relative or absolute file path" },
      offset: { type: "integer", minimum: 0, description: "Zero-based line offset; defaults to 0" },
      columnOffset: { type: "integer", minimum: 0, description: "UTF-16 code-unit offset within the line at offset; use to continue a long line without splitting an emoji" },
      limit: { type: "integer", minimum: 1, maximum: READ_LIMITS.pageLines, description: `Maximum lines to return; defaults to ${READ_LIMITS.pageLines}` },
    },
    ["path"],
  ),
  async prepare(value, context) {
    const args = objectArgs(value)
    const requestedPath = stringArg(args, "path")
    const offset = args.offset ?? 0
    const columnOffset = args.columnOffset ?? 0
    const limit = args.limit ?? READ_LIMITS.pageLines
    if (!Number.isInteger(offset) || (offset as number) < 0) throw new Error("offset must be a non-negative integer")
    if (!Number.isInteger(columnOffset) || (columnOffset as number) < 0) throw new Error("columnOffset must be a non-negative integer")
    if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > READ_LIMITS.pageLines) throw new Error(`limit must be an integer from 1 to ${READ_LIMITS.pageLines}`)
    const resolved = await context.environment.resolvePath(requestedPath)
    const sensitive = isSensitiveResource(resolved.path)
    return {
      permissionRequests: [permissionRequest("read", "read a file", resolved.path, resolved.insideWorkspace, sensitive)],
      data: {
        resolved,
        offset: offset as number,
        columnOffset: columnOffset as number,
        limit: limit as number,
        paginationRequested: args.offset !== undefined || args.columnOffset !== undefined || args.limit !== undefined,
      },
    }
  },
  async execute(_value, context, prepared) {
    const { resolved, offset, columnOffset, limit, paginationRequested } = prepared as {
      resolved: ResolvedPath
      offset: number
      columnOffset: number
      limit: number
      paginationRequested: boolean
    }
    const extension = extname(resolved.path).toLowerCase()
    const media = mediaForExtension(extension)

    // if this file is text/utf-8 -> we read text file page
    if (!media) {
      const page = await context.environment.readTextFilePage(resolved.path, resolved.insideWorkspace, offset, limit, columnOffset)
      return renderTextPage(page, offset, columnOffset)
    }
    if (paginationRequested) throw new Error("offset, columnOffset, and limit can only be used with UTF-8 text files")

    const bytes = Buffer.from(await context.environment.readFileBytes(resolved.path, READ_LIMITS.mediaFileBytes, resolved.insideWorkspace))
    validateMediaBytes(extension, media, bytes)
    const filename = basename(resolved.path)
    const dataUrl = `data:${media.mimeType};base64,${bytes.toString("base64")}`
    const contents: ResponseInputContent[] = [{ type: "input_text", text: `Read file: ${filename} (${media.label}).` }]
    if (media.kind === "image") contents.push({ type: "input_image", image_url: dataUrl, detail: "auto" })
    else contents.push({ type: "input_file", filename, file_data: dataUrl })
    return contents
  },
}

function renderTextPage(page: TextFilePage, offset: number, columnOffset: number): string {
  if (page.totalLines === 0) return "(empty file)"
  if (!page.content && page.startLine === 0) return `(end of file; ${page.totalLines} lines total)`
  const next = page.nextOffset === undefined
    ? "end of file"
    : `next offset: ${page.nextOffset}${page.nextColumnOffset ? `, columnOffset: ${page.nextColumnOffset}` : ""}`
  const total = page.totalLines === undefined ? "" : ` of ${page.totalLines}`
  const start = page.startLine || offset + 1
  const end = page.endLine || start
  const cursor = columnOffset ? `, continued at column ${columnOffset}` : ""
  return `Lines ${start}-${end}${total}${cursor} (${next})\n${page.content}`
}

function mediaForExtension(extension: string): MediaDescriptor | undefined {
  const images: Record<string, { mimeType: string; label: string }> = {
    ".png": { mimeType: "image/png", label: "PNG image" },
    ".jpg": { mimeType: "image/jpeg", label: "JPEG image" },
    ".jpeg": { mimeType: "image/jpeg", label: "JPEG image" },
    ".gif": { mimeType: "image/gif", label: "static GIF image" },
    ".webp": { mimeType: "image/webp", label: "WebP image" },
  }
  const documents: Record<string, { mimeType: string; label: string }> = {
    ".csv": { mimeType: "text/csv", label: "CSV spreadsheet" },
    ".pdf": { mimeType: "application/pdf", label: "PDF document" },
    ".doc": { mimeType: "application/msword", label: "Word document" },
    ".docx": { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", label: "Word document" },
    ".xls": { mimeType: "application/vnd.ms-excel", label: "Excel spreadsheet" },
    ".xlsx": { mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", label: "Excel spreadsheet" },
    ".ppt": { mimeType: "application/vnd.ms-powerpoint", label: "PowerPoint presentation" },
    ".pptx": { mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", label: "PowerPoint presentation" },
  }
  if (images[extension]) return { kind: "image", ...images[extension] }
  if (documents[extension]) return { kind: "file", ...documents[extension] }
  return undefined
}

function validateMediaBytes(extension: string, media: MediaDescriptor, bytes: Buffer) {
  if (bytes.length === 0) throw new Error("File is empty")
  if (media.kind === "image") {
    if (extension === ".png" && !hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) throw mismatchedExtension(extension)
    if ((extension === ".jpg" || extension === ".jpeg") && !(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) throw mismatchedExtension(extension)
    if (extension === ".webp" && !(bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP")) throw mismatchedExtension(extension)
    if (extension === ".gif") {
      const signature = bytes.toString("ascii", 0, 6)
      if (signature !== "GIF87a" && signature !== "GIF89a") throw mismatchedExtension(extension)
      if (countGifFrames(bytes) > 1) throw new Error("Animated GIF files are not supported; use a static GIF, PNG, JPEG, or WebP image")
    }
    return
  }

  if (extension === ".csv") {
    assertUtf8(bytes)
    return
  }
  if (extension === ".pdf") {
    if (bytes.subarray(0, 1024).indexOf(Buffer.from("%PDF-")) < 0) throw mismatchedExtension(extension)
    return
  }
  if (extension === ".doc" || extension === ".xls" || extension === ".ppt") {
    if (!hasPrefix(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) throw mismatchedExtension(extension)
    return
  }

  if (!hasPrefix(bytes, [0x50, 0x4b, 0x03, 0x04])) throw mismatchedExtension(extension)
  const requiredEntry = extension === ".docx" ? "word/document.xml" : extension === ".xlsx" ? "xl/workbook.xml" : "ppt/presentation.xml"
  if (!zipHasEntry(bytes, requiredEntry)) throw new Error(`File content is not a valid ${extension} package (missing ${requiredEntry})`)
}

function countGifFrames(bytes: Buffer): number {
  let position = 13
  const screenFlags = bytes[10] ?? 0
  if (screenFlags & 0x80) position += 3 * (2 ** ((screenFlags & 0x07) + 1))
  if (position > bytes.length) throw new Error("GIF file is malformed")

  let frames = 0
  while (position < bytes.length) {
    const marker = bytes[position++]
    if (marker === 0x3b) return frames
    if (marker === 0x21) {
      if (position >= bytes.length) throw new Error("GIF file is malformed")
      position += 1
      position = skipGifSubBlocks(bytes, position)
      continue
    }
    if (marker !== 0x2c || position + 9 > bytes.length) throw new Error("GIF file is malformed")
    frames += 1
    const descriptorFlags = bytes[position + 8] ?? 0
    position += 9
    if (descriptorFlags & 0x80) position += 3 * (2 ** ((descriptorFlags & 0x07) + 1))
    if (position >= bytes.length) throw new Error("GIF file is malformed")
    position += 1
    position = skipGifSubBlocks(bytes, position)
  }
  throw new Error("GIF file is malformed")
}

function skipGifSubBlocks(bytes: Buffer, start: number): number {
  let position = start
  while (position < bytes.length) {
    const length = bytes[position++] ?? 0
    if (length === 0) return position
    position += length
    if (position > bytes.length) throw new Error("GIF file is malformed")
  }
  throw new Error("GIF file is malformed")
}

function zipHasEntry(bytes: Buffer, expectedName: string): boolean {
  const searchStart = Math.max(0, bytes.length - 65_557)
  let endRecord = -1
  for (let index = bytes.length - 22; index >= searchStart; index -= 1) {
    if (bytes.readUInt32LE(index) === 0x06054b50) { endRecord = index; break }
  }
  if (endRecord < 0) return false
  let position = bytes.readUInt32LE(endRecord + 16)
  const directoryEnd = position + bytes.readUInt32LE(endRecord + 12)
  if (directoryEnd > bytes.length) return false
  while (position + 46 <= directoryEnd && bytes.readUInt32LE(position) === 0x02014b50) {
    const nameLength = bytes.readUInt16LE(position + 28)
    const extraLength = bytes.readUInt16LE(position + 30)
    const commentLength = bytes.readUInt16LE(position + 32)
    const nameStart = position + 46
    const nameEnd = nameStart + nameLength
    if (nameEnd > directoryEnd) return false
    if (bytes.toString("utf8", nameStart, nameEnd) === expectedName) return true
    position = nameEnd + extraLength + commentLength
  }
  return false
}

function assertUtf8(bytes: Buffer) {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    if (text.includes("\0")) throw new Error("CSV contains binary data")
  } catch (error) {
    if (error instanceof Error && error.message === "CSV contains binary data") throw error
    throw new Error("CSV must be UTF-8 encoded")
  }
}

function hasPrefix(bytes: Buffer, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value)
}

function mismatchedExtension(extension: string): Error {
  return new Error(`File content does not match the ${extension} extension`)
}
