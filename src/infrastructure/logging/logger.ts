import type { IpcMain, IpcMainInvokeEvent } from "electron"
import { validate, type AppEnvironment } from "../config/environment"

interface LoggingConfig {
  env: AppEnvironment
  apiEnabled: boolean
  ipcEnabled: boolean
}

function resolveLoggingConfig(): LoggingConfig {
  try {
    const config = validate()
    return {
      env: config.APP_ENV,
      apiEnabled: config.ENABLE_API_LOG,
      ipcEnabled: config.ENABLE_IPC_LOG,
    }
  } catch {
    const rawEnv = process.env.APP_ENV?.trim().toLowerCase()
    const env: AppEnvironment =
      rawEnv === "prod" || rawEnv === "production"
        ? "prod"
        : rawEnv === "uat"
          ? "uat"
          : "sit"
    const fallback = env !== "prod"
    return {
      env,
      apiEnabled: parseBooleanEnv(process.env.ENABLE_API_LOG, fallback),
      ipcEnabled: parseBooleanEnv(process.env.ENABLE_IPC_LOG, fallback),
    }
  }
}

function parseBooleanEnv(raw: string | undefined, fallback: boolean): boolean {
  const normalized = raw?.trim().toLowerCase()
  if (normalized === "true" || normalized === "1") return true
  if (normalized === "false" || normalized === "0") return false
  return fallback
}

function formatTimestamp(): string {
  return new Date().toISOString()
}

export type LogCategory = "api" | "ipc"

export interface ForwardedLogEntry {
  category: LogCategory
  level: "info" | "error"
  env: AppEnvironment
  message: string
  meta?: unknown
}

type LogForwarder = (entry: ForwardedLogEntry) => void
let logForwarder: LogForwarder | null = null

export function setLogForwarder(forwarder: LogForwarder | null): void {
  logForwarder = forwarder
}

function emitLog(
  category: LogCategory,
  level: "info" | "error",
  env: AppEnvironment,
  message: string,
  meta?: unknown,
): void {
  if (level === "error") {
    if (meta !== undefined && meta !== "") {
      console.error(message, meta)
    } else {
      console.error(message)
    }
  } else if (meta !== undefined && meta !== "") {
    console.info(message, meta)
  } else {
    console.info(message)
  }
  logForwarder?.({ category, level, env, message, meta })
}

export const logger = {
  get config(): LoggingConfig {
    return resolveLoggingConfig()
  },

  apiRequest(method: string, url: string, payload?: unknown): void {
    const cfg = resolveLoggingConfig()
    if (!cfg.apiEnabled) return
    emitLog(
      "api",
      "info",
      cfg.env,
      `[${formatTimestamp()}] [${cfg.env.toUpperCase()}] [API ->] ${method.toUpperCase()} ${url}`,
      payload,
    )
  },

  apiResponse(method: string, url: string, status: number, durationMs: number): void {
    const cfg = resolveLoggingConfig()
    if (!cfg.apiEnabled) return
    emitLog(
      "api",
      status >= 400 ? "error" : "info",
      cfg.env,
      `[${formatTimestamp()}] [${cfg.env.toUpperCase()}] [API <-] ${method.toUpperCase()} ${url} (${status}, ${durationMs}ms)`,
    )
  },

  apiError(method: string, url: string, error: unknown, durationMs: number): void {
    const cfg = resolveLoggingConfig()
    if (!cfg.apiEnabled) return
    const message = error instanceof Error ? error.message : String(error)
    emitLog(
      "api",
      "error",
      cfg.env,
      `[${formatTimestamp()}] [${cfg.env.toUpperCase()}] [API !!] ${method.toUpperCase()} ${url} (${durationMs}ms): ${message}`,
    )
  },

  ipcCall(channel: string, args?: unknown[]): void {
    const cfg = resolveLoggingConfig()
    if (!cfg.ipcEnabled) return
    const meta = args && args.length > 0 ? args : undefined
    emitLog(
      "ipc",
      "info",
      cfg.env,
      `[${formatTimestamp()}] [${cfg.env.toUpperCase()}] [IPC ->] ${channel}`,
      meta,
    )
  },

  ipcSuccess(channel: string, durationMs: number): void {
    const cfg = resolveLoggingConfig()
    if (!cfg.ipcEnabled) return
    emitLog(
      "ipc",
      "info",
      cfg.env,
      `[${formatTimestamp()}] [${cfg.env.toUpperCase()}] [IPC <-] ${channel} (ok, ${durationMs}ms)`,
    )
  },

  ipcError(channel: string, error: unknown, durationMs: number): void {
    const cfg = resolveLoggingConfig()
    if (!cfg.ipcEnabled) return
    const message = error instanceof Error ? error.message : String(error)
    emitLog(
      "ipc",
      "error",
      cfg.env,
      `[${formatTimestamp()}] [${cfg.env.toUpperCase()}] [IPC !!] ${channel} (${durationMs}ms): ${message}`,
    )
  },
}

/**
 * Wraps an async API call with structured request/response/error logging.
 */
export async function withApiLogging<T>(
  method: string,
  url: string,
  execute: () => Promise<T>,
  payload?: unknown,
): Promise<T> {
  const startedAt = Date.now()
  logger.apiRequest(method, url, payload)
  try {
    const result = await execute()
    const status =
      result && typeof result === "object" && "status" in result && typeof result.status === "number"
        ? result.status
        : 200
    logger.apiResponse(method, url, status, Date.now() - startedAt)
    return result
  } catch (error) {
    logger.apiError(method, url, error, Date.now() - startedAt)
    throw error
  }
}

/**
 * Registers an Electron ipcMain.handle listener wrapped with automatic IPC logging.
 */
export function registerIpcHandler<TArgs extends unknown[], TResult>(
  ipcMainInstance: IpcMain,
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: TArgs) => Promise<TResult> | TResult,
): void {
  ipcMainInstance.handle(channel, async (event, ...args) => {
    const startedAt = Date.now()
    logger.ipcCall(channel, args)
    try {
      const result = await handler(event, ...(args as TArgs))
      logger.ipcSuccess(channel, Date.now() - startedAt)
      return result
    } catch (error) {
      logger.ipcError(channel, error, Date.now() - startedAt)
      throw error
    }
  })
}
