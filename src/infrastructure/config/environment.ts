import { z } from "zod"

const MCP_REGISTRY_BASE_URL_DEFAULT = "https://registry.modelcontextprotocol.io"
const MCP_REGISTRY_API_VERSION_DEFAULT = "v0.1"
const UPDATE_FEED_URL_DEFAULT = "https://updates.ccodex.com/releases"

export interface EnvConfig {
  readonly BACKEND_HOST: string
  readonly MCP_REGISTRY_BASE_URL: string
  readonly MCP_REGISTRY_API_VERSION: string
  readonly UPDATE_FEED_URL: string
}

export class EnvConfigValidationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid environment configuration:\n${issues.map((issue) => `- ${issue}`).join("\n")}`)
    this.name = "EnvConfigValidationError"
  }
}

/** Validate environment inputs only; consumers parse domain-specific JSON after injection. */
export function validate(source: NodeJS.ProcessEnv = process.env): EnvConfig {
  const issues: string[] = []
  const run = <T>(field: string, validator: () => T, fallback: T): T => {
    try {
      return validator()
    } catch (error) {
      issues.push(`${field}: ${error instanceof Error ? error.message : String(error)}`)
      return fallback
    }
  }

  const backendHost = run("BACKEND_HOST", () => validateBackendHost(source.BACKEND_HOST), "")
  const mcpRegistryBaseUrl = run(
    "MCP_REGISTRY_BASE_URL",
    () => validateMcpRegistryBaseUrl(source.MCP_REGISTRY_BASE_URL),
    MCP_REGISTRY_BASE_URL_DEFAULT,
  )
  const mcpRegistryApiVersion = run(
    "MCP_REGISTRY_API_VERSION",
    () => validateMcpRegistryApiVersion(source.MCP_REGISTRY_API_VERSION),
    MCP_REGISTRY_API_VERSION_DEFAULT,
  )
  const updateFeedUrl = run(
    "UPDATE_FEED_URL",
    () => validateUpdateFeedUrl(source.UPDATE_FEED_URL),
    UPDATE_FEED_URL_DEFAULT,
  )
  if (issues.length) throw new EnvConfigValidationError(issues)

  return Object.freeze({
    BACKEND_HOST: backendHost,
    MCP_REGISTRY_BASE_URL: mcpRegistryBaseUrl,
    MCP_REGISTRY_API_VERSION: mcpRegistryApiVersion,
    UPDATE_FEED_URL: updateFeedUrl,
  })
}

function validateBackendHost(raw: string | undefined): string {
  const value = raw?.trim().replace(/\/+$/, "") ?? ""
  if (!value) return ""
  const url = parseUrl(value)
  if (!isSecureProtocol(url)) throw new Error("must use HTTPS (HTTP is allowed only for localhost)")
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("must contain only the backend origin")
  }
  return url.origin
}

function validateMcpRegistryBaseUrl(raw: string | undefined): string {
  const value = raw?.trim() || MCP_REGISTRY_BASE_URL_DEFAULT
  const url = parseUrl(value)
  if (!isSecureProtocol(url)) throw new Error("must use HTTPS (HTTP is allowed only for localhost)")
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("must contain only the registry origin")
  }
  return url.origin
}

function validateMcpRegistryApiVersion(raw: string | undefined): string {
  const schema = z.string().trim().regex(/^v\d+(?:\.\d+)?$/, "expected a version such as v0.1")
  return parseField(raw?.trim() || MCP_REGISTRY_API_VERSION_DEFAULT, schema)
}

function validateUpdateFeedUrl(raw: string | undefined): string {
  const value = raw?.trim() || UPDATE_FEED_URL_DEFAULT
  const url = parseUrl(value)
  if (!isSecureProtocol(url)) throw new Error("must use HTTPS (HTTP is allowed only for localhost)")
  if (url.username || url.password || url.search || url.hash) throw new Error("must not contain credentials, query, or fragment")
  return url.toString().replace(/\/+$/, "")
}

function parseUrl(value: string): URL {
  parseField(value, z.string().url())
  try {
    return new URL(value)
  } catch {
    throw new Error("must be a valid URL")
  }
}

function parseField<T>(value: unknown, schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const location = issue?.path.length ? `at ${issue.path.join(".")}: ` : ""
    const detail = `${location}${issue?.message ?? "value is invalid"}`
    throw new Error(detail)
  }
  return parsed.data
}

function isSecureProtocol(url: URL): boolean {
  const isLocalHost = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]"
  return url.protocol === "https:" || (url.protocol === "http:" && isLocalHost)
}
