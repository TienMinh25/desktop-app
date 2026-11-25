import { describe, expect, it, mock, spyOn } from "bun:test"
import type { ChatToolDefinition, FunctionCallOutputItem, ResponseInputItem } from "../../../src/domain/chat/types"
import type { AgentsMdEnvironment } from "../../../src/harness/context/agents-md"
import { BASE_PROMPT } from "../../../src/harness/context/base-prompt"
import { assembleRequest, loadTurnSnapshot } from "../../../src/harness/context/context-assembler"
import * as media from "../../../src/harness/context/media"
import type { HistoryTurn } from "../../../src/harness/context/types"

const SAMPLE_TOOLS: ChatToolDefinition[] = [
  {
    type: "function",
    name: "read",
    description: "Read a file",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
]

const { toStoredMedia } = media

describe("loadTurnSnapshot and assembleRequest", () => {
  it("builds a golden ResponsesRequest in order: developer instructions, hydrated history, prompt, steps", async () => {
    const imgBytes = Buffer.from("png-bytes")
    const storedImg = toStoredMedia(
      [
        { type: "input_text", text: "Read file: ui.png (PNG image)." },
        { type: "input_image", image_url: `data:image/png;base64,${imgBytes.toString("base64")}`, detail: "auto" },
      ],
      { path: "/repo/ui.png" },
    )
    const pdfBytes = Buffer.from("%PDF-1.7")
    const storedPdf = toStoredMedia(
      [{ type: "input_file", filename: "spec.pdf", file_data: `data:application/pdf;base64,${pdfBytes.toString("base64")}` }],
      { path: "/repo/spec.pdf" },
    )
    const storedPdfCall = {
      type: "function_call",
      id: "fc-2",
      call_id: "call-2",
      name: "read",
      arguments: '{"path":"spec.pdf"}',
    }
    const inlinePdfCall = {
      type: "function_call",
      id: "fc-3",
      call_id: "call-3",
      name: "read",
      arguments: '{"path":"legacy.pdf"}',
    }

    const history: HistoryTurn[] = [
      {
        userSeq: 1,
        assistantSeq: 2,
        state: "completed",
        items: [
          { type: "message", role: "user", content: "Inspect ui.png, spec.pdf and legacy.pdf" },
          {
            type: "function_call",
            id: "fc-1",
            call_id: "call-1",
            name: "read",
            arguments: "{\"path\":\"ui.png\"}",
          },
          {
            type: "function_call_output",
            call_id: "call-1",
            output: storedImg.parts,
          },
          storedPdfCall,
          {
            type: "function_call_output",
            call_id: "call-2",
            output: storedPdf.parts,
          },
          inlinePdfCall,
          {
            type: "function_call_output",
            call_id: "call-3",
            output: [{ type: "input_file", filename: "legacy.pdf", file_data: `data:application/pdf;base64,${pdfBytes.toString("base64")}` }],
          },
          { type: "message", role: "assistant", content: [{ type: "output_text", text: "Checked both." }] },
        ],
      },
    ]

    const env: AgentsMdEnvironment = {
      async resolvePath() {
        return { path: "/repo/AGENTS.md", insideWorkspace: true }
      },
      async readTextFile() {
        return "Follow repository style."
      },
    }

    const readFileBase64 = mock(() => null)
    const { snapshot, warnings } = await loadTurnSnapshot({
      model: "claude-sonnet",
      prompt: "Now fix the button.",
      history,
      tools: SAMPLE_TOOLS,
      workspacePath: "/repo",
      environment: env,
      now: new Date("2026-11-26T10:00:00.000Z"),
      platform: "darwin",
      loadBlob: (sha) => storedImg.blobs.find((blob) => blob.sha256 === sha)?.data ?? null,
      readFileBase64,
    })

    expect(warnings).toEqual([])
    expect(readFileBase64).not.toHaveBeenCalled()
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.instructions)).toBe(true)
    expect(Object.isFrozen(snapshot.history)).toBe(true)

    const currentSteps: ResponseInputItem[] = [
      { type: "function_call", id: "fc-4", call_id: "call-4", name: "read", arguments: "{\"path\":\"button.tsx\"}" },
      { type: "function_call_output", call_id: "call-4", output: "export const Button = () => null" },
    ]

    const request = assembleRequest(snapshot, currentSteps)
    expect(request).toEqual({
      model: "claude-sonnet",
      stream: true,
      tools: SAMPLE_TOOLS,
      input: [
        { type: "message", role: "developer", content: BASE_PROMPT },
        {
          type: "message",
          role: "developer",
          content: "Environment:\n- Workspace: /repo\n- OS: darwin\n- Date: 2026-11-26",
        },
        { type: "message", role: "developer", content: "Follow repository style." },
        { type: "message", role: "user", content: "Inspect ui.png, spec.pdf and legacy.pdf" },
        {
          type: "function_call",
          id: "fc-1",
          call_id: "call-1",
          name: "read",
          arguments: "{\"path\":\"ui.png\"}",
        },
        {
          type: "function_call_output",
          call_id: "call-1",
          output: [
            { type: "input_text", text: "Read file: ui.png (PNG image)." },
            {
              type: "input_image",
              image_url: `data:image/png;base64,${imgBytes.toString("base64")}`,
              detail: "auto",
            },
          ],
        },
        storedPdfCall,
        {
          type: "function_call_output",
          call_id: "call-2",
          output: [
            {
              type: "input_text",
              text: "File spec.pdf (application/pdf) at /repo/spec.pdf was read in an earlier turn. Call read again if you need its content.",
            },
          ],
        },
        inlinePdfCall,
        {
          type: "function_call_output",
          call_id: "call-3",
          output: [
            { type: "input_text", text: "File legacy.pdf was read in an earlier turn. Call read again if you need its content." },
          ],
        },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "Checked both." }] },
        { type: "message", role: "user", content: "Now fix the button." },
        ...currentSteps,
      ],
    })
  })

  it("drops tools when options.final is true", async () => {
    const env: AgentsMdEnvironment = {
      async resolvePath() {
        const error = new Error("ENOENT") as NodeJS.ErrnoException
        error.code = "ENOENT"
        throw error
      },
      async readTextFile() {
        throw new Error("Should not read missing file")
      },
    }

    const { snapshot } = await loadTurnSnapshot({
      model: "claude-sonnet",
      prompt: "Summarize",
      history: [],
      tools: SAMPLE_TOOLS,
      workspacePath: "/repo",
      environment: env,
      now: new Date("2026-11-26T00:00:00.000Z"),
      platform: "linux",
      loadBlob: () => null,
      readFileBase64: () => null,
    })

    const normal = assembleRequest(snapshot, [])
    expect(normal.tools).toEqual(SAMPLE_TOOLS)

    const finalRequest = assembleRequest(snapshot, [], { final: true })
    expect(finalRequest.tools).toBeUndefined()
    expect("tools" in finalRequest).toBe(false)
  })

  it("reuses one snapshot across multiple rounds without reading files or blobs again", async () => {
    const imgBytes = Buffer.from("cached-image")
    const storedBlobImg = toStoredMedia(
      [{ type: "input_image", image_url: `data:image/png;base64,${imgBytes.toString("base64")}`, detail: "auto" }],
      { path: "/repo/a.png" },
    )
    const encodeBlob = mock(imgBytes.toString.bind(imgBytes))
    imgBytes.toString = encodeBlob
    const largePathImgRef = {
      type: "ccodex_media_ref" as const,
      kind: "image" as const,
      mime: "image/jpeg",
      name: "huge.jpg",
      bytes: 6_000_000,
      path: "/repo/huge.jpg",
      turnRead: true,
    }

    const history: HistoryTurn[] = [
      {
        userSeq: 1,
        assistantSeq: 2,
        state: "completed",
        items: [
          { type: "message", role: "user", content: "Turn 1" },
          { type: "function_call_output", call_id: "c1", output: storedBlobImg.parts },
        ],
      },
      {
        userSeq: 3,
        assistantSeq: 4,
        state: "completed",
        items: [
          { type: "message", role: "user", content: "Turn 2" },
          { type: "function_call_output", call_id: "c2", output: storedBlobImg.parts },
          { type: "function_call_output", call_id: "c3", output: [largePathImgRef] },
          largePathImgRef,
        ],
      },
    ]

    let resolveCalls = 0
    let readTextCalls = 0
    let loadBlobCalls = 0
    let readFileBase64Calls = 0

    const env: AgentsMdEnvironment = {
      async resolvePath() {
        resolveCalls += 1
        return { path: "/repo/AGENTS.md", insideWorkspace: true }
      },
      async readTextFile() {
        readTextCalls += 1
        return "Project rules"
      },
    }

    const { snapshot, warnings } = await loadTurnSnapshot({
      model: "claude-sonnet",
      prompt: "Round prompt",
      history,
      tools: SAMPLE_TOOLS,
      workspacePath: "/repo",
      environment: env,
      now: new Date("2026-11-26T00:00:00.000Z"),
      platform: "darwin",
      loadBlob: () => {
        loadBlobCalls += 1
        return imgBytes
      },
      readFileBase64: () => {
        readFileBase64Calls += 1
        return Buffer.from("jpeg-bytes").toString("base64")
      },
    })

    const round1 = assembleRequest(snapshot, [])
    const round2 = assembleRequest(snapshot, [
      { type: "function_call", id: "fc-1", call_id: "c4", name: "read", arguments: "{}" },
      { type: "function_call_output", call_id: "c4", output: "ok" },
    ])

    expect(resolveCalls).toBe(1)
    expect(readTextCalls).toBe(1)
    expect(loadBlobCalls).toBe(1)
    expect(encodeBlob).toHaveBeenCalledTimes(1)
    expect(readFileBase64Calls).toBe(1)
    expect(round2.input.length).toBe(round1.input.length + 2)
    expect(round2.input.slice(0, -2)).toEqual(round1.input)
    expect(round1.input.some((item) => item.type === "ccodex_media_ref")).toBe(false)
    expect(warnings).toEqual(["Skipped standalone media references in conversation history."])
  })

  it("applies boundMedia last, dropping old history media while keeping current-turn steps", async () => {
    const oldImg = Buffer.alloc(200, 0x41)
    const storedOld = toStoredMedia(
      [
        { type: "input_text", text: "Read file: old.png (PNG image)." },
        { type: "input_image", image_url: `data:image/png;base64,${oldImg.toString("base64")}`, detail: "auto" },
      ],
      { path: "/repo/old.png" },
    )
    const env: AgentsMdEnvironment = {
      async resolvePath() {
        const error = new Error("ENOENT") as NodeJS.ErrnoException
        error.code = "ENOENT"
        throw error
      },
      async readTextFile() {
        return ""
      },
    }

    const { snapshot } = await loadTurnSnapshot({
      model: "claude-sonnet",
      prompt: "Current prompt",
      history: [
        {
          userSeq: 1,
          assistantSeq: 2,
          state: "completed",
          items: [
            { type: "message", role: "user", content: "Old prompt" },
            { type: "function_call_output", call_id: "c-old", output: storedOld.parts },
          ],
        },
      ],
      workspacePath: "/repo",
      environment: env,
      now: new Date("2026-11-26T00:00:00.000Z"),
      platform: "darwin",
      loadBlob: () => oldImg,
      readFileBase64: () => null,
    })

    const currentStep: FunctionCallOutputItem = {
      type: "function_call_output",
      call_id: "c-now",
      output: [
        { type: "input_text", text: "Read file: now.png (PNG image)." },
        { type: "input_image", image_url: `data:image/png;base64,${Buffer.alloc(200, 0x42).toString("base64")}`, detail: "auto" },
      ],
    }

    const { boundMedia } = media
    const limitMedia = spyOn(media, "boundMedia").mockImplementation((request) => boundMedia(request, {
      documentBase64Bytes: 1_000,
      imageAndRequestBase64Bytes: 1_200,
    }))
    let bounded
    try {
      bounded = assembleRequest(snapshot, [currentStep])
      expect(limitMedia).toHaveBeenCalledWith(expect.objectContaining({
        model: "claude-sonnet",
        stream: true,
        input: expect.arrayContaining([currentStep]),
      }))
    } finally {
      limitMedia.mockRestore()
    }

    const oldOutput = bounded.input.find(
      (item): item is Extract<ResponseInputItem, { type: "function_call_output" }> =>
        item.type === "function_call_output" && item.call_id === "c-old",
    )
    const currentOutput = bounded.input.find(
      (item): item is Extract<ResponseInputItem, { type: "function_call_output" }> =>
        item.type === "function_call_output" && item.call_id === "c-now",
    )

    expect(oldOutput?.output).toEqual([
      { type: "input_text", text: "Read file: old.png (PNG image)." },
      { type: "input_text", text: "[media removed to fit the request limit: old.png]" },
    ])
    expect(currentOutput).toEqual(currentStep)
  })
})
