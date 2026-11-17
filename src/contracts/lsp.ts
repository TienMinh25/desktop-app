import { z } from "zod"

const boundedText = (max: number) => z.string().trim().min(1).max(max)

export const LspServerConfigSchema = z.object({
  extensions: z.array(boundedText(20)).min(1).max(32),
  command: boundedText(2_000),
  args: z.array(z.string().max(2_000)).max(64).default([]),
  languageId: boundedText(100).optional(),
  cwd: z.string().max(4_000).optional(),
  env: z.record(z.string(), z.string().max(32_768)).optional(),
}).strict()

export const LspCustomServerSchema = z.object({
  id: z.string().regex(/^custom:[a-zA-Z0-9-]{1,80}$/),
  name: boundedText(80),
  language: boundedText(80),
  extensions: z.array(boundedText(20)).min(1).max(32),
  command: boundedText(2_000),
  args: z.array(z.string().max(2_000)).max(64).default([]),
  languageId: boundedText(100),
}).strict()

const LspProfilePreferenceSchema = z.object({
  enabled: z.boolean().default(false),
  commandOverride: z.string().trim().max(2_000).optional(),
}).strict()

export const LspSettingsSchema = z.object({
  profiles: z.record(z.string().max(100), LspProfilePreferenceSchema).default({}),
  customServers: z.array(LspCustomServerSchema).max(40).default([]),
}).strict()

export const LspSettingsSaveSchema = LspSettingsSchema

export type LspServerConfig = z.infer<typeof LspServerConfigSchema>
export type LspCustomServer = z.infer<typeof LspCustomServerSchema>
export type LspSettings = z.infer<typeof LspSettingsSchema>

export interface LspServerProfile {
  id: string
  name: string
  language: string
  description: string
  extensions: string[]
  command: string
  args: string[]
  languageId?: string
  installCommand: string
  guideUrl: string
}

export interface LspServerStatus extends LspServerProfile {
  enabled: boolean
  requestedEnabled: boolean
  installed: boolean
  executablePath: string | null
  commandOverride?: string
  isCustom: boolean
  detectionError?: string
}
