import { useCallback, useEffect, useMemo, useState } from "react"
import type { LspCustomServer, LspServerStatus, LspSettings } from "../../../../../../../contracts/lsp"
import { AddCustomLspServerModal } from "./AddCustomLspServerModal"
import styles from "./LanguageServersTabView.module.scss"

interface LanguageServersTabViewProps {
  onShowToast: (message: string) => void
}

const EMPTY_SETTINGS: LspSettings = { profiles: {}, customServers: [] }

export function LanguageServersTabView({ onShowToast }: LanguageServersTabViewProps) {
  const [servers, setServers] = useState<LspServerStatus[]>([])
  const [settings, setSettings] = useState<LspSettings>(EMPTY_SETTINGS)
  const [commandInputs, setCommandInputs] = useState<Record<string, string>>({})
  const [editingServer, setEditingServer] = useState<LspCustomServer | undefined>()
  const [isAddingServer, setIsAddingServer] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const applyStatuses = useCallback((nextServers: LspServerStatus[]) => {
    setServers(nextServers)
    setSettings({
      profiles: Object.fromEntries(nextServers.filter((server) => !server.isCustom).map((server) => [server.id, {
        enabled: server.requestedEnabled,
        ...(server.commandOverride ? { commandOverride: server.commandOverride } : {}),
      }])),
      customServers: nextServers.filter((server) => server.isCustom).map(({ id, name, language, command, args, extensions, languageId }) => ({
        id, name, language, command, args, extensions, languageId: languageId ?? "",
      })),
    })
    setCommandInputs(Object.fromEntries(nextServers.map((server) => [server.id, server.commandOverride ?? server.executablePath ?? server.command])))
  }, [])

  const loadServers = useCallback(async () => {
    setError(null)
    try {
      applyStatuses(await window.desktop.listLspServers())
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load language servers")
    } finally {
      setIsLoading(false)
    }
  }, [applyStatuses])

  useEffect(() => { void loadServers() }, [loadServers])

  async function saveSettings(next: LspSettings, successMessage?: string) {
    setError(null)
    setIsSaving(true)
    try {
      const statuses = await window.desktop.saveLspSettings(next)
      applyStatuses(statuses)
      if (successMessage) onShowToast(successMessage)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save language-server settings")
      throw saveError
    } finally {
      setIsSaving(false)
    }
  }

  async function rescan() {
    setError(null)
    setIsSaving(true)
    try {
      applyStatuses(await window.desktop.rescanLspServers())
      onShowToast("Language servers checked again")
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "Could not check language servers")
    } finally {
      setIsSaving(false)
    }
  }

  async function toggleServer(server: LspServerStatus, enabled: boolean) {
    const next = { ...settings, profiles: { ...settings.profiles, [server.id]: { ...settings.profiles[server.id], enabled } } }
    try { await saveSettings(next, enabled ? `${server.language} language server enabled` : `${server.language} language server disabled`) } catch { /* Error is shown in the page. */ }
  }

  async function saveCommand(server: LspServerStatus) {
    const commandOverride = commandInputs[server.id]?.trim()
    const current = settings.profiles[server.id] ?? { enabled: server.requestedEnabled }
    const profiles = { ...settings.profiles, [server.id]: {
      ...current,
      ...(commandOverride && commandOverride !== server.command ? { commandOverride } : { commandOverride: undefined }),
    } }
    try { await saveSettings({ ...settings, profiles }, `Saved executable path for ${server.language}`) } catch { /* Error is shown in the page. */ }
  }

  async function clearCommandOverride(server: LspServerStatus) {
    const current = settings.profiles[server.id] ?? { enabled: server.requestedEnabled }
    const profiles = { ...settings.profiles, [server.id]: { ...current, commandOverride: undefined } }
    try { await saveSettings({ ...settings, profiles }, `Using detected executable for ${server.language}`) } catch { /* Error is shown in the page. */ }
  }

  async function saveCustomServer(server: LspCustomServer) {
    const customServers = [...settings.customServers.filter((item) => item.id !== server.id), server]
    await saveSettings({ ...settings, customServers }, `${server.language} server saved`)
    setEditingServer(undefined)
    setIsAddingServer(false)
  }

  async function removeCustomServer(serverId: string) {
    try { await saveSettings({ ...settings, customServers: settings.customServers.filter((server) => server.id !== serverId) }, "Custom language server removed") } catch { /* Error is shown in the page. */ }
  }

  async function openGuide(serverId: string) {
    try {
      const result = await window.desktop.openLspGuide(serverId)
      if (!result.opened) setError("Could not open this language-server guide")
    } catch (guideError) {
      setError(guideError instanceof Error ? guideError.message : "Could not open this language-server guide")
    }
  }

  const builtInServers = useMemo(() => servers.filter((server) => !server.isCustom), [servers])
  const customServers = useMemo(() => servers.filter((server) => server.isCustom), [servers])

  return (
    <div className={styles.page}>
      <div className={styles.intro}>
        <div>
          <h2>Language Servers</h2>
          <p>Use language servers already installed on this device. The app detects them and guides you through setup.</p>
        </div>
        <div className={styles.pageActions}>
          <button className={styles.secondaryButton} type="button" onClick={() => void rescan()} disabled={isSaving || isLoading}>Check again</button>
          <button className={styles.primaryButton} type="button" onClick={() => setIsAddingServer(true)} disabled={isSaving}>Add custom server</button>
        </div>
      </div>

      {error && <p className={styles.errorMessage} role="alert">{error}</p>}
      {isLoading ? <p className={styles.message}>Checking for installed language servers…</p> : (
        <>
          <section className={styles.serverSection} aria-labelledby="supported-servers-title">
            <h3 id="supported-servers-title">Supported servers</h3>
            {builtInServers.map((server) => (
              <ServerRow key={server.id} server={server} command={commandInputs[server.id] ?? server.command} isSaving={isSaving}
                onCommandChange={(command) => setCommandInputs((current) => ({ ...current, [server.id]: command }))}
                onSaveCommand={() => void saveCommand(server)}
                onClearCommand={() => void clearCommandOverride(server)}
                onOpenGuide={() => void openGuide(server.id)}
                onToggle={(enabled) => void toggleServer(server, enabled)} />
            ))}
          </section>
          <section className={styles.serverSection} aria-labelledby="custom-servers-title">
            <h3 id="custom-servers-title">Custom servers</h3>
            {customServers.length ? customServers.map((server) => {
              const custom = settings.customServers.find((item) => item.id === server.id)
              return <ServerRow key={server.id} server={server} command={server.command} isSaving={isSaving} custom
                onEdit={() => custom && setEditingServer(custom)}
                onRemove={() => void removeCustomServer(server.id)} />
            }) : <p className={styles.message}>Add a server that is not in the supported list.</p>}
          </section>
        </>
      )}

      {(isAddingServer || editingServer) && <AddCustomLspServerModal server={editingServer} onClose={() => { setEditingServer(undefined); setIsAddingServer(false) }} onSave={saveCustomServer} />}
    </div>
  )
}

