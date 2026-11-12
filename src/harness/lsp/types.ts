export type LspOperation = "definition" | "references" | "hover" | "diagnostics"
export type LspQueryOperation = Exclude<LspOperation, "diagnostics">
