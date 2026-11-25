import { expect, it } from "bun:test"
import {
  decodeParts,
  encodeParts,
  MessagePartsError,
  type StoredMessagePart,
} from "../../../src/contracts/message-parts"

it("round-trips all known part types including media refs", () => {
  const parts: StoredMessagePart[] = [
    { type: "message", role: "user", content: "Inspect this file" },
    {
      type: "reasoning",
      id: "rs_1",
      summary: [{ type: "summary_text", text: "Checking file" }],
      encrypted_content: "opaque-token",
    },
    {
      type: "function_call",
      id: "fc_1",
      call_id: "call_1",
      name: "read",
      arguments: "{\"path\":\"diagram.png\"}",
    },
    {
      type: "function_call_output",
      call_id: "call_1",
      output: [
        { type: "input_text", text: "Read file: diagram.png (PNG image)." },
        {
          type: "ccodex_media_ref",
          kind: "image",
          mime: "image/png",
          name: "diagram.png",
          bytes: 1024,
          sha256: "a".repeat(64),
          turnRead: true,
        },
      ],
    },
    {
      type: "message",
      role: "assistant",
      id: "msg_1",
      content: [{ type: "output_text", text: "Looks good." }],
    },
  ]

  const encoded = encodeParts(parts)
  expect(JSON.parse(encoded)).toEqual({ v: 1, parts })
  expect(decodeParts(encoded)).toEqual(parts)
})

it("keeps unknown part types unchanged across encode and decode", () => {
  const unknownPart: StoredMessagePart = {
    type: "future_annotation",
    version: 3,
    payload: { nested: [1, 2, 3] },
  }
  const parts = [unknownPart, { type: "message", role: "assistant", content: [unknownPart], status: "completed" }]
  expect(decodeParts(encodeParts(parts))).toEqual(parts)
})

it("decodes legacy text parts", () => {
  const legacyJson = JSON.stringify({
    v: 1,
    parts: [{ type: "text", text: "Hello from an older message row" }],
  })
  expect(decodeParts(legacyJson)).toEqual([{ type: "text", text: "Hello from an older message row" }])
})

it("throws a typed MessagePartsError on malformed rows", () => {
  expect(() => decodeParts("{not json")).toThrow(MessagePartsError)
  expect(() => decodeParts(JSON.stringify({ v: 2, parts: [] }))).toThrow(MessagePartsError)
  expect(() => decodeParts(JSON.stringify({ v: 1, parts: "not-an-array" }))).toThrow(MessagePartsError)
  expect(() => decodeParts(JSON.stringify({ v: 1, parts: [{ type: "message", role: "system", content: "nope" }] }))).toThrow(MessagePartsError)
  expect(() => decodeParts(JSON.stringify({
    v: 1,
    parts: [{
      type: "ccodex_media_ref",
      kind: "image",
      mime: "image/png",
      name: "broken.png",
      bytes: 10,
      turnRead: true,
    }],
  }))).toThrow(MessagePartsError)

  expect(() => decodeParts('{"v":99,"parts":[]}')).toThrow(expect.objectContaining({ code: "UNSUPPORTED_VERSION" }))
})

it("rejects malformed known content and media locators inside output items", () => {
  const ref = {
    type: "ccodex_media_ref", kind: "file", name: "doc.pdf", mime: "application/pdf", bytes: 5, turnRead: true,
  }
  const sha256 = "a".repeat(64)
  for (const invalid of [
    { ...ref, sha256 },
    { ...ref, kind: "image", sha256, path: "/tmp/doc.pdf" },
    { ...ref, kind: "image", sha256: "garbage" },
    { ...ref, path: "relative/doc.pdf" },
  ]) {
    const item = { type: "function_call_output", call_id: "c1", output: [invalid] }
    expect(() => decodeParts(JSON.stringify({ v: 1, parts: [item] }))).toThrow(MessagePartsError)
  }
  for (const part of [
    { type: "message", role: "assistant", content: [{ type: "output_text", text: 3 }] },
    { type: "function_call", call_id: "c1", name: "read", arguments: "{}" },
    { type: "reasoning", id: "r1", summary: [{}] },
  ]) {
    expect(() => encodeParts([part])).toThrow(MessagePartsError)
  }
})

it("preserves a nullable encrypted reasoning payload", () => {
  const item = { type: "reasoning", id: "r1", summary: [], encrypted_content: null }
  expect(decodeParts(encodeParts([item]))).toEqual([item])
})
