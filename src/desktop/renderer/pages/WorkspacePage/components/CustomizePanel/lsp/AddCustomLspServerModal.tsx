import { useEffect, useState, type FormEvent } from "react"
import type { LspCustomServer } from "../../../../../../../contracts/lsp"
import styles from "./LanguageServersTabView.module.scss"

interface AddCustomLspServerModalProps {
  server?: LspCustomServer
  onClose: () => void
  onSave: (server: LspCustomServer) => Promise<void>
}

export function AddCustomLspServerModal({ server, onClose, onSave }: AddCustomLspServerModalProps) {
  const [name, setName] = useState(server?.name ?? "")
  const [language, setLanguage] = useState(server?.language ?? "")
  const [command, setCommand] = useState(server?.command ?? "")
  const [args, setArgs] = useState(server?.args.join("\n") ?? "")
  const [extensions, setExtensions] = useState(server?.extensions.join(", ") ?? "")
  const [languageId, setLanguageId] = useState(server?.languageId ?? "")
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSaving) onClose()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [isSaving, onClose])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsedExtensions = [...new Set(extensions.split(",").map((item) => {
      const value = item.trim().toLowerCase()
      return value && !value.startsWith(".") ? `.${value}` : value
    }).filter(Boolean))]
    if (!parsedExtensions.length) return setError("Add at least one file extension, such as .lua")
    setError(null)
    setIsSaving(true)
    try {
      await onSave({
        id: server?.id ?? `custom:${crypto.randomUUID()}`,
        name: name.trim(),
        language: language.trim(),
        command: command.trim(),
        args: args.split("\n").map((item) => item.trim()).filter(Boolean),
        extensions: parsedExtensions,
        languageId: languageId.trim(),
      })
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save language server")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !isSaving) onClose()
    }}>
      <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="custom-lsp-title">
        <div className={styles.modalHeader}>
          <div>
            <h2 id="custom-lsp-title">{server ? "Edit custom server" : "Add custom server"}</h2>
            <p>Use a language server already installed on this device.</p>
          </div>
          <button className={styles.closeButton} type="button" aria-label="Close" onClick={onClose} disabled={isSaving}>×</button>
        </div>
        <form onSubmit={(event) => void handleSubmit(event)}>
          <label className={styles.formField}>
            <span>Name</span>
            <input autoFocus required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="Lua Language Server" />
          </label>
          <label className={styles.formField}>
            <span>Language</span>
            <input required maxLength={80} value={language} onChange={(event) => setLanguage(event.target.value)} placeholder="Lua" />
          </label>
          <label className={styles.formField}>
            <span>Command or executable path</span>
            <input required maxLength={2000} value={command} onChange={(event) => setCommand(event.target.value)} placeholder="lua-language-server" />
          </label>
          <label className={styles.formField}>
            <span>Arguments <small>one per line</small></span>
            <textarea rows={2} maxLength={4000} value={args} onChange={(event) => setArgs(event.target.value)} placeholder="--stdio" />
          </label>
          <label className={styles.formField}>
            <span>File extensions <small>comma separated</small></span>
            <input required maxLength={500} value={extensions} onChange={(event) => setExtensions(event.target.value)} placeholder=".lua" />
          </label>
          <label className={styles.formField}>
            <span>Language ID</span>
            <input required maxLength={100} value={languageId} onChange={(event) => setLanguageId(event.target.value)} placeholder="lua" />
          </label>
          {error && <p className={styles.errorMessage} role="alert">{error}</p>}
          <div className={styles.modalActions}>
            <button type="button" className={styles.secondaryButton} onClick={onClose} disabled={isSaving}>Cancel</button>
            <button type="submit" className={styles.primaryButton} disabled={isSaving}>{isSaving ? "Saving…" : "Save server"}</button>
          </div>
        </form>
      </section>
    </div>
  )
}
