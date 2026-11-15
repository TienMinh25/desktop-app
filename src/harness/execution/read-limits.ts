/** Shared read-tool limits used by the tool and its local execution adapter. */
export const READ_LIMITS = {
  textFileBytes: 20_000_000,
  mediaFileBytes: 20 * 1024 * 1024,
  pageLines: 2_000,
  pageBytes: 100_000,
} as const
