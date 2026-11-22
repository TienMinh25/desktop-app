import { create, type StateCreator, type StoreApi, type UseBoundStore } from "zustand"
import { devtools, persist, type PersistOptions } from "zustand/middleware"

declare const __APP_RENDERER_ENV__:
  | {
      APP_ENV?: string
      ENABLE_API_LOG?: string
      ENABLE_IPC_LOG?: string
    }
  | undefined

export function getAppEnvironment(): "sit" | "uat" | "prod" {
  const buildEnv = typeof __APP_RENDERER_ENV__ !== "undefined" ? __APP_RENDERER_ENV__ : undefined
  const raw = (buildEnv?.APP_ENV ?? "sit").toLowerCase()
  if (raw === "prod" || raw === "production") return "prod"
  if (raw === "uat") return "uat"
  return "sit"
}

export function isNonProdEnv(): boolean {
  return getAppEnvironment() !== "prod"
}

function registerDebugStore<T>(name: string, store: UseBoundStore<StoreApi<T>>): void {
  if (!isNonProdEnv() || typeof window === "undefined") return
  const win = window as unknown as Record<string, Record<string, unknown>>
  win.__APP_STORES__ = win.__APP_STORES__ ?? {}
  win.__APP_STORES__[name] = store
}

/**
 * Creates a Zustand store automatically wrapped with Redux DevTools (active on SIT/UAT only)
 * and exposed on `window.__APP_STORES__` for instant console inspection.
 */
export function createAppStore<T>(
  name: string,
  initializer: StateCreator<T, [["zustand/devtools", never]], []>,
) {
  const store = create<T>()(
    devtools(initializer, {
      name: `C-CodeX:${name}`,
      enabled: isNonProdEnv(),
    }),
  )
  registerDebugStore(name, store)
  return store
}

/**
 * Creates a persisted Zustand store automatically wrapped with Redux DevTools (SIT/UAT only).
 */
export function createPersistedAppStore<T, Persisted = Partial<T>>(
  name: string,
  initializer: StateCreator<T, [["zustand/devtools", never], ["zustand/persist", unknown]], []>,
  persistOptions: PersistOptions<T, Persisted>,
) {
  const store = create<T>()(
    devtools(
      persist<T, [["zustand/devtools", never]], [], Persisted>(initializer, persistOptions),
      {
        name: `C-CodeX:${name}`,
        enabled: isNonProdEnv(),
      },
    ),
  )
  registerDebugStore(name, store)
  return store
}
