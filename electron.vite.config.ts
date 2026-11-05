import react from "@vitejs/plugin-react"
import { defineConfig } from "electron-vite"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
const root = dirname(fileURLToPath(import.meta.url))
export default defineConfig({
  main: {
    build: {
      lib: {
        entry: resolve(root, "src/desktop/main/index.ts"),
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
})