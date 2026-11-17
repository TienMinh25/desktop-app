import { z } from "zod"

export const McpServerConfigSchema = z.object({
  name: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
})

export const McpServerConfigListSchema = z.array(McpServerConfigSchema)
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>
