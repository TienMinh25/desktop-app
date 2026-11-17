import { safeStorage } from "electron"
import { readFile, rename, unlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import { AuthTokenPairSchema, type AuthTokenPair } from "../../contracts/auth"

interface StoredAuthSession {
  version: 1
  username: string
  tokens: AuthTokenPair
}

const StoredAuthSessionSchema = z.object({
  version: z.literal(1),
  username: z.string().min(1).max(320),
  tokens: AuthTokenPairSchema,
}).strict()

export class AuthSessionStore {
  private readonly sessionPath: string

  constructor(
    ccodexDirectory: string,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {
    this.sessionPath = join(ccodexDirectory, "auth-session.bin")
  }

  async load(): Promise<StoredAuthSession | null> {
    let ciphertext: Buffer
    try {
      ciphertext = await readFile(this.sessionPath)
    } catch (error) {
      if (isMissingFile(error)) return null
      throw error
    }

    await this.assertSecureStorageAvailable()
    const decrypted = await safeStorage.decryptStringAsync(ciphertext)
    let parsed: unknown
    try {
      parsed = JSON.parse(decrypted.result)
    } catch {
      throw new Error("Saved authentication session is unreadable")
    }
    const session = StoredAuthSessionSchema.safeParse(parsed)
    if (!session.success) throw new Error("Saved authentication session is invalid")
    if (decrypted.shouldReEncrypt) await this.write(session.data)
    return session.data
  }

  async save(username: string, tokens: AuthTokenPair): Promise<void> {
    const session: StoredAuthSession = {
      version: 1,
      username,
      tokens: AuthTokenPairSchema.parse(tokens),
    }
    await this.write(session)
  }

  async clear(): Promise<void> {
    try {
      await unlink(this.sessionPath)
    } catch (error) {
      if (!isMissingFile(error)) throw error
    }
  }

  private async write(session: StoredAuthSession): Promise<void> {
    await this.assertSecureStorageAvailable()
    const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(session))
    const temporaryPath = `${this.sessionPath}.tmp`
    await writeFile(temporaryPath, encrypted, { mode: 0o600 })
    await rename(temporaryPath, this.sessionPath)
  }

  private async assertSecureStorageAvailable(): Promise<void> {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error("Secure credential storage is unavailable on this device")
    }
    if (this.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text") {
      throw new Error("A system keyring is required to save authentication credentials securely")
    }
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
}
