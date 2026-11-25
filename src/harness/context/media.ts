import { createHash } from "node:crypto"
import { basename, isAbsolute } from "node:path"
import { isMediaRefPart, type MediaRefPart, type StoredContentPart } from "../../contracts/message-parts"
import { RESPONSES_LIMITS } from "../../domain/chat/responses-limits"
import type {
  EasyInputMessage,
  FunctionCallOutputItem,
  InputTextContent,
  ResponseInputContent,
  ResponseInputItem,
  ResponsesRequest,
} from "../../domain/chat/types"
import { READ_LIMITS } from "../execution/read-limits"

export const MEDIA_LIMITS = {
  fileBytes: READ_LIMITS.mediaFileBytes,
  documentBase64Bytes: RESPONSES_LIMITS.inputFilesPerRequestBytes,
  imageAndRequestBase64Bytes: RESPONSES_LIMITS.inputImagesPerRequestBytes,
  imageDbMaxBytes: 5_000_000,
} as const

export interface MediaBlob {
  sha256: string
  mime: string
  bytes: number
  data: Buffer
}

export interface ToStoredMediaOptions {
  path?: string
  turnRead?: boolean
}

export interface HydrateMediaOptions {
  loadBlob(sha256: string): Promise<Uint8Array | null | undefined> | Uint8Array | null | undefined
  readFileBase64(path: string, maxBytes: number): Promise<string | null | undefined> | string | null | undefined
  currentTurn: boolean
}

export interface MediaBoundLimits {
  documentBase64Bytes: number
  imageAndRequestBase64Bytes: number
}

const DATA_URL_BASE64 = /^data:([^;,]+);base64,(.*)$/s
const READ_FILE_PREFIX = /^Read file: (.+) \([^()]*\)\.$/s

export function toStoredMedia(
  outputContent: readonly ResponseInputContent[],
  options: ToStoredMediaOptions = {},
): { parts: StoredContentPart[]; blobs: MediaBlob[] } {
  const turnRead = options.turnRead ?? true
  const blobsByHash = new Map<string, MediaBlob>()
  const parts: StoredContentPart[] = []

  for (let index = 0; index < outputContent.length; index += 1) {
    const part = outputContent[index]!
    if (part.type === "input_text") {
      parts.push(part)
      continue
    }
    const parsed = parseBase64DataUrl(part.type === "input_image" ? part.image_url : part.file_data)
    if (!parsed) throw new Error("Expected inline base64 media from read")
    const raw = Buffer.from(parsed.base64, "base64")
    const name = part.type === "input_file" ? part.filename
      : options.path ? basename(options.path) : inferReadFilename(outputContent, index) ?? "image"
    const common = { type: "ccodex_media_ref", mime: parsed.mime, name, bytes: raw.byteLength, turnRead } as const
    if (part.type === "input_image" && raw.byteLength <= MEDIA_LIMITS.imageDbMaxBytes) {
      const sha256 = createHash("sha256").update(raw).digest("hex")
      if (!blobsByHash.has(sha256)) {
        blobsByHash.set(sha256, { sha256, mime: parsed.mime, bytes: raw.byteLength, data: raw })
      }
      parts.push({ ...common, kind: "image", sha256 })
    } else {
      if (!options.path || !isAbsolute(options.path)) throw new Error("Expected an absolute path for media stored by path")
      parts.push({ ...common, kind: part.type === "input_file" ? "file" : "image", path: options.path })
    }
  }

  return { parts, blobs: [...blobsByHash.values()] }
}

export async function hydrateMedia(
  parts: readonly StoredContentPart[],
  options: HydrateMediaOptions,
): Promise<ResponseInputContent[]> {
  const base64Cache = new Map<string, string | null>()
  const hydrated: ResponseInputContent[] = []

  for (const part of parts) {
    if (!isMediaRefPart(part)) {
      hydrated.push(part as ResponseInputContent)
      continue
    }

    if (part.kind === "file" && (!options.currentTurn || !part.turnRead)) {
      hydrated.push({
        type: "input_text",
        text: `File ${part.name} (${part.mime}) at ${part.path} was read in an earlier turn. Call read again if you need its content.`,
      })
      continue
    }

    const locator = part.sha256 ?? part.path
    if (!locator) throw new Error("Media reference has no locator")
    let base64 = base64Cache.get(locator)
    if (base64 === undefined) {
      if (part.sha256) {
        const raw = await options.loadBlob(part.sha256)
        base64 = raw ? toBase64(raw) : null
      } else {
        base64 = await safeReadFileBase64(options.readFileBase64, locator)
      }
      base64Cache.set(locator, base64)
    }
    if (base64 === null) {
      hydrated.push(unavailablePart(part))
    } else if (part.kind === "image") {
      hydrated.push({ type: "input_image", image_url: toDataUrl(part.mime, base64), detail: "auto" })
    } else {
      hydrated.push({ type: "input_file", filename: part.name, file_data: toDataUrl(part.mime, base64) })
    }
  }

  return hydrated
}

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value))
}

