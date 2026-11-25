import v1 from "./0001_init.sql?raw"

export type Migration = { version: number; name: string; sql: string }

// Append only: version is index + 1, a shipped file is never edited or deleted
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "0001_init", sql: v1 },
]
