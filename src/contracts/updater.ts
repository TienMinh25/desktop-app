export type AppUpdaterState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available"; version: string; releaseDate?: string }
  | { status: "not-available"; version?: string }
  | { status: "downloading"; percent: number; transferred: number; total: number }
  | { status: "downloaded"; version: string }
  | { status: "error"; message: string }