export function boundMedia(
  request: readonly ResponseInputItem[] | ResponsesRequest,
  limits: MediaBoundLimits = MEDIA_LIMITS,
): ResponseInputItem[] {
  const items = "input" in request ? request.input : request
  const lastUser = items.findLastIndex(item =>
    "role" in item && item.role === "user" && (item.type === undefined || item.type === "message"),
  )
  let documentBytes = 0
  // Count the envelope and array separators without serializing the entire history at once.
  let requestBytes = ("input" in request ? jsonBytes({ ...request, input: [] }) : 2) + Math.max(0, items.length - 1)
  const overRequest = () => requestBytes >= limits.imageAndRequestBase64Bytes
  for (const item of items) {
    requestBytes += jsonBytes(item)
    for (const part of getItemContent(item) ?? []) {
      if (part.type === "input_file") documentBytes += filePayloadBytes(part.file_data)
    }
  }

  // The serialized request already includes every image data URL.
  return items.map((item, index) => {
    if (index >= lastUser || (!overRequest() && documentBytes < limits.documentBase64Bytes)) return item
    const content = getItemContent(item)
    if (!content) return item
    const bounded = content.map((part, partIndex) => {
      let name: string
      if (part.type === "input_file") {
        if (!overRequest() && documentBytes < limits.documentBase64Bytes) return part
        documentBytes -= filePayloadBytes(part.file_data)
        name = part.filename
      } else if (part.type === "input_image" && part.image_url.startsWith("data:") && overRequest()) {
        name = inferReadFilename(content, partIndex) ?? "image"
      } else {
        return part
      }
      const note: InputTextContent = { type: "input_text", text: `[media removed to fit the request limit: ${name}]` }
      requestBytes += jsonBytes(note) - jsonBytes(part)
      return note
    })
    return item.type === "function_call_output" ? { ...item, output: bounded } : { ...item, content: bounded }
  })
}

function filePayloadBytes(dataUrl: string): number {
  return dataUrl.length - dataUrl.indexOf(",") - 1
}

function getItemContent(item: ResponseInputItem): readonly ResponseInputContent[] | undefined {
  if (item.type === "function_call_output") {
    const output = (item as FunctionCallOutputItem).output
    return Array.isArray(output) ? output : undefined
  }
  if ((item.type === undefined || item.type === "message") && "content" in item) {
    const content = (item as EasyInputMessage).content
    return Array.isArray(content) ? content : undefined
  }
  return undefined
}

function inferReadFilename(content: readonly ResponseInputContent[], mediaIndex: number): string | undefined {
  const previous = mediaIndex > 0 ? content[mediaIndex - 1] : undefined
  if (previous?.type !== "input_text") return undefined
  return READ_FILE_PREFIX.exec(previous.text)?.[1]
}

function parseBase64DataUrl(url: string): { mime: string; base64: string } | undefined {
  const match = DATA_URL_BASE64.exec(url)
  if (!match) return undefined
  return { mime: match[1]!, base64: match[2]! }
}

function toBase64(data: Uint8Array): string {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  return buffer.toString("base64")
}

function toDataUrl(mime: string, value: string): string {
  return value.startsWith("data:") ? value : `data:${mime};base64,${value}`
}

async function safeReadFileBase64(
  readFileBase64: HydrateMediaOptions["readFileBase64"],
  path: string,
): Promise<string | null> {
  try {
    const value = await readFileBase64(path, MEDIA_LIMITS.fileBytes)
    return value ?? null
  } catch {
    return null
  }
}

function unavailablePart(ref: MediaRefPart): InputTextContent {
  return { type: "input_text", text: `[media unavailable: ${ref.name} (${ref.mime})]` }
}
