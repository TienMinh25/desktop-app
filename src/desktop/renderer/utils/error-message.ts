import { AUTH_SERVICE_UNAVAILABLE_MESSAGE } from "../../../contracts/auth"

const IPC_PREFIX_REGEX = /^Error invoking remote method '[^']+':\s*(?:[A-Za-z0-9_]+Error:\s*)?/i
const ERROR_CLASS_PREFIX_REGEX = /^(?:[A-Za-z0-9_]+Error):\s*/

const NETWORK_OR_SERVER_PATTERNS = [
  /BACKEND_HOST/i,
  /ECONNREFUSED/i,
  /ENOTFOUND/i,
  /ETIMEDOUT/i,
  /ECONNRESET/i,
  /EAI_AGAIN/i,
  /fetch failed/i,
  /network error/i,
  /failed to fetch/i,
  /socket hang up/i,
  /aborted/i,
  /timeout/i,
  /temporarily unavailable/i,
  /Authentication request returned 5\d{2}/i,
  /HTTP request returned 5\d{2}/i,
  /Backend returned an invalid authentication response/i,
]

const INTERNAL_ERROR_PATTERNS = [
  /ZodError/i,
  /Cannot read propert/i,
  /is not a function/i,
  /is not defined/i,
  /Unexpected token/i,
]

export interface ClassifiedAuthError {
  message: string
  /** True when the error is a backend/network/system outage suitable for a global toast. */
  isGlobalToast: boolean
}

function cleanErrorMessage(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : ""

  if (!raw.trim()) return ""

  return raw
    .replace(IPC_PREFIX_REGEX, "")
    .replace(ERROR_CLASS_PREFIX_REGEX, "")
    .trim()
}

/**
 * Classifies and formats authentication errors for the UI:
 * - Backend/network/5xx/internal errors -> global toast
 * - Invalid credentials (401/400) -> inline form error
 */
export function classifyAuthError(
  error: unknown,
  fallback = "Sign in failed. Please try again.",
): ClassifiedAuthError {
  const cleaned = cleanErrorMessage(error)
  if (!cleaned) {
    return { message: fallback, isGlobalToast: true }
  }

  if (NETWORK_OR_SERVER_PATTERNS.some((pattern) => pattern.test(cleaned))) {
    return { message: AUTH_SERVICE_UNAVAILABLE_MESSAGE, isGlobalToast: true }
  }

  if (INTERNAL_ERROR_PATTERNS.some((pattern) => pattern.test(cleaned))) {
    return { message: fallback, isGlobalToast: true }
  }

  return { message: cleaned, isGlobalToast: false }
}

export function formatGeneralErrorMessage(
  error: unknown,
  fallback = "An unexpected error occurred. Please try again.",
): string {
  const cleaned = cleanErrorMessage(error)
  if (!cleaned) return fallback

  if (INTERNAL_ERROR_PATTERNS.some((pattern) => pattern.test(cleaned))) {
    return fallback
  }

  return cleaned
}
