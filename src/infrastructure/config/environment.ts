import { z } from "zod"

const MCP_REGISTRY_BASE_URL_DEFAULT = "https://registry.modelcontextprotocol.io"
const MCP_REGISTRY_API_VERSION_DEFAULT = "v0.1"
const UPDATE_FEED_URL_DEFAULT = "https://updates.ccodex.com/releases"

export type AppEnvironment = "sit" | "uat" | "prod"

export interface EnvConfig {
  readonly APP_ENV: AppEnvironment
  readonly ENABLE_API_LOG: boolean
  readonly ENABLE_IPC_LOG: boolean
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

declare const __APP_BUILD_ENV__: Partial<Record<keyof EnvConfig, string>> | undefined

function resolveEnvSource(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const buildEnv = typeof __APP_BUILD_ENV__ !== "undefined" ? __APP_BUILD_ENV__ : undefined
  if (!buildEnv || source !== process.env) return source
  return {
    ...source,
    APP_ENV: source.APP_ENV || buildEnv.APP_ENV,
    ENABLE_API_LOG: source.ENABLE_API_LOG || buildEnv.ENABLE_API_LOG,
    ENABLE_IPC_LOG: source.ENABLE_IPC_LOG || buildEnv.ENABLE_IPC_LOG,
    BACKEND_HOST: source.BACKEND_HOST || buildEnv.BACKEND_HOST,
    MCP_REGISTRY_BASE_URL: source.MCP_REGISTRY_BASE_URL || buildEnv.MCP_REGISTRY_BASE_URL,
    MCP_REGISTRY_API_VERSION: source.MCP_REGISTRY_API_VERSION || buildEnv.MCP_REGISTRY_API_VERSION,
    UPDATE_FEED_URL: source.UPDATE_FEED_URL || buildEnv.UPDATE_FEED_URL,
  }
}

/** Validate environment inputs only; consumers parse domain-specific JSON after injection. */
export function validate(source: NodeJS.ProcessEnv = process.env): EnvConfig {
  const effectiveSource = resolveEnvSource(source)
  const issues: string[] = []
  const run = <T>(field: string, validator: () => T, fallback: T): T => {
    try {
      return validator()
    } catch (error) {
      issues.push(`${field}: ${error instanceof Error ? error.message : String(error)}`)
      return fallback
    }
  }

  const appEnv = run("APP_ENV", () => validateAppEnv(effectiveSource.APP_ENV), "sit")
  const defaultLogEnabled = appEnv !== "prod"
  const enableApiLog = run(
    "ENABLE_API_LOG",
    () => validateBooleanFlag(effectiveSource.ENABLE_API_LOG, defaultLogEnabled),
    defaultLogEnabled,
  )
  const enableIpcLog = run(
    "ENABLE_IPC_LOG",
    () => validateBooleanFlag(effectiveSource.ENABLE_IPC_LOG, defaultLogEnabled),
    defaultLogEnabled,
  )
  const backendHost = run("BACKEND_HOST", () => validateBackendHost(effectiveSource.BACKEND_HOST), "")
  const mcpRegistryBaseUrl = run(
    "MCP_REGISTRY_BASE_URL",
    () => validateMcpRegistryBaseUrl(effectiveSource.MCP_REGISTRY_BASE_URL),
    MCP_REGISTRY_BASE_URL_DEFAULT,
  )
  const mcpRegistryApiVersion = run(
    "MCP_REGISTRY_API_VERSION",
    () => validateMcpRegistryApiVersion(effectiveSource.MCP_REGISTRY_API_VERSION),
    MCP_REGISTRY_API_VERSION_DEFAULT,
  )
  const updateFeedUrl = run(
    "UPDATE_FEED_URL",
    () => validateUpdateFeedUrl(effectiveSource.UPDATE_FEED_URL),
    UPDATE_FEED_URL_DEFAULT,
  )
  if (issues.length) throw new EnvConfigValidationError(issues)

  return Object.freeze({
    APP_ENV: appEnv,
    ENABLE_API_LOG: enableApiLog,
    ENABLE_IPC_LOG: enableIpcLog,
    BACKEND_HOST: backendHost,
    MCP_REGISTRY_BASE_URL: mcpRegistryBaseUrl,
    MCP_REGISTRY_API_VERSION: mcpRegistryApiVersion,
    UPDATE_FEED_URL: updateFeedUrl,
  })
}

function validateAppEnv(raw: string | undefined): AppEnvironment {
  const normalized = raw?.trim().toLowerCase()
  if (!normalized || normalized === "development" || normalized === "dev") return "sit"
  if (normalized === "production") return "prod"
  if (normalized === "sit" || normalized === "uat" || normalized === "prod") return normalized
  throw new Error("expected sit, uat, or prod")
}

function validateBooleanFlag(raw: string | undefined, fallback: boolean): boolean {
  const normalized = raw?.trim().toLowerCase()
  if (!normalized) return fallback
  if (normalized === "true" || normalized === "1") return true
  if (normalized === "false" || normalized === "0") return false
  throw new Error("expected true or false")
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
