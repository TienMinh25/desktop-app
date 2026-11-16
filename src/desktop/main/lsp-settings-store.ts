import { access, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises"
import { constants } from "node:fs"
import { delimiter, dirname, isAbsolute, join, parse, resolve } from "node:path"
import { LSP_SERVER_PROFILE_IDS, LSP_SERVER_CATALOG } from "../../domain/lsp/lsp-registry"
import {
  LspCustomServerSchema,
  LspServerConfigSchema,
  LspSettingsSchema,
  type LspServerConfig,
  type LspServerProfile,
  type LspServerStatus,
  type LspSettings,
} from "../../contracts/lsp"

const DEFAULT_SETTINGS: LspSettings = { profiles: {}, customServers: [] }

export class LspSettingsStore {
  private readonly settingsPath: string

  constructor(
    userDataPath: string,
    private readonly environment: NodeJS.ProcessEnv = process.env,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly homeDirectory = process.env.HOME ?? process.env.USERPROFILE ?? "",
  ) {
    this.settingsPath = join(userDataPath, "lsp-settings.json")
  }

  async list(): Promise<LspServerStatus[]> {
    const settings = await this.readSettings()
    return Promise.all([
      ...LSP_SERVER_CATALOG.map((profile) => this.profileStatus(profile, settings.profiles[profile.id]?.enabled ?? false, settings.profiles[profile.id]?.commandOverride)),
      ...settings.customServers.map((profile) => this.profileStatus({
        ...profile,
        description: "Custom language server.",
        installCommand: "",
        guideUrl: "",
      }, true)),
    ])
  }

  async rescan(): Promise<LspServerStatus[]> {
    return this.list()
  }

  async save(value: unknown): Promise<LspServerStatus[]> {
    const parsed = LspSettingsSchema.safeParse(value)
    if (!parsed.success) throw new Error(`Invalid LSP settings: ${parsed.error.issues[0]?.message ?? "validation failed"}`)
    const settings = parsed.data
    for (const id of Object.keys(settings.profiles)) {
      if (!LSP_SERVER_PROFILE_IDS.has(id)) throw new Error(`Unknown LSP profile: ${id}`)
    }
    const customIds = new Set<string>()
    for (const profile of settings.customServers) {
      const valid = LspCustomServerSchema.safeParse(profile)
      if (!valid.success) throw new Error(`Invalid custom LSP server: ${valid.error.issues[0]?.message ?? "validation failed"}`)
      if (customIds.has(profile.id)) throw new Error(`Duplicate custom LSP server: ${profile.id}`)
      customIds.add(profile.id)
    }
    await mkdir(dirname(this.settingsPath), { recursive: true })
    const temporaryPath = `${this.settingsPath}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 })
    await rename(temporaryPath, this.settingsPath)
    return this.list()
  }

  async harnessConfigs(): Promise<LspServerConfig[]> {
    const settings = await this.readSettings()
    const executionPath = await this.executionPath()
    const result: LspServerConfig[] = []
    for (const profile of LSP_SERVER_CATALOG) {
      const preference = settings.profiles[profile.id]
      if (!preference?.enabled) continue
      const launch = await this.resolveLaunch(profile.command, preference.commandOverride)
      if (!launch) continue
      result.push({ extensions: profile.extensions, command: launch.command, args: [...launch.args, ...profile.args], languageId: profile.languageId, env: { PATH: executionPath } })
    }
    for (const profile of settings.customServers) {
      const launch = await this.resolveLaunch(profile.command)
      if (!launch) continue
      result.push({ extensions: profile.extensions, command: launch.command, args: [...launch.args, ...profile.args], languageId: profile.languageId, env: { PATH: executionPath } })
    }
    return result.map((config) => LspServerConfigSchema.parse(config))
  }

  private async profileStatus(profile: LspServerProfile, enabled: boolean, commandOverride?: string): Promise<LspServerStatus> {
    try {
      const launch = await this.resolveLaunch(profile.command, commandOverride)
      const executablePath = launch?.executablePath ?? null
      return {
        ...profile,
        enabled: enabled && executablePath !== null,
        requestedEnabled: enabled,
        installed: executablePath !== null,
        executablePath,
        ...(commandOverride ? { commandOverride } : {}),
        isCustom: !LSP_SERVER_PROFILE_IDS.has(profile.id),
      }
    } catch (error) {
      return {
        ...profile,
        enabled: false,
        requestedEnabled: enabled,
        installed: false,
        executablePath: null,
        isCustom: !LSP_SERVER_PROFILE_IDS.has(profile.id),
        detectionError: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private async readSettings(): Promise<LspSettings> {
    try {
      const content = await readFile(this.settingsPath, "utf8")
      const parsed = LspSettingsSchema.safeParse(JSON.parse(content) as unknown)
      if (!parsed.success) throw new Error(`Saved LSP settings are invalid: ${parsed.error.issues[0]?.message ?? "validation failed"}`)
      return parsed.data
    } catch (error) {
      if (isMissingFile(error)) return DEFAULT_SETTINGS
      throw error
    }
  }

  private async resolveExecutable(command: string, override?: string): Promise<string | null> {
    const requested = override?.trim() || command
    if (isPathLike(requested)) {
      const candidate = resolve(requested.replace(/^~(?=$|[\\/])/, this.homeDirectory))
      return await isExecutable(candidate, this.platform) ? candidate : null
    }

    const candidateDirectories = (await this.executionPath()).split(delimiter).filter(Boolean)
    const seen = new Set<string>()
    for (const directory of candidateDirectories) {
      for (const suffix of executableSuffixes(this.platform, this.environment.PATHEXT)) {
        const candidate = join(directory, appendSuffix(requested, suffix))
        const key = this.platform === "win32" ? candidate.toLowerCase() : candidate
        if (seen.has(key)) continue
        seen.add(key)
        if (await isExecutable(candidate, this.platform)) return candidate
      }
    }
    return null
  }

  private async resolveLaunch(command: string, override?: string): Promise<{ executablePath: string; command: string; args: string[] } | null> {
    const executablePath = await this.resolveExecutable(command, override)
    if (!executablePath) return null
    if (this.platform !== "win32" || !/\.(cmd|bat)$/i.test(executablePath)) {
      return { executablePath, command: executablePath, args: [] }
    }

    const powershell = join(this.environment.SystemRoot ?? this.environment.WINDIR ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    const powershellShim = executablePath.replace(/\.(cmd|bat)$/i, ".ps1")
    if (!(await isExecutable(powershell, this.platform)) || !(await isExecutable(powershellShim, this.platform))) return null
    return {
      executablePath,
      command: powershell,
      args: ["-NoProfile", "-NonInteractive", "-File", powershellShim],
    }
  }

  private async executionPath(): Promise<string> {
    const directories = [
      ...(this.environment.PATH ?? "").split(delimiter).filter(Boolean),
      ...standardBinaryDirectories(this.homeDirectory, this.environment, this.platform),
    ]
    if (this.platform !== "win32") {
      directories.push(
        ...(await versionedBinaryDirectories(join(this.homeDirectory, ".nvm", "versions", "node"), "bin")),
        ...(await versionedBinaryDirectories(join(this.homeDirectory, ".asdf", "installs", "nodejs"), "bin")),
        ...(await versionedBinaryDirectories(join(this.homeDirectory, ".local", "share", "fnm", "node-versions"), "installation/bin")),
      )
    }
    return [...new Set(directories)].join(delimiter)
  }
}

async function versionedBinaryDirectories(root: string, suffix: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => join(root, entry.name, suffix))
  } catch {
    return []
  }
}

function standardBinaryDirectories(home: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  if (platform === "win32") {
    return [
      ...(env.GOPATH ? [join(env.GOPATH, "bin")] : []),
      join(home, "go", "bin"),
      join(env.CARGO_HOME ?? join(home, ".cargo"), "bin"),
      join(env.APPDATA ?? join(home, "AppData", "Roaming"), "npm"),
      join(env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "Programs"),
    ]
  }
  return [
    ...(env.GOPATH ? [join(env.GOPATH, "bin")] : []),
    join(home, "go", "bin"),
    join(env.CARGO_HOME ?? join(home, ".cargo"), "bin"),
    join(home, ".local", "bin"),
    join(home, ".npm-global", "bin"),
    join(home, ".volta", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ]
}

function executableSuffixes(platform: NodeJS.Platform, pathExt?: string): string[] {
  if (platform !== "win32") return [""]
  return (pathExt || ".EXE;.CMD;.BAT").split(";").filter(Boolean)
}

function appendSuffix(command: string, suffix: string): string {
  return suffix && !parse(command).ext ? `${command}${suffix}` : command
}

function isPathLike(value: string): boolean {
  return isAbsolute(value) || value.startsWith("~") || value.includes("/") || value.includes("\\")
}

async function isExecutable(path: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    await access(path, platform === "win32" ? constants.F_OK : constants.X_OK)
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
}
