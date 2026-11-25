import { expect, it } from "bun:test"
import type { ResponseInputContent, ResponseInputItem } from "../../../src/domain/chat/types"
import {
  boundMedia,
  hydrateMedia,
  MEDIA_LIMITS,
  toStoredMedia,
} from "../../../src/harness/context/media"

function makeImageContent(bytes: Buffer, filename = "shot.png"): ResponseInputContent[] {
  return [
    { type: "input_text", text: `Read file: ${filename} (PNG image).` },
    { type: "input_image", image_url: `data:image/png;base64,${bytes.toString("base64")}`, detail: "auto" },
  ]
}

it("stores images up to exactly 5 MB as blobs and images at 5 MB + 1 byte by path", () => {
  const exactBytes = Buffer.alloc(5_000_000, 0x41)
  const storedExact = toStoredMedia(makeImageContent(exactBytes, "exact.png"), { path: "/tmp/exact.png" })
  expect(storedExact.blobs).toHaveLength(1)
  expect(storedExact.blobs[0]?.bytes).toBe(MEDIA_LIMITS.imageDbMaxBytes)
  expect(storedExact.parts[1]).toMatchObject({
    type: "ccodex_media_ref",
    kind: "image",
    mime: "image/png",
    name: "exact.png",
    bytes: MEDIA_LIMITS.imageDbMaxBytes,
    sha256: storedExact.blobs[0]?.sha256,
    turnRead: true,
  })
  expect("path" in storedExact.parts[1]!).toBe(false)

  const overBytes = Buffer.alloc(5_000_001, 0x42)
  const storedOver = toStoredMedia(makeImageContent(overBytes, "large.png"), { path: "/tmp/large.png" })
  expect(storedOver.blobs).toHaveLength(0)
  expect(storedOver.parts[1]).toEqual({
    type: "ccodex_media_ref",
    kind: "image",
    mime: "image/png",
    name: "large.png",
    bytes: MEDIA_LIMITS.imageDbMaxBytes + 1,
    path: "/tmp/large.png",
    turnRead: true,
  })
})

it("stores and replays duplicate images using one blob read", async () => {
  const raw = Buffer.from("identical-png-bytes")
  const dataUrl = `data:image/png;base64,${raw.toString("base64")}`
  const stored = toStoredMedia([
    { type: "input_image", image_url: dataUrl, detail: "auto" },
    { type: "input_image", image_url: dataUrl, detail: "auto" },
  ], { path: "/workspace/dup.png" })

  expect(stored.blobs).toHaveLength(1)
  expect(stored.parts).toHaveLength(2)
  expect(stored.parts[0]).toMatchObject({ type: "ccodex_media_ref", sha256: stored.blobs[0]?.sha256 })
  expect(stored.parts[1]).toMatchObject({ type: "ccodex_media_ref", sha256: stored.blobs[0]?.sha256 })
  let reads = 0
  const hydrated = await hydrateMedia(stored.parts, {
    currentTurn: false,
    loadBlob: hash => {
      reads += 1
      return stored.blobs.find(blob => blob.sha256 === hash)?.data
    },
    readFileBase64: () => { throw new Error("Unexpected path reference") },
  })
  expect(reads).toBe(1)
  expect(hydrated).toEqual(Array(2).fill({ type: "input_image", image_url: dataUrl, detail: "auto" }))
})

it("hydrates documents inline only in the current turn and as a text note in later turns", async () => {
  const pdfBytes = Buffer.from("%PDF-1.7 sample")
  const stored = toStoredMedia([
    { type: "input_text", text: "Read file: spec.pdf (PDF document)." },
    {
      type: "input_file",
      filename: "spec.pdf",
      file_data: `data:application/pdf;base64,${pdfBytes.toString("base64")}`,
    },
  ], { path: "/workspace/spec.pdf" })

  expect(stored.blobs).toHaveLength(0)
  expect(stored.parts[1]).toEqual({
    type: "ccodex_media_ref",
    kind: "file",
    mime: "application/pdf",
    name: "spec.pdf",
    bytes: pdfBytes.byteLength,
    path: "/workspace/spec.pdf",
    turnRead: true,
  })

  let fileReads = 0
  const currentTurnParts = await hydrateMedia(stored.parts, {
    loadBlob: () => null,
    readFileBase64: () => {
      fileReads += 1
      return pdfBytes.toString("base64")
    },
    currentTurn: true,
  })
  expect(fileReads).toBe(1)
  expect(currentTurnParts[1]).toEqual({
    type: "input_file",
    filename: "spec.pdf",
    file_data: `data:application/pdf;base64,${pdfBytes.toString("base64")}`,
  })

  const laterTurnParts = await hydrateMedia(stored.parts, {
    loadBlob: () => null,
    readFileBase64: () => {
      fileReads += 1
      return pdfBytes.toString("base64")
    },
    currentTurn: false,
  })
  expect(fileReads).toBe(1)
  expect(laterTurnParts[1]).toEqual({
    type: "input_text",
    text: "File spec.pdf (application/pdf) at /workspace/spec.pdf was read in an earlier turn. Call read again if you need its content.",
  })
})

it("replaces missing blobs and missing files with media unavailable text", async () => {
  const hydrated = await hydrateMedia([
    {
      type: "ccodex_media_ref",
      kind: "image",
      mime: "image/png",
      name: "gone.png",
      bytes: 42,
      sha256: "b".repeat(64),
      turnRead: true,
    },
    {
      type: "ccodex_media_ref",
      kind: "image",
      mime: "image/jpeg",
      name: "moved.jpg",
      bytes: MEDIA_LIMITS.imageDbMaxBytes + 10,
      path: "/workspace/moved.jpg",
      turnRead: true,
    },
  ], {
    loadBlob: () => null,
    readFileBase64: () => null,
    currentTurn: false,
  })

  expect(hydrated).toEqual([
    { type: "input_text", text: "[media unavailable: gone.png (image/png)]" },
    { type: "input_text", text: "[media unavailable: moved.jpg (image/jpeg)]" },
  ])
})

