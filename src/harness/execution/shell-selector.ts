import { accessSync, constants, statSync } from "node:fs"
import { basename, delimiter, dirname, join, resolve } from "node:path"

export interface ShellInvocation {
  executable: string
  args: string[]
  os: string
  windowsVerbatimArguments?: boolean
}

export function resolveShellInvocation(command: string, platform: NodeJS.Platform | string, env: NodeJS.ProcessEnv): ShellInvocation {
  const os = platform === "darwin" ? "macOS" : platform === "win32" ? "Windows" : platform === "linux" ? "Linux" : platform
  const windows = os === "Windows"
  let executable = configuredShell(env.SHELL, env.PATH, windows)
  if (!executable && os === "macOS") executable = "/bin/zsh"
  if (!executable && os === "Linux") executable = findOnPath("bash", env.PATH, false) ?? "/bin/sh"
  if (!executable && windows) executable = windowsFallback(env)
  if (!executable) executable = "/bin/sh"

  return { executable, ...shellArguments(executable, command), os }
}

function configuredShell(shell: string | undefined, pathValue: string | undefined, windows: boolean): string | undefined {
  if (!shell?.trim()) return undefined
  return findOnPath(shell.trim(), pathValue, windows)
}

function windowsFallback(env: NodeJS.ProcessEnv): string | undefined {
  return findOnPath("pwsh.exe", env.PATH, true)
    ?? findOnPath("pwsh", env.PATH, true)
    ?? findOnPath("powershell.exe", env.PATH, true)
    ?? findOnPath("powershell", env.PATH, true)
    ?? findGitBash(env.PATH)
    ?? findOnPath(env.COMSPEC ?? "", env.PATH, true)
    ?? findOnPath("cmd.exe", env.PATH, true)
    ?? "cmd.exe"
}

function findGitBash(pathValue: string | undefined): string | undefined {
  const git = findOnPath("git.exe", pathValue, true) ?? findOnPath("git", pathValue, true)
  if (git) {
    const adjacent = join(dirname(dirname(git)), "bin", "bash.exe")
    if (isFile(adjacent, true)) return adjacent
  }
  return undefined
}

function findOnPath(command: string, pathValue: string | undefined, windows: boolean): string | undefined {
  if (!command.trim()) return undefined
  if (isAbsoluteLike(command, windows)) return isFile(command, windows) ? resolve(command) : undefined
  const pathDelimiter = windows ? ";" : delimiter
  const directories = (pathValue ?? "").split(pathDelimiter).filter(Boolean)
  const candidates = windows && !/\.exe$/i.test(command) ? [command, `${command}.exe`] : [command]
  for (const directory of directories) {
    for (const candidate of candidates) {
      const resolved = join(directory, candidate)
      if (isFile(resolved, windows)) return resolved
    }
  }
  return undefined
}

function isAbsoluteLike(file: string, windows: boolean): boolean {
  return windows ? /^[A-Za-z]:[\\/]/.test(file) || file.startsWith("\\\\") || file.startsWith("/") : file.startsWith("/")
}

function isFile(file: string, windows: boolean): boolean {
  try {
    if (!statSync(file).isFile()) return false
    // Windows executable checks use regular-file existence; Unix also requires execute permission.
    requireAccess(file, windows ? constants.F_OK : constants.X_OK)
    return true
  } catch {
    return false
  }
}

function requireAccess(file: string, mode: number): void {
  // accessSync keeps PATH resolution synchronous, before child process creation.
  accessSync(file, mode)
}

function shellArguments(executable: string, command: string): Pick<ShellInvocation, "args" | "windowsVerbatimArguments"> {
  const name = basename(executable).toLowerCase().replace(/\.exe$/, "")
  if (name === "cmd") return { args: ["/d", "/s", "/c", `"${command}"`], windowsVerbatimArguments: true }
  if (name === "pwsh" || name === "powershell") return { args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command] }
  if (name === "zsh") return { args: ["+o", "nomatch", "-c", command] }
  if (name === "bash" || name === "sh") return { args: ["-lc", command] }
  return { args: ["-c", command] }
}
