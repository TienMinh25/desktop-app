import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "electron-vite"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { validate } from "./src/infrastructure/config/environment"

const root = dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ command, mode }) => {
  const fileEnv = loadEnv(mode, root, "")
  const pick = (key: string): string => process.env[key]?.trim() || fileEnv[key]?.trim() || ""

  const rawEnv = {
    BACKEND_HOST: pick("BACKEND_HOST"),
    MCP_REGISTRY_BASE_URL: pick("MCP_REGISTRY_BASE_URL"),
    MCP_REGISTRY_API_VERSION: pick("MCP_REGISTRY_API_VERSION"),
    UPDATE_FEED_URL: pick("UPDATE_FEED_URL"),
  }

  if (command === "build") {
    if (!rawEnv.BACKEND_HOST) {
      throw new Error(
        "BACKEND_HOST is required for build. Set BACKEND_HOST in .env or pass it via environment variables.",
      )
    }
    validate(rawEnv)
  }

  const buildEnv = rawEnv

  return {
    main: {
      define: {
        __APP_BUILD_ENV__: JSON.stringify(buildEnv),
      },
      build: {
        lib: {
          entry: {
            index: resolve(root, "src/desktop/main/index.ts"),
            "harness-server": resolve(root, "src/harness-server/index.ts"),
          },
        },
      },
    },
    preload: {
      build: {
        lib: {
          entry: resolve(root, "src/desktop/preload/index.ts"),
          formats: ["cjs"],
        },
        rollupOptions: {
          output: {
            entryFileNames: "[name].cjs",
          },
        },
      },
    },
    renderer: {
      root: resolve(root, "src/desktop/renderer"),
      plugins: [react()],
      css: {
        preprocessorOptions: {
          scss: {
            additionalData: `@use "${resolve(root, "src/desktop/renderer/styles/_variables.scss").replace(/\\/g, "/")}" as *;\n@use "${resolve(root, "src/desktop/renderer/styles/_mixins.scss").replace(/\\/g, "/")}" as *;\n`,
          },
        },
      },
      build: {
        rollupOptions: {
          input: resolve(root, "src/desktop/renderer/index.html"),
        },
      },
    },
  }
})
