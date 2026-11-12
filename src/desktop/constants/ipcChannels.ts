export const IPC_CHANNELS = {
  WINDOW_MINIMIZE: "window:minimize",
  WINDOW_MAXIMIZE: "window:maximize",
  WINDOW_CLOSE: "window:close",
  SELECT_FOLDER: "dialog:select-folder",
  HARNESS_COMMAND: "harness:command",
  HARNESS_EVENT: "harness:event",
  PERMISSION_RESPONSE: "permission:response",
  QUESTION_RESPONSE: "question:response",
} as const
