export interface ResolvedPath {
  path: string
  insideWorkspace: boolean
}

export interface WorkspaceFile {
  absolutePath: string
  relativePath: string
}

export interface FileListResult {
  files: WorkspaceFile[]
  visitedEntries: number
  truncated: boolean
}

export interface TextSearchResult {
  matches: string[]
  truncated: boolean
}

export interface TextFilePage {
  content: string
  startLine: number
  endLine: number
  totalLines?: number
  nextOffset?: number
}

export interface CommandResult {
  exitCode: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  timedOut: boolean
  outputTruncated: boolean
}

/** Replaceable boundary for local, OS-sandboxed, or remote workspace execution. */
export interface ExecutionEnvironment {
  readonly workspacePath: string
  resolvePath(input: string, allowMissing?: boolean): Promise<ResolvedPath>
  readTextFile(path: string, maxBytes: number, expectedInsideWorkspace: boolean): Promise<string>
  readTextFilePage(path: string, expectedInsideWorkspace: boolean, offset: number, limit: number): Promise<TextFilePage>
  writeTextFile(path: string, content: string): Promise<void>
  listFiles(pattern: string, maxFiles?: number): Promise<FileListResult>
  searchText(pattern: string, glob: string, maxResults?: number): Promise<TextSearchResult>
  validatePatch(patch: string): string[]
  applyPatch(patch: string): Promise<string>
  runCommand(command: string, timeoutMs?: number): Promise<CommandResult>
  close(): void
}