interface ServerRowProps {
  server: LspServerStatus
  command: string
  isSaving: boolean
  custom?: boolean
  onCommandChange?: (command: string) => void
  onSaveCommand?: () => void
  onClearCommand?: () => void
  onToggle?: (enabled: boolean) => void
  onEdit?: () => void
  onRemove?: () => void
  onOpenGuide?: () => void
}

function ServerRow({ server, command, isSaving, custom = false, onCommandChange, onSaveCommand, onClearCommand, onToggle, onEdit, onRemove, onOpenGuide }: ServerRowProps) {
  const [showSetup, setShowSetup] = useState(false)
  const statusLabel = server.detectionError ? "Needs attention" : server.enabled ? "Enabled" : server.installed ? "Installed" : "Not installed"

  return (
    <article className={styles.serverRow}>
      <div className={styles.serverMain}>
        <div className={styles.serverInfo}>
          <div className={styles.serverTitleLine}>
            <h4>{server.language}</h4>
            <span className={`${styles.status} ${server.enabled ? styles.statusReady : server.detectionError ? styles.statusError : styles.statusQuiet}`}>{statusLabel}</span>
          </div>
          <p>{server.name} <span aria-hidden="true">·</span> {server.extensions.join(", ")}</p>
          <p className={styles.description}>{server.description}</p>
          {server.installed && server.executablePath && <p className={styles.executablePath} title={server.executablePath}>{server.executablePath}</p>}
          {server.detectionError && <p className={styles.errorMessage}>{server.detectionError}</p>}
        </div>
        <div className={styles.serverActions}>
          {custom ? <>
            <button className={styles.textButton} type="button" onClick={onEdit} disabled={isSaving}>Edit</button>
            <button className={styles.textButtonDanger} type="button" onClick={onRemove} disabled={isSaving}>Remove</button>
          </> : <label className={styles.toggleLabel}>
            <span>{server.enabled ? "On" : "Off"}</span>
            <input type="checkbox" checked={server.enabled} disabled={!server.installed || isSaving} onChange={(event) => onToggle?.(event.target.checked)} aria-label={`Enable ${server.language} language server`} />
          </label>}
        </div>
      </div>
      {!server.installed && !custom && <div className={styles.setupPanel}>
        <p>Install the server yourself, then check again. The app will not install software on your behalf.</p>
        <code>{server.installCommand}</code>
        <div className={styles.setupActions}>
          <button className={styles.textButton} type="button" onClick={() => setShowSetup((value) => !value)}>{showSetup ? "Hide executable path" : "Set executable path"}</button>
          <button className={styles.textButton} type="button" onClick={onOpenGuide}>Open official setup guide ↗</button>
        </div>
        {showSetup && <div className={styles.pathEditor}>
          <input value={command} onChange={(event) => onCommandChange?.(event.target.value)} aria-label={`${server.language} executable path`} placeholder={server.command} />
          <button className={styles.secondaryButton} type="button" onClick={onSaveCommand} disabled={isSaving || !command.trim()}>Save path</button>
          {server.commandOverride && !server.installed && <button className={styles.textButton} type="button" onClick={onClearCommand} disabled={isSaving}>Use automatic detection</button>}
        </div>}
      </div>}
      {server.installed && !custom && <>
        <p className={styles.serverFootnote}>Used automatically in workspaces containing {server.extensions.join(", ")} files.</p>
        <div className={styles.setupActions}>
          <button className={styles.textButton} type="button" onClick={() => setShowSetup((value) => !value)}>{showSetup ? "Hide executable path" : "Change executable path"}</button>
          {server.commandOverride && <button className={styles.textButton} type="button" onClick={onClearCommand} disabled={isSaving}>Use automatic detection</button>}
        </div>
        {showSetup && <div className={styles.pathEditor}>
          <input value={command} onChange={(event) => onCommandChange?.(event.target.value)} aria-label={`${server.language} executable path`} placeholder={server.command} />
          <button className={styles.secondaryButton} type="button" onClick={onSaveCommand} disabled={isSaving || !command.trim()}>Save path</button>
        </div>}
      </>}
    </article>
  )
}
