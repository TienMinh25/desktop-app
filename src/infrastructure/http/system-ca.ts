import { execSync } from "node:child_process"
import { rootCertificates } from "node:tls"
import { Agent, setGlobalDispatcher } from "undici"

let cachedCa: (string | Buffer)[] | undefined
let cachedDispatcher: Agent | undefined

/**
 * Loads trusted root CA certificates from Windows Certificate Store (LocalMachine and CurrentUser),
 * merging them with Node's built-in root certificates so corporate proxy / SSL inspection works.
 */
export function getSystemCaCertificates(): (string | Buffer)[] | undefined {
  if (cachedCa) return cachedCa

  if (process.platform === "win32") {
    try {
      const ps = 'powershell -NoProfile -Command "(Get-ChildItem Cert:\\LocalMachine\\Root, Cert:\\CurrentUser\\Root) | ForEach-Object { \\"-----BEGIN CERTIFICATE-----`r`n\\" + [Convert]::ToBase64String($_.RawData, \\"InsertLineBreaks\\") + \\"`r`n-----END CERTIFICATE-----\\" }"'
      const winCerts = execSync(ps, { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024, windowsHide: true })
      cachedCa = [...rootCertificates, winCerts]
      return cachedCa
    } catch {
      cachedCa = [...rootCertificates]
      return cachedCa
    }
  }

  return undefined
}

export function getSystemDispatcher(): Agent {
  if (cachedDispatcher) return cachedDispatcher
  const ca = getSystemCaCertificates()
  cachedDispatcher = new Agent(ca ? { connect: { ca } } : {})
  try {
    setGlobalDispatcher(cachedDispatcher)
  } catch {
    // Ignore if dispatcher already locked or set
  }
  return cachedDispatcher
}
