/** Application-side limits for requests sent through the Responses API. */
export const RESPONSES_LIMITS = {
  inputFileBytes: 40_000_000,
  inputFilesPerRequestBytes: 40_000_000,
  inputImagesPerRequestBytes: 400_000_000,
  serializedRequestBytes: 400_000_000,
} as const
