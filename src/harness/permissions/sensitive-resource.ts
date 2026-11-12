const SENSITIVE_DIRECTORIES = new Set([".ssh", ".aws", ".gnupg", ".azure", ".kube", ".docker", ".password-store"])
const SENSITIVE_CONFIG_DIRECTORIES = new Set(["gcloud", "gh", "azure", "rclone", "sops"])
const SENSITIVE_FILE_NAMES = new Set([
  ".env", ".npmrc", ".netrc", ".pypirc", ".git-credentials", "credentials", "credentials.json",
  "id_rsa", "id_ed25519", "id_ecdsa", "id_dsa",
])

/** Returns whether a resource path commonly contains credentials or private keys. */
export function isSensitiveResource(resource: string): boolean {
  const parts = resource.replaceAll("\\", "/").toLowerCase().split(/[/:,\s]+/).filter(Boolean)
  const containsSensitiveConfigDirectory = parts.some((part, index) => part === ".config" && SENSITIVE_CONFIG_DIRECTORIES.has(parts[index + 1] ?? ""))
  return containsSensitiveConfigDirectory || parts.some((part) => SENSITIVE_DIRECTORIES.has(part)
    || SENSITIVE_FILE_NAMES.has(part)
    || part.startsWith(".env.")
    || part.startsWith("secrets.")
    || /\.(?:pem|p12|pfx|key|keystore)$/.test(part))
}