it("boundMedia drops oldest media first and never drops media from the last turn", () => {
  const makeImg = (name: string, payloadLen: number): ResponseInputItem => ({
    type: "function_call_output",
    call_id: `call-${name}`,
    output: [
      { type: "input_text", text: `Read file: ${name} (PNG image).` },
      { type: "input_image", image_url: `data:image/png;base64,${"A".repeat(payloadLen)}`, detail: "auto" },
    ],
  })
  const makePdf = (name: string, payloadLen: number): ResponseInputItem => ({
    type: "function_call_output",
    call_id: `call-${name}`,
    output: [
      { type: "input_file", filename: name, file_data: `data:application/pdf;base64,${"B".repeat(payloadLen)}` },
    ],
  })

  const items: ResponseInputItem[] = [
    { role: "user", content: "turn 1" },
    makePdf("old.pdf", 80),
    makeImg("old.png", 120),
    { role: "user", content: "turn 2" },
    makeImg("mid.png", 120),
    { role: "user", content: "turn 3" },
    makePdf("current.pdf", 80),
    makeImg("current.png", 120),
  ]

  const bounded = boundMedia(items, {
    documentBase64Bytes: 150,
    imageAndRequestBase64Bytes: 320,
  })

  // Oldest PDF dropped to stay under document limit, current-turn PDF kept
  expect((bounded[1] as { output: ResponseInputContent[] }).output[0]).toEqual({
    type: "input_text",
    text: "[media removed to fit the request limit: old.pdf]",
  })
  expect((bounded[6] as { output: ResponseInputContent[] }).output[0]).toMatchObject({
    type: "input_file",
    filename: "current.pdf",
  })

  // Oldest images dropped to fit request limit, last-turn image never dropped
  expect((bounded[2] as { output: ResponseInputContent[] }).output[1]).toEqual({
    type: "input_text",
    text: "[media removed to fit the request limit: old.png]",
  })
  expect((bounded[4] as { output: ResponseInputContent[] }).output[1]).toEqual({
    type: "input_text",
    text: "[media removed to fit the request limit: mid.png]",
  })
  expect((bounded[7] as { output: ResponseInputContent[] }).output[1]).toMatchObject({
    type: "input_image",
  })
})

it("counts encoded document characters and stops after the oldest eligible file", () => {
  const pdf = (filename: string): ResponseInputContent => ({
    type: "input_file", filename, file_data: "data:application/pdf;base64,YWJj",
  })
  const items: ResponseInputItem[] = [
    { role: "user", content: [pdf("one.pdf"), pdf("two.pdf")] },
    { role: "user", content: "next" },
  ]
  const limits = { documentBase64Bytes: 8, imageAndRequestBase64Bytes: 10_000 }
  expect(boundMedia(items, { ...limits, documentBase64Bytes: 9 })).toEqual(items)
  expect(boundMedia(items, limits)[0]).toEqual({
    role: "user", content: [
      { type: "input_text", text: "[media removed to fit the request limit: one.pdf]" },
      pdf("two.pdf"),
    ],
  })
})

it("counts the complete request and removes only the oldest media needed", () => {
  const oldImage = makeImageContent(Buffer.alloc(256))
  const input: ResponseInputItem[] = [
    { role: "user", content: oldImage },
    { role: "user", content: oldImage },
    { role: "user", content: "next" },
  ]
  const request = { input, model: "mô hình", stream: true as const }
  const limits = { documentBase64Bytes: 999, imageAndRequestBase64Bytes: Buffer.byteLength(JSON.stringify(request)) }
  expect(boundMedia(request, { ...limits, imageAndRequestBase64Bytes: limits.imageAndRequestBase64Bytes + 1 })).toEqual(input)
  const bounded = boundMedia(request, limits)
  expect(bounded[0]).toEqual({ role: "user", content: [
    oldImage[0]!, { type: "input_text", text: "[media removed to fit the request limit: shot.png]" },
  ] })
  expect(bounded.slice(1)).toEqual(input.slice(1))
  expect(Buffer.byteLength(JSON.stringify({ ...request, input: bounded }))).toBeLessThan(limits.imageAndRequestBase64Bytes)
})

it("preserves every current-turn output even when that turn alone exceeds both budgets", () => {
  const outputs: ResponseInputItem[] = [
    { type: "function_call_output", call_id: "a", output: makeImageContent(Buffer.alloc(10)) },
    { type: "function_call_output", call_id: "b", output: [
      { type: "input_file", filename: "b.pdf", file_data: "data:application/pdf;base64,YWJj" },
    ] },
  ]
  const limits = { documentBase64Bytes: 1, imageAndRequestBase64Bytes: 1 }
  expect(boundMedia(outputs, limits)).toEqual(outputs)
  const items: ResponseInputItem[] = [{ role: "user", content: "read" }, ...outputs]
  expect(boundMedia(items, limits)).toEqual(items)
})

it("refuses to store a document against a relative path", () => {
  expect(() => toStoredMedia([{
    type: "input_file", filename: "a.pdf", file_data: "data:application/pdf;base64,YWJj",
  }], { path: "a.pdf" })).toThrow("absolute path")
})
