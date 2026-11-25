import v1 from "./0001_init.sql?raw"

// Append only: index + 1 is the version, a shipped file is never edited
export const MIGRATIONS: readonly string[] = [v1]
