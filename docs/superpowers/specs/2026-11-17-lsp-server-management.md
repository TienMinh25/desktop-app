# LSP Server Management UI Design

## Intent

Let users enable local language servers without editing `LSP_SERVERS`. The app ships a small catalog of server profiles, detects executables already on the machine, and gives install guidance when a server is missing. It never downloads or installs a server automatically.

## Goals

- Add a **Language Servers** tab to the existing global Customize page, separate from MCP Connectors.
- Show each built-in server's language, file extensions, detection result, enabled state, setup command, and official guide.
- Detect installed executables, support a user-supplied executable path, and let the user re-scan.
- Allow adding and removing a custom server with name, command, arguments, extensions, and language ID.
- Persist preferences in Electron `userData` and update the live harness configuration when settings change.
- Add a setup shortcut in the workspace's empty greeting that opens Customize → Language Servers.
- Only include the LSP tool in model tool definitions when at least one server is enabled and launchable.
- Preserve the existing four LSP operations and per-file permission behavior.

## Non-goals

- Downloading or installing executables in-app.
- A remote server registry, package-manager integration, workspace-level overrides, or LSP support for additional protocol operations.
- Probing arbitrary commands by launching them solely to detect their presence.

## UX flow

1. User opens Customize → Language Servers.
2. The page shows profiles detected on this machine. Enabled profiles apply automatically to workspaces containing matching file types.
3. If a binary is missing, the row shows the install command, an official guide link, and a command/path field. The user installs it themselves and selects **Check again**.
4. **Add custom server** opens a small form for command, arguments, extensions, and language ID.
5. A workspace with no configured LSP shows **Set up LSP**, which navigates to the same Customize tab.

## Data and runtime

- The app-owned registry is static TypeScript metadata. It contains server identity, matching file types, launch arguments, and official setup guidance.
- User preferences and custom profiles are stored in `app.getPath("userData")/lsp-settings.json`.
- The main process resolves executable paths, returns status to the renderer, persists changes, and sends the resulting normalized server configs to the harness.
- The harness replaces its LSP configuration in place and closes old clients. No restart is needed.
- `LSP_SERVERS` is no longer the user-facing configuration path.

## Initial catalog

- Go (`gopls`): `.go`; `go install golang.org/x/tools/gopls@latest`; guide `https://go.dev/gopls/`.
- TypeScript/JavaScript (`typescript-language-server --stdio`): `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`; guide `https://github.com/typescript-language-server/typescript-language-server`.
- Python (`pyright-langserver --stdio`): `.py`, `.pyi`; guide `https://github.com/microsoft/pyright/blob/main/docs/installation.md`.
- Rust (`rust-analyzer`): `.rs`; guide `https://rust-analyzer.github.io/book/installation.html`.
- Java (Eclipse JDT LS, `jdtls`): `.java`; on macOS suggest `brew install jdtls`; requires a supported Java runtime; guide `https://github.com/eclipse-jdtls/eclipse.jdt.ls`.
- C# (`csharp-ls`): `.cs`; `dotnet tool install --global csharp-ls`; requires the .NET SDK; guide `https://github.com/razzmatazz/csharp-language-server`.
- C/C++ (`clangd`): `.c`, `.h`, `.cc`, `.hh`, `.cpp`, `.hpp`, `.cxx`, `.hxx`; on macOS suggest `brew install llvm`; guide `https://clangd.llvm.org/installation.html`. Project results improve when `compile_commands.json` is available.
- PHP (Intelephense, `intelephense --stdio`): `.php`, `.phtml`; `npm install --global intelephense`; guide `https://www.intelephense.com/docs`.

TypeScript Language Server already supports both TypeScript and JavaScript extensions: `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, and `.cjs`.

Install instructions are informational and are maintained in the shipped catalog. They must not imply that the app installed the server. Homebrew commands are macOS-specific; the official guides cover other operating systems.

## Important states

- Loading: server list is being read/detected.
- Installed, disabled: show an enable control.
- Installed, enabled: show active status and allow disable.
- Missing: show command/path input, setup command, guide, and rescan action.
- Custom server invalid or missing: preserve the entry and show the detection error so the user can correct it.
- Save/detection error: keep the current form values and show an actionable message.

## Safety and permissions

- Detection checks filesystem/PATH candidates; it does not launch the server.
- Only enabled, resolved server paths are sent to the harness.
- A configured server is launched only for a matching file after the existing LSP permission succeeds.
- Custom servers are explicit user-provided executables; never interpret arguments through a shell.

## References

- Go official gopls install guide: `https://go.dev/gopls/`
- TypeScript Language Server project: `https://github.com/typescript-language-server/typescript-language-server`
- Pyright install guide: `https://github.com/microsoft/pyright/blob/main/docs/installation.md`
- rust-analyzer install guide: `https://rust-analyzer.github.io/book/installation.html`
- Eclipse JDT LS setup: `https://github.com/eclipse-jdtls/eclipse.jdt.ls`
- csharp-ls setup: `https://github.com/razzmatazz/csharp-language-server`
- clangd setup: `https://clangd.llvm.org/installation.html`
- Intelephense setup: `https://www.intelephense.com/docs`
