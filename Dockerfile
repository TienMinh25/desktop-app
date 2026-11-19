FROM electronuserland/builder:wine

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ENV XDG_CACHE_HOME=/root/.cache
ENV ELECTRON_BUILDER_CACHE=/root/.cache/electron-builder

# Install Bun via npm (uses registry.npmjs.org)
RUN npm install -g bun

WORKDIR /app

# Install dependencies first for layer caching (skip Linux electron binary postinstall)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts && \
    for pkg in win32-x64 darwin-x64 darwin-arm64; do \
      mkdir -p "node_modules/@vscode/ripgrep-${pkg}" && \
      curl -fsSL "https://registry.npmjs.org/@vscode/ripgrep-${pkg}/-/ripgrep-${pkg}-1.18.0.tgz" \
        | tar -xz -C "node_modules/@vscode/ripgrep-${pkg}" --strip-components=1 && \
      chmod +x "node_modules/@vscode/ripgrep-${pkg}/bin/"* || true; \
    done

# Copy source and build configuration
COPY . .

# Build-time environment variables (can be passed via --build-arg, -e / --env-file, or .env)
ARG BACKEND_HOST=""
ARG MCP_REGISTRY_BASE_URL="https://registry.modelcontextprotocol.io"
ARG MCP_REGISTRY_API_VERSION="v0.1"
ARG UPDATE_FEED_URL="https://updates.ccodex.com/releases"

ENV BACKEND_HOST=${BACKEND_HOST}
ENV MCP_REGISTRY_BASE_URL=${MCP_REGISTRY_BASE_URL}
ENV MCP_REGISTRY_API_VERSION=${MCP_REGISTRY_API_VERSION}
ENV UPDATE_FEED_URL=${UPDATE_FEED_URL}

# Seed SHASUMS256.txt-<version> from the installed electron package so cached Electron archives
# validate locally without requiring an extra network fetch to github.com.
RUN cat <<'EOF' > /usr/local/bin/docker-entrypoint.sh
#!/usr/bin/env bash
set -euo pipefail
CACHE_DIR="${XDG_CACHE_HOME:-/root/.cache}/electron"
mkdir -p "$CACHE_DIR"
node -e '
  const fs = require("fs");
  const path = require("path");
  const v = require("./node_modules/electron/package.json").version;
  const c = require("./node_modules/electron/checksums.json");
  const f = path.join(process.argv[1], "SHASUMS256.txt-" + v);
  if (!fs.existsSync(f)) {
    fs.writeFileSync(f, Object.entries(c).map(([k, h]) => h + " *" + k).join("\n") + "\n");
  }
' "$CACHE_DIR"
exec "$@"
EOF
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

# Default: build both Windows (.exe) and macOS (.zip) packages into /app/release
CMD ["bun", "run", "build:all"]
