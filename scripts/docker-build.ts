import { execSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

const rootDir = resolve(import.meta.dir, "..")
const caFilePath = resolve(rootDir, ".docker-host-ca.crt")
const envFilePath = resolve(rootDir, ".env")
const BUILD_ENV_KEYS = [
  "BACKEND_HOST",
  "MCP_REGISTRY_BASE_URL",
  "MCP_REGISTRY_API_VERSION",
  "UPDATE_FEED_URL",
] as const

function readBackendHostFromDotEnv(): string {
  if (!existsSync(envFilePath)) return ""
  const content = readFileSync(envFilePath, "utf-8")
  let backendHost = ""
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const match = /^BACKEND_HOST\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    backendHost = (match[1] ?? "").trim().replace(/^(['"])(.*)\1$/, "$2").trim()
  }
  return backendHost
}

function assertBuildEnvConfigured(): void {
  const backendHost = process.env.BACKEND_HOST?.trim() || readBackendHostFromDotEnv()
  if (!backendHost) {
    console.error(
      "Error: BACKEND_HOST is required for Docker build. Create .env (from .env.example) or set BACKEND_HOST in your environment.",
    )
    process.exit(1)
  }
}

function exportHostCaCertificates(): void {
  if (process.platform === "win32") {
    console.log("Exporting Windows Root CA certificates for Docker build...")
    const ps =
      'powershell -NoProfile -Command "(Get-ChildItem Cert:\\LocalMachine\\Root, Cert:\\CurrentUser\\Root) | ForEach-Object { \\"-----BEGIN CERTIFICATE-----`r`n\\" + [Convert]::ToBase64String($_.RawData, \\"InsertLineBreaks\\") + \\"`r`n-----END CERTIFICATE-----\\" }"'
    const certs = execSync(ps, {
      encoding: "utf-8",
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true,
    })
    writeFileSync(caFilePath, certs.replace(/\r\n/g, "\n"), "utf-8")
  } else {
    writeFileSync(caFilePath, "", "utf-8")
  }
}

function getHostCacheDirs(): { electronCache: string; builderCache: string } {
  const localAppData = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local")
  const electronCache =
    process.platform === "win32"
      ? join(localAppData, "electron", "Cache")
      : join(homedir(), ".cache", "electron")
  const builderCache =
    process.platform === "win32"
      ? join(localAppData, "electron-builder", "Cache")
      : join(homedir(), ".cache", "electron-builder")

  if (!existsSync(electronCache)) mkdirSync(electronCache, { recursive: true })
  if (!existsSync(builderCache)) mkdirSync(builderCache, { recursive: true })

  return { electronCache, builderCache }
}

function run(cmd: string, args: string[]): void {
  const result = spawnSync(cmd, args, {
    cwd: rootDir,
    stdio: "inherit",
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

const target = process.argv[2] ?? "all"

exportHostCaCertificates()

if (target === "export-ca") {
  console.log("Exported host CA certificates to .docker-host-ca.crt")
  process.exit(0)
}

assertBuildEnvConfigured()

console.log("Building Docker image ccodex-builder...")
run("docker", ["build", "-t", "ccodex-builder", "."])

const { electronCache, builderCache } = getHostCacheDirs()
const releaseDir = resolve(rootDir, "release")
if (!existsSync(releaseDir)) mkdirSync(releaseDir, { recursive: true })

const runArgs = [
  "run",
  "--rm",
  "-v",
  `${releaseDir}:/app/release`,
  "-v",
  `${electronCache}:/root/.cache/electron`,
  "-v",
  `${builderCache}:/root/.cache/electron-builder`,
]

if (existsSync(envFilePath)) {
  runArgs.push("--env-file", ".env")
}

for (const key of BUILD_ENV_KEYS) {
  const value = process.env[key]?.trim()
  if (value) {
    runArgs.push("-e", `${key}=${value}`)
  }
}

runArgs.push("ccodex-builder")

if (target === "win") {
  runArgs.push("bun", "run", "build:win")
} else if (target === "mac") {
  runArgs.push("bun", "run", "build:mac:zip")
} else {
  runArgs.push("bun", "run", "build:all")
}

console.log(`Running packaging inside Docker container (target: ${target})...`)
run("docker", runArgs)
