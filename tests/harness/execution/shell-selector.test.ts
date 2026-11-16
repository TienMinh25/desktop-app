import { afterEach, expect, it } from "bun:test"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { resolveShellInvocation } from "../../../src/harness/execution/shell-selector"

let tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(tempDirectories.map((directory) => rm(directory, { recursive: true, force: true })))
  tempDirectories = []
})

async function fakePath(names: string[]): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "shell-selector-"))
  tempDirectories.push(directory)
  for (const name of names) {
    const file = join(directory, name)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, "#!/bin/sh\nexit 0\n")
    await chmod(file, 0o755)
  }
  return directory
}

it("uses the executable configured in SHELL when it exists", async () => {
  const directory = await fakePath(["custom-shell"])
  const executable = join(directory, "custom-shell")
  expect(resolveShellInvocation("echo ok", "linux", { SHELL: executable, PATH: directory })).toEqual({
    executable,
    args: ["-c", "echo ok"],
    os: "Linux",
  })
})

it("rejects a directory configured as SHELL and continues to the platform fallback", async () => {
  const directory = await fakePath(["bash"])
  const invocation = resolveShellInvocation("echo ok", "linux", { SHELL: directory, PATH: directory })
  expect(invocation.executable).toBe(join(directory, "bash"))
})

it("falls back to zsh on macOS", async () => {
  const invocation = resolveShellInvocation("echo ok", "darwin", { PATH: "" })
  expect(invocation.executable).toBe("/bin/zsh")
  expect(invocation.args).toEqual(["+o", "nomatch", "-c", "echo ok"])
  expect(invocation.os).toBe("macOS")
})

it("prefers bash over sh on Linux", async () => {
  const directory = await fakePath(["bash", "sh"])
  const invocation = resolveShellInvocation("echo ok", "linux", { PATH: directory })
  expect(invocation.executable).toBe(join(directory, "bash"))
  expect(invocation.args).toEqual(["-lc", "echo ok"])
})

it("falls back to sh when bash is unavailable on Linux", async () => {
  const invocation = resolveShellInvocation("echo ok", "linux", { PATH: "" })
  expect(invocation.executable).toBe("/bin/sh")
})

it("prefers pwsh then powershell then Git Bash on Windows", async () => {
  const allShells = await fakePath(["pwsh.exe", "powershell.exe", "bash.exe", "cmd.exe"])
  expect(resolveShellInvocation("Write-Output ok", "win32", { PATH: allShells }).executable).toBe(join(allShells, "pwsh.exe"))
  const powershellOnly = await fakePath(["powershell.exe", "bash.exe", "cmd.exe"])
  expect(resolveShellInvocation("Write-Output ok", "win32", { PATH: powershellOnly }).executable).toBe(join(powershellOnly, "powershell.exe"))
  const gitBashOnly = await fakePath(["git/cmd/git.exe", "git/bin/bash.exe", "cmd.exe"])
  expect(resolveShellInvocation("echo ok", "win32", { PATH: join(gitBashOnly, "git", "cmd") }).executable).toBe(join(gitBashOnly, "git", "bin", "bash.exe"))
})

it("uses PowerShell flags and cmd flags for Windows shells", async () => {
  const directory = await fakePath(["pwsh.exe", "cmd.exe"])
  expect(resolveShellInvocation("Write-Output ok", "win32", { PATH: directory })).toEqual({
    executable: join(directory, "pwsh.exe"),
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "Write-Output ok"],
    os: "Windows",
  })
  expect(resolveShellInvocation("echo ok", "win32", { PATH: join(directory, "cmd-only"), COMSPEC: join(directory, "cmd.exe") })).toEqual({
    executable: join(directory, "cmd.exe"),
    args: ["/d", "/s", "/c", '"echo ok"'],
    os: "Windows",
    windowsVerbatimArguments: true,
  })
})

it("preserves a cmd executable path with spaces for verbatim spawning", async () => {
  const base = await mkdtemp(join(tmpdir(), "shell-selector-"))
  tempDirectories.push(base)
  const directory = join(base, "shell path")
  await mkdir(directory)
  const executable = join(directory, "cmd.exe")
  await writeFile(executable, "fake cmd")
  const invocation = resolveShellInvocation('echo "value with spaces"', "win32", { COMSPEC: executable, PATH: directory })
  expect(invocation.executable).toBe(executable)
  expect(invocation.args).toEqual(["/d", "/s", "/c", '"echo "value with spaces""'])
  expect(invocation.windowsVerbatimArguments).toBe(true)
})

it("falls back to cmd.exe when COMSPEC is unusable", async () => {
  const directory = await fakePath(["cmd.exe"])
  expect(resolveShellInvocation("echo ok", "win32", { PATH: directory, COMSPEC: "missing-cmd.exe" }).executable).toBe(join(directory, "cmd.exe"))
})

it("uses Unix flags when Git Bash is selected on Windows", async () => {
  const directory = await fakePath(["bash.exe"])
  const executable = join(directory, "bash.exe")
  expect(resolveShellInvocation("printf ok", "win32", { SHELL: executable, PATH: directory })).toEqual({
    executable,
    args: ["-lc", "printf ok"],
    os: "Windows",
  })
})

it("uses generic -c flags for nonstandard shells regardless of host OS", async () => {
  const directory = await fakePath(["tcsh"])
  expect(resolveShellInvocation("echo ok", "darwin", { SHELL: join(directory, "tcsh"), PATH: directory }).args).toEqual(["-c", "echo ok"])
  expect(resolveShellInvocation("echo ok", "win32", { SHELL: join(directory, "tcsh"), PATH: directory }).args).toEqual(["-c", "echo ok"])
})

it("does not mistake an unrelated bash.exe for Git Bash", async () => {
  const directory = await fakePath(["bash.exe", "cmd.exe"])
  const invocation = resolveShellInvocation("echo ok", "win32", { PATH: directory })
  expect(invocation.executable).toBe(join(directory, "cmd.exe"))
})

it("preserves unknown platform names and uses the non-Windows fallback", () => {
  const invocation = resolveShellInvocation("echo ok", "freebsd", { PATH: "" })
  expect(invocation).toEqual({ executable: "/bin/sh", args: ["-lc", "echo ok"], os: "freebsd" })
})
