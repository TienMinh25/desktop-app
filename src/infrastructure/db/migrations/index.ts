import v1 from "./0001_init.sql?raw"
import v2 from "./0002_turn_state.sql?raw"

// Append only: index + 1 is the version, a shipped file is never edited
export const MIGRATIONS: readonly string[] = [v1, v2]
